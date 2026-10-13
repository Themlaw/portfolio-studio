/**
 * Lecture de l'arborescence d'un kit (v1 ou v2) : quel calque, ou quel groupe,
 * alimente chaque emplacement, puis aplatissement dans la boîte de
 * l'emplacement.
 *
 * Tolérances (docs/THEME-KIT.md) :
 *  - noms comparés par `looseName` (casse, accents, espaces, tirets,
 *    numérotation « 1 · », précision « — premier plan ») ; anciens noms v1 ;
 *  - groupe d'un élément à un seul emplacement (« 2 · Signature ») : TOUT son
 *    contenu est aplati (l'artiste peut y ajouter calques et sous-groupes) ;
 *  - groupe à plusieurs emplacements (paysage, icônes) : chaque calque ou
 *    sous-groupe reconnu est un emplacement ; un sous-groupe non reconnu est
 *    traversé ; un calque non reconnu est ignoré et signalé ;
 *  - plan de travail : cadres relatifs à son rectangle.
 * Calque replacé et normalisé dans sa boîte (Photoshop recadre un calque à
 * son contenu au réenregistrement) : ce qui dépasse est coupé et signalé.
 */
import { getLayerImageData, type Layer } from "ag-psd";

import type { Rgba } from "./formats";
import { ALL_SLOTS, ELEMENTS, EXPORT_ID_RE, decorSlot, frameOf, HOTSPOT_LAYER, isIgnoredName, looseName, roleOfSize, slotsOfRole, SWATCH_SLOTS, type ElementSpec, type Frame, type KitRole, type Layout, type SlotSpec } from "./spec";

export type SlotSource = {
  slot: SlotSpec;
  /** Calques ou groupes à aplatir (ordre ag-psd : du bas vers le haut). */
  nodes: Layer[];
  /** Origine du plan de travail de l'élément (sinon la disposition standard). */
  boardOrigin?: { x: number; y: number };
  /** Chemin lisible (« 6 · Icônes / Flèche droite »). */
  path: string;
  /** Curseur : rectangle du calque repère « point chaud » (coordonnées du document), retiré de l'aplatissement. */
  hotspot?: { left: number; top: number; right: number; bottom: number };
};

const HOTSPOT = looseName(HOTSPOT_LAYER);
/**
 * Curseur : sort le calque « point chaud » des calques à aplatir (n'importe
 * où sous l'emplacement) et rend son rectangle. Le premier trouvé compte.
 */
function takeHotspot(nodes: Layer[]): { nodes: Layer[]; hotspot?: SlotSource["hotspot"] } {
  let hotspot: SlotSource["hotspot"];
  const strip = (list: Layer[]): Layer[] =>
    list.flatMap((l) => {
      if (!l.children && looseName(l.name ?? "") === HOTSPOT) {
        if (!hotspot && (l.right ?? 0) > (l.left ?? 0)) hotspot = { left: l.left ?? 0, top: l.top ?? 0, right: l.right ?? 0, bottom: l.bottom ?? 0 };
        l.rawData = undefined;
        return [];
      }
      return l.children ? [{ ...l, children: strip(l.children) }] : [l];
    });
  const out = strip(nodes);
  return { nodes: out, hotspot };
}

export type Resolution = {
  sources: Map<string, SlotSource>;
  /** Calques ignorés, avec la raison. */
  ignored: string[];
  /** Identifiant d'export lu dans un nom de calque (kit v2). */
  exportId: string | null;
  /** Rôle noté dans l'identifiant (kit v4), sinon null : la taille du document fait foi. */
  role: KitRole | null;
};

/** Emplacements lisibles : ceux du fichier (kit v4), sinon tous (kits mono-fichier). */
type Pool = SlotSpec[];
const elementByAlias = (n: string, pool: Pool) => ELEMENTS.find((e) => e.aliases.includes(n) && pool.some((s) => s.element === e.id));
const slotByAlias = (n: string, pool: Pool, within?: ElementSpec) => pool.find((s) => s.aliases.includes(n) && (!within || s.element === within.id));

/** Rôle du fichier, écrit dans le nom du calque d'identifiant de `_guides` (« kit k2-… · role-logo — ne pas supprimer »). */
export const ROLE_RE = /\brole-(decor|logo|icones)\b/;

/** Plan de travail : son rectangle fait la carte (même origine). */
function boardOf(l: Layer, layout: Layout): { x: number; y: number } | undefined {
  const r = l.artboard?.rect;
  return r && layout === "v2" ? { x: r.left, y: r.top } : undefined;
}

/** Calque non reconnu du groupe « 8 · Palette » : rattaché plus tard à la pastille qu'il recouvre. */
type Loose = { layer: Layer; path: string; origin?: { x: number; y: number }; order: number };

/** Rectangle du calque (coordonnées du document) recoupe-t-il la case ? */
const overlaps = (l: Layer, f: Frame) => (l.right ?? 0) > f.x && (l.left ?? 0) < f.x + f.w && (l.bottom ?? 0) > f.y && (l.top ?? 0) < f.y + f.h;

/** Identifiant d'export et rôle, lus dans les calques de `_guides` (à tout niveau). */
function readIdentity(children: Layer[] | undefined): { exportId: string | null; role: KitRole | null } {
  let exportId: string | null = null;
  let role: KitRole | null = null;
  const walk = (list: Layer[] | undefined) => {
    for (const l of list ?? []) {
      const name = l.name ?? "";
      const id = name.match(EXPORT_ID_RE);
      if (id) {
        exportId ??= id[1];
        role ??= (name.match(ROLE_RE)?.[1] as KitRole | undefined) ?? null;
      }
      if (l.children && isIgnoredName(name)) walk(l.children);
    }
  };
  walk(children);
  return { exportId, role };
}

/**
 * Décor libre (kit v4, fichier « décor ») : chaque calque ou groupe de PREMIER
 * niveau est un plan, du fond (en bas de la pile) vers l'avant. Guides,
 * consignes et aperçus ignorés ; un calque masqué est ignoré (c'est le geste
 * naturel pour « retirer » un plan sans le supprimer).
 */
export function resolveDecor(children: Layer[] | undefined): { plans: SlotSource[]; ignored: string[]; exportId: string | null; role: KitRole | null } {
  const { exportId, role } = readIdentity(children);
  const plans: SlotSource[] = [];
  const ignored: string[] = [];
  for (const l of children ?? []) {
    const name = l.name ?? "";
    if (isIgnoredName(name)) continue;
    if (l.hidden) {
      ignored.push(`${name} (calque masqué : ignoré)`);
      continue;
    }
    const slot = decorSlot(plans.length + 1);
    slot.label = `Plan ${plans.length + 1} (« ${name.trim() || "sans nom"} »)`;
    plans.push({ slot, nodes: [l], path: name });
  }
  return { plans, ignored, exportId, role };
}

export function resolveSlots(children: Layer[] | undefined, layout: Layout, role?: KitRole | null): Resolution {
  const sources = new Map<string, SlotSource>();
  const ignored: string[] = [];
  const identity = readIdentity(children);
  let exportId: string | null = identity.exportId;
  const pool: Pool = layout === "multi" ? slotsOfRole(role ?? identity.role ?? "icones") : ALL_SLOTS;
  /** Palette : ordre de pile (du bas vers le haut) des calques, reconnus ou non. */
  let order = 0;
  const mainOrder = new Map<string, number>();
  const loose: Loose[] = [];

  const take = (slot: SlotSpec, nodes: Layer[], path: string, boardOrigin?: { x: number; y: number }) => {
    if (sources.has(slot.id)) {
      ignored.push(`${path} (doublon de « ${sources.get(slot.id)!.path} »)`);
      return;
    }
    if (slot.kind === "cursor") {
      const { nodes: drawn, hotspot } = takeHotspot(nodes);
      sources.set(slot.id, { slot, nodes: drawn, path, boardOrigin, hotspot });
      return;
    }
    sources.set(slot.id, { slot, nodes, path, boardOrigin });
    if (slot.kind === "swatch") mainOrder.set(slot.id, order++);
  };

  const walk = (list: Layer[] | undefined, prefix: string[], within: ElementSpec | undefined, boardOrigin: { x: number; y: number } | undefined) => {
    for (const l of list ?? []) {
      const name = l.name ?? "";
      const id = name.match(EXPORT_ID_RE);
      if (id) exportId ??= id[1];
      if (isIgnoredName(name)) {
        // `_guides` : seul l'identifiant d'export y compte.
        if (l.children) walk(l.children.filter((c) => EXPORT_ID_RE.test(c.name ?? "")), prefix, within, boardOrigin);
        continue;
      }
      if (id && !l.children) continue;
      const n = looseName(name);
      const path = [...prefix, name].join(" / ");
      if (l.children) {
        const el = !within ? elementByAlias(n, pool) : undefined;
        if (el) {
          const origin = boardOf(l, layout) ?? boardOrigin;
          const slots = pool.filter((s) => s.element === el.id);
          if (slots.length === 1) {
            take(slots[0], l.children.filter((c) => !isIgnoredName(c.name ?? "")), path, origin);
          } else {
            walk(l.children, [...prefix, name], el, origin);
          }
          continue;
        }
        const slot = slotByAlias(n, pool, within);
        if (slot) take(slot, [l], path, boardOrigin);
        else walk(l.children, [...prefix, name], within, boardOrigin);
        continue;
      }
      const slot = slotByAlias(n, pool, within);
      if (slot) take(slot, [l], path, boardOrigin);
      else if (within?.id === "palette") loose.push({ layer: l, path, origin: boardOrigin, order: order++ });
      else ignored.push(within ? `${path} (hors d'un emplacement de « ${within.group} » : range-le dans un des calques reconnus)` : `${path} (calque non reconnu)`);
    }
  };
  walk(children, [], undefined, undefined);
  adoptLoosePaint(loose, sources, mainOrder, ignored, layout);
  return { sources, ignored, exportId, role: identity.role };
}

/**
 * Palette : un calque ajouté dans « 8 · Palette » (nouveau calque de
 * peinture, calque de forme…) est le geste le plus naturel pour repeindre une
 * pastille. Il est rattaché à chaque pastille dont la case il recoupe, empilé
 * au-dessus (ou en dessous) du calque de la pastille selon sa place dans le
 * groupe ; sans calque de pastille (supprimé), il tient lieu de pastille.
 * Hors de toute case, trop grand, ou sans pixels (calque de réglage) : ignoré
 * et signalé.
 */
function adoptLoosePaint(loose: Loose[], sources: Map<string, SlotSource>, mainOrder: Map<string, number>, ignored: string[], layout: Layout) {
  const stacks = new Map<string, { order: number; node: Layer; origin?: { x: number; y: number } }[]>();
  for (const { layer, path, origin, order } of loose) {
    const w = (layer.right ?? 0) - (layer.left ?? 0);
    const h = (layer.bottom ?? 0) - (layer.top ?? 0);
    const why = (m: string) => ignored.push(`${path} (${m})`);
    if (layer.adjustment) {
      why("calque de réglage : non pris en compte, fusionne-le avec la pastille (Calque > Fusionner avec le calque inférieur)");
      continue;
    }
    if (w <= 0 || h <= 0) {
      why("calque vide");
      continue;
    }
    if (w > SWATCH_SLOTS[0].size.w + 2 * LAYER_MARGIN || h > SWATCH_SLOTS[0].size.h + 2 * LAYER_MARGIN) {
      why("ce calque déborde de plusieurs pastilles : recadre-le sur la pastille à repeindre");
      continue;
    }
    let hit = false;
    for (const slot of SWATCH_SLOTS) {
      if (!overlaps(layer, frameOf(slot, layout, sources.get(slot.id)?.boardOrigin ?? origin))) continue;
      hit = true;
      const list = stacks.get(slot.id) ?? [];
      list.push({ order, node: layer, origin });
      stacks.set(slot.id, list);
    }
    if (!hit) why("hors de toute pastille : peins dans le calque de la pastille");
  }
  for (const [id, extra] of stacks) {
    const slot = SWATCH_SLOTS.find((s) => s.id === id)!;
    const main = sources.get(id);
    const all = [...(main ? [{ order: mainOrder.get(id) ?? 0, node: main.nodes[0] }] : []), ...extra].sort((a, b) => a.order - b.order);
    const n = extra.length;
    sources.set(id, {
      slot,
      nodes: all.map((x) => x.node),
      boardOrigin: main?.boardOrigin ?? extra[0].origin,
      path: main ? `${main.path} (+ ${n} calque${n > 1 ? "s" : ""} ajouté${n > 1 ? "s" : ""})` : `8 · Palette / ${slot.layer} (calque ajouté)`,
    });
  }
}

/** Disposition d'après la taille du document. */
export function layoutOf(width: number, height: number): Layout | null {
  if (roleOfSize(width, height)) return "multi";
  if (width === 2880 && height === 2560) return "v1";
  // v2 : 4000 × 4000 (avant la palette et les curseurs) ou 4000 × 4880 (kit v3, mêmes cases).
  if (width === 4000 && (height === 4000 || height === 4880)) return "v2";
  return null;
}

/* ---- Aplatissement ------------------------------------------------------ */

/** Modes de fusion simples, appliqués ; les autres : « normal » et un avertissement. */
const BLEND: Record<string, ((b: number, s: number) => number) | undefined> = {
  normal: (_b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  darken: (b, s) => Math.min(b, s),
  lighten: (b, s) => Math.max(b, s),
};

type Decoded = { width: number; height: number; data: ArrayLike<number> };

/** Refus d'un emplacement (calque trop grand, imbrication trop profonde) : message pour l'artiste. */
export class SlotRefusal extends Error {}

/** Marge tolérée autour de la case avant de refuser un calque (px de chaque côté). */
export const LAYER_MARGIN = 256;
/** Niveaux de groupes au plus sous la racine d'un emplacement. */
export const MAX_NESTING = 8;

/**
 * Pixels d'un calque, données compressées libérées aussitôt. AVANT tout
 * décodage (largeur × hauteur × 4 octets alloués) : un rectangle déclaré
 * plus grand que la case (+ marge) est refusé.
 */
function decode(l: Layer, frame: Frame): Decoded | null {
  const w = Math.max(0, (l.right ?? 0) - (l.left ?? 0));
  const h = Math.max(0, (l.bottom ?? 0) - (l.top ?? 0));
  if (w > frame.w + 2 * LAYER_MARGIN || h > frame.h + 2 * LAYER_MARGIN) {
    l.rawData = undefined;
    throw new SlotRefusal(`Le calque « ${l.name ?? ""} » dépasse sa case (${w} × ${h} px pour une case de ${frame.w} × ${frame.h}) : recadre-le dans Photoshop (Image > Rogner, ou efface ce qui sort de la case).`);
  }
  // Compression ZIP (codes 2, 3) : pako.inflate sans taille de sortie
  // maximale. Photoshop écrit du RLE en 8 bits : refusée avant décodage.
  if (hasZipChannels(l)) {
    l.rawData = undefined;
    throw new SlotRefusal(`Compression ZIP non prise en charge sur le calque « ${l.name ?? ""} » : réenregistre le fichier depuis Photoshop (Fichier > Enregistrer sous… > Photoshop).`);
  }
  const d = getLayerImageData(l);
  l.rawData = undefined;
  return d ?? null;
}

type FillColor = { r?: number; g?: number; b?: number; fr?: number; fg?: number; fb?: number };

/**
 * Style « Incrustation couleur » actif d'un calque (Photoshop : Calque > Style
 * de calque), en RVB 0–255 avec son opacité ; null sans style, désactivé, ou
 * dans un mode de fusion autre que « normal ».
 */
export function overlayFill(l: Layer): { rgb: [number, number, number]; opacity: number } | null {
  if (l.effects?.disabled) return null;
  for (const fx of l.effects?.solidFill ?? []) {
    if (fx.enabled === false || fx.present === false) continue;
    if (fx.blendMode && fx.blendMode !== "normal") continue;
    const c = fx.color as FillColor | undefined;
    const rgb: [number, number, number] | null =
      c && typeof c.r === "number" && typeof c.g === "number" && typeof c.b === "number"
        ? [c.r, c.g, c.b]
        : c && typeof c.fr === "number" && typeof c.fg === "number" && typeof c.fb === "number"
          ? [c.fr * 255, c.fg * 255, c.fb * 255]
          : null;
    if (rgb) return { rgb: rgb.map((v) => Math.max(0, Math.min(255, Math.round(v)))) as [number, number, number], opacity: fx.opacity ?? 1 };
  }
  return null;
}

/** Un canal (pixels ou masque) compressé en ZIP, avec ou sans prédiction. */
export function hasZipChannels(l: Layer): boolean {
  const channels = (l.rawData as { channels?: { compression?: number }[] } | undefined)?.channels ?? [];
  return channels.some((c) => c.compression === 2 || c.compression === 3);
}

const blendFn = (mode: string, warn: (m: string) => void, name: string) => {
  const f = BLEND[mode];
  if (f) return f;
  warn(`Mode de fusion « ${mode} » sur « ${name} » : non pris en charge, appliqué en « normal ». Fusionne ce calque dans Photoshop pour figer son rendu.`);
  return BLEND.normal!;
};

/**
 * Pose un pixel source (RVB droits 0–255, alpha 0–1) sur le tampon (RVBA 8
 * bits, alpha droit) : « source-over » avec mélange ; là où le fond est vide,
 * la source telle quelle.
 */
function put(dst: Uint8ClampedArray, di: number, r: number, g: number, b: number, sa: number, f: (b: number, s: number) => number) {
  if (sa <= 0) return;
  const ba = dst[di + 3] / 255;
  const oa = sa + ba * (1 - sa);
  const src = [r / 255, g / 255, b / 255];
  for (let k = 0; k < 3; k++) {
    const s = src[k];
    const bk = dst[di + k] / 255;
    const mixed = (1 - ba) * s + ba * f(bk, s);
    dst[di + k] = Math.round(((sa * mixed + ba * bk * (1 - sa)) / oa) * 255);
  }
  dst[di + 3] = Math.round(oa * 255);
}

/**
 * Compose une liste de calques (du bas vers le haut) dans `dst` (la case).
 * Un groupe normal (ou « transfert ») à 100 % se compose directement dans
 * `dst` ; un groupe avec opacité ou mode : dans son propre tampon 8 bits,
 * posé ensuite. Imbrication bornée (MAX_NESTING) : jamais plus de 8 tampons.
 */
function composite(nodes: Layer[], frame: Frame, dst: Uint8ClampedArray, warn: (m: string) => void, path: string, depth: number, fx: boolean): { overflow: boolean; any: boolean } {
  let overflow = false;
  let any = false;
  for (const l of nodes) {
    if (l.hidden) continue;
    const name = l.name ?? "";
    const mode = l.blendMode ?? "normal";
    if (l.children) {
      if (depth >= MAX_NESTING) throw new SlotRefusal(`Trop de groupes imbriqués dans « ${path.split(" / ")[0]} » (${MAX_NESTING} niveaux au plus) : fusionne ou sors des groupes dans Photoshop.`);
      const children = l.children.filter((c) => !isIgnoredName(c.name ?? ""));
      const opacity = l.opacity ?? 1;
      if ((mode === "pass through" || mode === "normal") && opacity >= 0.999) {
        const inner = composite(children, frame, dst, warn, `${path} / ${name}`, depth + 1, fx);
        overflow ||= inner.overflow;
        any ||= inner.any;
        continue;
      }
      const own = new Uint8ClampedArray(frame.w * frame.h * 4);
      const inner = composite(children, frame, own, warn, `${path} / ${name}`, depth + 1, fx);
      overflow ||= inner.overflow;
      if (!inner.any) continue;
      any = true;
      const f = blendFn(mode === "pass through" ? "normal" : mode, warn, name);
      for (let i = 0; i < own.length; i += 4) if (own[i + 3]) put(dst, i, own[i], own[i + 1], own[i + 2], (own[i + 3] / 255) * opacity, f);
      continue;
    }
    if (l.clipping) warn(`Masque d'écrêtage sur « ${name} » : ignoré, fusionne-le dans Photoshop (Calque > Fusionner avec le calque inférieur).`);
    if (l.mask && !l.mask.disabled) warn(`Masque de fusion sur « ${name} » : ignoré, applique-le dans Photoshop (clic droit sur le masque > Appliquer le masque de fusion).`);
    const d = decode(l, frame);
    if (!d) continue;
    const f = blendFn(mode, warn, name);
    const lx = l.left ?? 0;
    const ly = l.top ?? 0;
    const k = (l.fillOpacity ?? 1) * (l.opacity ?? 1);
    const overlay = fx ? overlayFill(l) : null;
    for (let y = 0; y < d.height; y++) {
      const dy = ly + y - frame.y;
      for (let x = 0; x < d.width; x++) {
        const si = (y * d.width + x) * 4;
        const a = d.data[si + 3];
        if (a === 0) continue;
        const dx = lx + x - frame.x;
        if (dx < 0 || dy < 0 || dx >= frame.w || dy >= frame.h) {
          if (a > 8) overflow = true;
          continue;
        }
        const di = (dy * frame.w + dx) * 4;
        if (overlay) {
          const o = overlay.opacity;
          put(dst, di, d.data[si] * (1 - o) + overlay.rgb[0] * o, d.data[si + 1] * (1 - o) + overlay.rgb[1] * o, d.data[si + 2] * (1 - o) + overlay.rgb[2] * o, (a / 255) * k, f);
        } else put(dst, di, d.data[si], d.data[si + 1], d.data[si + 2], (a / 255) * k, f);
        any = true;
      }
    }
  }
  return { overflow, any };
}

/**
 * Pixels de l'emplacement dans son cadre (RVBA 8 bits ; alpha ≤ 8 remis à
 * zéro, couleur comprise : l'empreinte ne dépend pas de ce qui est invisible).
 * Un seul calque normal à 100 % : copie exacte (pas d'arrondi).
 * Lève SlotRefusal (calque plus grand que sa case, imbrication trop profonde).
 */
export function flattenSlot(source: SlotSource, layout: Layout, warn: (m: string) => void, opts: { overlay?: boolean } = {}): { img: Rgba; frame: Frame; overflow: boolean } | null {
  const frame = frameOf(source.slot, layout, source.boardOrigin);
  const nodes = source.nodes;
  const out = Buffer.alloc(frame.w * frame.h * 4);
  const fx = Boolean(opts.overlay);
  const simple = nodes.length === 1 && !nodes[0].children && !(fx && overlayFill(nodes[0])) && (nodes[0].blendMode ?? "normal") === "normal" && (nodes[0].opacity ?? 1) >= 0.999 && (nodes[0].fillOpacity ?? 1) >= 0.999 && !nodes[0].clipping;
  if (simple) {
    const l = nodes[0];
    if (l.mask && !l.mask.disabled) warn(`Masque de fusion sur « ${l.name} » : ignoré, applique-le dans Photoshop (clic droit sur le masque > Appliquer le masque de fusion).`);
    const d = decode(l, frame);
    if (!d) return null;
    let overflow = false;
    const lx = l.left ?? 0;
    const ly = l.top ?? 0;
    for (let y = 0; y < d.height; y++) {
      const dy = ly + y - frame.y;
      for (let x = 0; x < d.width; x++) {
        const si = (y * d.width + x) * 4;
        if (d.data[si + 3] <= 8) continue;
        const dx = lx + x - frame.x;
        if (dx < 0 || dy < 0 || dx >= frame.w || dy >= frame.h) {
          overflow = true;
          continue;
        }
        const di = (dy * frame.w + dx) * 4;
        out[di] = d.data[si];
        out[di + 1] = d.data[si + 1];
        out[di + 2] = d.data[si + 2];
        out[di + 3] = d.data[si + 3];
      }
    }
    return { img: { width: frame.w, height: frame.h, data: out }, frame, overflow };
  }
  const buf = new Uint8ClampedArray(out.buffer, out.byteOffset, out.length);
  const { overflow, any } = composite(nodes, frame, buf, warn, source.path, 0, fx);
  if (!any) return null;
  for (let i = 0; i < out.length; i += 4) if (out[i + 3] <= 8) out.writeUInt32LE(0, i);
  return { img: { width: frame.w, height: frame.h, data: out }, frame, overflow };
}

/* ---- Limites recomptées sur l'arbre réellement lu ------------------------ */

export type TreeStats = { layers: number; area: number; depth: number; largest: number; widest: number };

/**
 * Compte sur l'arbre analysé par ag-psd (sans pixels décodés) : calques et
 * groupes, surface déclarée cumulée, profondeur, plus grand rectangle. Le
 * contrôle d'en-tête (psd-header.ts) ne lit que la section principale ;
 * ag-psd relit aussi des blocs Lr16 / Lr32 : ce recomptage fait foi.
 */
export function treeStats(children: Layer[] | undefined): TreeStats {
  const st: TreeStats = { layers: 0, area: 0, depth: 0, largest: 0, widest: 0 };
  const walk = (list: Layer[] | undefined, depth: number) => {
    for (const l of list ?? []) {
      st.layers++;
      st.depth = Math.max(st.depth, depth);
      const w = Math.max(0, (l.right ?? 0) - (l.left ?? 0));
      const h = Math.max(0, (l.bottom ?? 0) - (l.top ?? 0));
      st.area += w * h;
      st.largest = Math.max(st.largest, w * h);
      st.widest = Math.max(st.widest, w, h);
      if (l.children) walk(l.children, depth + 1);
    }
  };
  walk(children, 1);
  return st;
}

/** Limites de l'arbre (mêmes plafonds que l'en-tête, plus profondeur et plus grand calque). */
export const TREE_LIMITS = { maxDepth: 12, maxSide: 8192 };

export function treeProblem(st: TreeStats, limits: { maxLayers: number; maxLayerArea: number; areaFor?: (width: number, height: number) => number }, doc: { width: number; height: number }): string | null {
  const maxArea = limits.areaFor?.(doc.width, doc.height) ?? limits.maxLayerArea;
  if (st.layers > limits.maxLayers) return `Le document contient ${st.layers} calques et groupes : ${limits.maxLayers} au plus. Fusionne ou supprime les calques en trop.`;
  if (st.depth > TREE_LIMITS.maxDepth) return `Groupes imbriqués sur ${st.depth} niveaux : ${TREE_LIMITS.maxDepth} au plus. Sors des calques de leurs groupes ou fusionne des groupes.`;
  if (st.area > maxArea) return `Les calques couvrent ${Math.round(st.area / 1e6)} mégapixels au total : ${Math.round(maxArea / 1e6)} au plus. Supprime ou rogne les calques pleine toile en trop.`;
  if (st.widest > TREE_LIMITS.maxSide || st.largest > doc.width * doc.height) return "Un calque est plus grand que tout le document : recadre-le (Image > Rogner) puis réenregistre.";
  return null;
}

/** Libère les données compressées de tous les calques (fin de la phase 1). */
export function freeRaw(children: Layer[] | undefined) {
  for (const l of children ?? []) {
    l.rawData = undefined;
    if (l.children) freeRaw(l.children);
  }
}
