/**
 * Export du kit v4 (lot 17e) : TROIS PSD aérés au lieu d'un seul document dense.
 *
 *   1-decor-accueil.psd     décor d'accueil en grand format (5760 × 3200 px, deux fois le plan
 *                           servi), calques LIBRES : chaque calque ou groupe de premier niveau
 *                           est un plan, du fond (en bas de la pile) vers l'avant ; le décor
 *                           actuel du thème y est découpé en ses plans existants
 *   2-logo-papier.psd       logo (2400 × 600), papier (tuile 1024 × 1024, aperçu 3 × 3), trait, icône du site (512 × 512, lot 83)
 *   3-icones-curseurs.psd   icônes (512 × 512), curseurs (512 × 512), cadre, scotch
 *
 * Les éléments se dessinent EN GRAND ; l'import les réduit à leur taille d'usage
 * (formats.reduceTo, lanczos3). Pas de palette : elle se choisit dans l'éditeur.
 * Chaque fichier a une bande de consignes en tête (calque « LISEZ-MOI » tout en haut),
 * des cartes verrouillées (« Aperçu — ne pas modifier ») et un groupe `_guides` verrouillé
 * qui porte l'identifiant du kit ET le rôle du fichier. Le nom du fichier n'a aucune
 * importance à l'import.
 *
 * Mémoire : un fichier à la fois (rasters libérés, composite écrit sur disque puis
 * encodé ligne à ligne, comme l'export mono-fichier).
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writePsdBuffer, type Layer, type Psd } from "ag-psd";
import sharp, { type OverlayOptions } from "sharp";

import { ensureAgPsd } from "./ag-psd-node";
import {
  compositeRle,
  currentLookSvg,
  esc,
  gc,
  hotspotRaster,
  layerAt,
  LOCKED,
  memStep,
  psdWithoutComposite,
  purgeStaleComposites,
  rasterSvg,
  rawInput,
  signatureRaster,
  TEXT,
  textRaster,
  TITLE_H,
  toRaster,
  type BuildOptions,
  type KitBuildStats,
  type Raster,
} from "./build";
import { asImported, frameHash, saveManifest, writePreview, type KitManifest } from "./manifest";
import {
  ALL_SLOTS,
  CURSOR_DEFAULT_HOTSPOT,
  CURSOR_DRAWING_LAYER,
  DECOR_CANVAS,
  DECOR_HEAD,
  DECOR_SCALE,
  drawScale,
  EXPORT_ID_PREFIX,
  frameOf,
  GUIDES_GROUP,
  HOTSPOT_LAYER,
  KIT_FILES,
  KIT_ROLES,
  KIT_V4_VERSION,
  MAX_DECOR_PLANS,
  MULTI_CARDS,
  MULTI_HEAD,
  PREVIEW_LAYER,
  README_LAYER,
  SLOTS,
  slotsOfRole,
  TITLE_ZONE,
  type KitRole,
  type MultiCard,
  type SlotSpec,
} from "./spec";
import { closeVignetteSvg, HIGHLIGHT, vignetteSvg } from "./vignettes";
import type { Theme } from "@/themes/schema";

const GREY = "#1f2226";
const DOC = (role: KitRole) => KIT_FILES[role].doc;
const HEAD = (role: KitRole) => (role === "decor" ? DECOR_HEAD : MULTI_HEAD);
/** Case de dessin d'un emplacement, comme une « fausse » fiche de taille d'écran (size = taille de la case). */
const drawSlot = (s: SlotSpec): SlotSpec => ({ ...s, size: s.draw! });

/* ---- Texte des consignes -------------------------------------------------- */

const READMES: Record<KitRole, { title: string; lines: string[] }> = {
  decor: {
    title: "Fichier 1 sur 3 · Décor d'accueil",
    lines: [
      "Dessine le décor dans le grand cadre en dessous (5760 × 3200 px). Le site le réduit de moitié.",
      "Calques LIBRES : chaque calque (ou groupe) de premier niveau devient un plan. Le plus bas de la pile est le plus lointain, le plus haut passe devant, et les plans glissent un peu les uns devant les autres avec la souris.",
      "Tu choisis le nombre de plans (jusqu'à 8) et leur ordre : crée, supprime et déplace les calques comme tu veux. Un calque masqué est ignoré.",
      "Le plan du fond peut être opaque (un ciel) ; les autres doivent rester transparents par endroits. Garde la zone du titre (cadre rose) calme.",
      "Le grain se peint dans le papier (fichier 2). RVB 8 bits, ne redimensionne pas le document, pixellise effets et textes.",
    ],
  },
  logo: {
    title: "Fichier 2 sur 3 · Logo et papier",
    lines: [
      "Dessine chaque élément EN GRAND dans sa case : le site le réduit tout seul à sa taille d'usage, proprement.",
      "Logo : 2400 × 600 px (affiché à environ 160 × 40 px au départ ; réglable avec « Taille du logo »). Papier : tuile de 1024 × 1024 px, avec l'aperçu de la répétition 3 × 3. Trait : 2400 × 160 px.",
      "Ce fichier garde ce qui se répète ou s'étire (papier, trait) et l'identité du site (logo). Les petits objets sont dans le fichier 3.",
      "Pas envie de dessiner un élément ? Laisse-le tel quel. Pas envie d'envoyer ce fichier ? Ne l'envoie pas : tout reste inchangé.",
      "RVB 8 bits, ne redimensionne pas le document, pixellise effets et textes.",
    ],
  },
  icones: {
    title: "Fichier 3 sur 3 · Icônes et curseurs",
    lines: [
      "Dessine chaque élément EN GRAND dans sa case : le site le réduit tout seul à sa taille d'usage, proprement.",
      "Icônes et icônes vidéo : 512 × 512 px (affichées à 128). Curseurs : 512 × 512 px (affichés à 32). Cadre : 900 × 900 px. Scotch : 1200 × 480 px.",
      "Pourquoi ici : ce sont de petits objets posés sur le site (boutons, souris, cadre des images, scotch). Ils se dessinent en grand puis se réduisent, comme les icônes.",
      "Pas envie de dessiner un élément ? Laisse-le tel quel. Pas envie d'envoyer ce fichier ? Ne l'envoie pas : tout reste inchangé.",
      "RVB 8 bits, ne redimensionne pas le document, pixellise effets et textes.",
    ],
  },
};

/** LISEZ-MOI.txt de l'archive. */
export function archiveReadme(siteName: string): string {
  return [
    `Kit Photoshop du thème — ${siteName}`,
    "",
    "Ce dossier contient trois fichiers Photoshop (.psd) :",
    `  ${KIT_FILES.decor.file}      le décor de l'accueil, en grand format. Calques libres : chaque calque devient un plan.`,
    `  ${KIT_FILES.logo.file}       le logo, le papier (tuile répétée), le trait et l'icône du site.`,
    `  ${KIT_FILES.icones.file}   les icônes, les icônes des vidéos, les curseurs de la souris, le cadre des images et le scotch.`,
    "",
    "Comment faire :",
    "  1. Ouvre le fichier qui t'intéresse. Les consignes sont tout en haut (calque LISEZ-MOI).",
    "  2. Dessine EN GRAND dans les cases : le site réduit tout seul à la bonne taille.",
    "  3. Enregistre en .psd (RVB, 8 bits, sans changer la taille du document).",
    "  4. Renvoie les fichiers modifiés dans l'admin (Thèmes > Kit Photoshop) : le .zip entier, un seul .psd, ou plusieurs .psd choisis ensemble.",
    "",
    "Tu peux n'envoyer qu'un fichier : les éléments des fichiers absents ne changent pas.",
    "Les fichiers sont reconnus par leur contenu, pas par leur nom : tu peux les renommer.",
    "",
  ].join("\n");
}

/* ---- Illustrations d'exemple ------------------------------------------------ */

type Colors = Theme["tokens"]["color"];

/** Trois calques empilés = trois plans (exemple du fichier décor). */
async function planExample(c: Colors, fontFile: string, w: number, h: number): Promise<Raster> {
  const sheet = (i: number, fill: string, art: string) => {
    const x = 40 + i * 120;
    const y = 90 + (2 - i) * 70;
    return `<g transform="translate(${x} ${y})"><rect width="620" height="300" rx="14" fill="${c.surface}" stroke="#8a8f98" stroke-width="4"/><clipPath id="p${i}"><rect width="620" height="300" rx="14"/></clipPath><g clip-path="url(#p${i})">${art}</g></g>`;
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${sheet(0, c.bgDeep, `<rect width="620" height="300" fill="${c.bgDeep}"/><circle cx="480" cy="80" r="46" fill="${c.bg}"/>`)}
${sheet(1, c.tertiary, `<path d="M0 300 V190 C120 120 230 230 360 170 S560 150 620 190 V300Z" fill="${c.tertiary}" fill-opacity="0.9"/>`)}
${sheet(2, c.ink, `<path d="M70 300 L110 150 L150 300Z M150 300 L200 110 L250 300Z M300 300 L335 170 L370 300Z" fill="${c.ink}"/>`)}
</svg>`;
  const labels = [
    { text: "Plan 3 · devant : sapins", x: 960, y: 270 },
    { text: "Plan 2 : collines", x: 960, y: 200 },
    { text: "Plan 1 · le plus loin : ciel", x: 960, y: 130 },
  ];
  const parts: OverlayOptions[] = await Promise.all(labels.map(async (l) => ({ ...rawInput(await textRaster(`<span foreground="${GREY}">${esc(l.text)}</span>`, fontFile, TEXT.label)), left: l.x, top: l.y })));
  const cap = await textRaster(`<span foreground="${GREY}"><b>Exemple : 3 calques = 3 plans</b></span>`, fontFile, TEXT.body);
  parts.push({ ...rawInput(cap), left: 40, top: 20 });
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().composite(parts).raw().toBuffer({ resolveWithObject: true });
  return toRaster({ data, info });
}

/** « Tu dessines en grand, le site réduit » (exemple des fichiers logo et icônes). */
async function reduceExample(c: Colors, fontFile: string, w: number, h: number, big: string, small: string, wide: boolean): Promise<Raster> {
  const bw = wide ? 520 : 240;
  const bh = wide ? 130 : 240;
  const sw = bw / 2;
  const sh = bh / 2;
  const glyph = (x: number, y: number, gw: number, gh: number) =>
    wide
      ? `<path d="M${x + gw * 0.08} ${y + gh * 0.65} q ${gw * 0.1} ${-gh * 0.9} ${gw * 0.2} 0 t ${gw * 0.2} 0 t ${gw * 0.2} 0 t ${gw * 0.2} 0" fill="none" stroke="${c.ink}" stroke-width="${Math.max(2, gh * 0.07)}" stroke-linecap="round"/>`
      : `<path d="M${x + gw * 0.2} ${y + gh * 0.5} H${x + gw * 0.8} M${x + gw * 0.55} ${y + gh * 0.25} L${x + gw * 0.8} ${y + gh * 0.5} L${x + gw * 0.55} ${y + gh * 0.75}" fill="none" stroke="${c.ink}" stroke-width="${Math.max(2, gw * 0.05)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const x0 = 30;
  const y0 = 110;
  const x1 = x0 + bw + 150;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect x="${x0}" y="${y0}" width="${bw}" height="${bh}" rx="10" fill="${c.surface}" stroke="#8a8f98" stroke-width="4" stroke-dasharray="14 8"/>${glyph(x0, y0, bw, bh)}
<path d="M${x0 + bw + 30} ${y0 + bh / 2} H${x1 - 30} M${x1 - 50} ${y0 + bh / 2 - 20} L${x1 - 30} ${y0 + bh / 2} L${x1 - 50} ${y0 + bh / 2 + 20}" fill="none" stroke="${HIGHLIGHT}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="${x1}" y="${y0 + (bh - sh) / 2}" width="${sw}" height="${sh}" rx="5" fill="${c.surface}" stroke="#8a8f98" stroke-width="3"/>${glyph(x1, y0 + (bh - sh) / 2, sw, sh)}
</svg>`;
  const parts: OverlayOptions[] = [
    { ...rawInput(await textRaster(`<span foreground="${GREY}"><b>Exemple : tu dessines en grand, le site réduit</b></span>`, fontFile, TEXT.body)), left: 30, top: 20 },
    { ...rawInput(await textRaster(`<span foreground="${GREY}">${esc(big)}</span>`, fontFile, TEXT.label)), left: x0, top: y0 + bh + 18 },
    { ...rawInput(await textRaster(`<span foreground="${GREY}">${esc(small)}</span>`, fontFile, TEXT.label)), left: x1, top: y0 + bh + 18 },
  ];
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().composite(parts).raw().toBuffer({ resolveWithObject: true });
  return toRaster({ data, info });
}

/** Bande de consignes en tête du document (calque LISEZ-MOI, tout en haut de la pile). */
async function headerRaster(role: KitRole, theme: Theme, siteName: string, fontFile: string): Promise<Raster> {
  const { width: W } = DOC(role);
  const H = HEAD(role) - 20;
  const c = theme.tokens.color;
  const exW = role === "decor" ? 2000 : 1250;
  const readme = READMES[role];
  const box = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" fill="#fffbe6" stroke="${HIGHLIGHT}" stroke-width="3"/></svg>`;
  // Le décor est un grand document : consignes plus grandes pour rester lisibles sans zoomer.
  const big = role === "decor";
  const head = await textRaster(`<span foreground="${GREY}"><b>${esc(`Kit « ${siteName} » — ${readme.title}`)}</b></span>`, fontFile, big ? 68 : TEXT.readmeTitle);
  const body = await textRaster(`<span foreground="${GREY}">${readme.lines.map((l) => `• ${esc(l)}`).join("\n")}</span>`, fontFile, big ? 50 : TEXT.body, W - exW - 100);
  if (14 + head.height + 10 + body.height > H - 8) throw new Error(`LISEZ-MOI (${role}) : le texte déborde (${14 + head.height + 10 + body.height} > ${H - 8} px)`);
  const example =
    role === "decor"
      ? await planExample(c, fontFile, exW, 560)
      : role === "logo"
        ? await reduceExample(c, fontFile, exW, 420, "case 2400 × 600 px", "affiché ~160 × 40 px", true)
        : await reduceExample(c, fontFile, exW, 420, "case 512 × 512", "affichée 128 × 128", false);
  const { data, info } = await sharp(Buffer.from(box))
    .ensureAlpha()
    .composite([
      { ...rawInput(head), left: 30, top: 14 },
      { ...rawInput(body), left: 30, top: 14 + head.height + 10 },
      { ...rawInput(example), left: W - exW - 30, top: Math.max(10, Math.round((H - example.height) / 2)) },
    ])
    .raw()
    .toBuffer({ resolveWithObject: true });
  return toRaster({ data, info });
}

/* ---- Cartes (aperçu verrouillé sous les cases) ------------------------------- */

const slotName = (s: SlotSpec) => (s.kind === "cursor" ? s.layer : s.kind === "signature" ? "Logo" : s.label);
const finalSize = (s: SlotSpec) => `${s.size.w} × ${s.size.h}`;

/**
 * Carte d'un élément (calque « Aperçu — ne pas modifier ») : fond blanc percé à
 * l'endroit des cases, titre, légendes sous les cases (nom, taille finale), phrase « où »,
 * consignes, vignette du site. Origine du raster = coin de la carte (`board`).
 */
async function cardRaster(card: MultiCard, theme: Theme, fontFile: string): Promise<Raster> {
  const b = card.board;
  const c = theme.tokens.color;
  const slots = slotsOfRole(card.role).filter((s) => s.element === card.element);
  const holes: string[] = slots.map((s) => {
    const f = frameOf(s, "multi");
    return `M${f.x - b.x} ${f.y - b.y} h ${f.w} v ${f.h} h ${-f.w} Z`;
  });
  // Aperçu 3 × 3 du papier : sa case est percée aussi (le calque d'aperçu verrouillé s'y pose).
  const preview = card.element === "papier" ? papierPreviewFrame(card) : null;
  if (preview) holes.push(`M${preview.x} ${preview.y} h ${preview.w} v ${preview.h} h ${-preview.w} Z`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}"><path fill-rule="evenodd" fill="#ffffff" stroke="#b9bdc6" stroke-width="3" d="M1.5 ${TITLE_H - 10} h ${b.w - 3} v ${b.h - TITLE_H + 8} h ${-(b.w - 3)} Z ${holes.join(" ")}"/></svg>`;
  const parts: OverlayOptions[] = [];
  const title = await textRaster(`<span foreground="${GREY}"><b>${esc(card.title)}</b></span>`, fontFile, TEXT.title);
  parts.push({ ...rawInput(title), left: 4, top: Math.max(0, TITLE_H - title.height - 14) });

  // Légendes sous les cases : nom et taille affichée.
  for (const s of slots) {
    const f = frameOf(s, "multi");
    const wrap = Math.max(f.w, 540) - 16;
    const label = s.kind === "cursor" ? `${slotName(s)} — affiché 32 × 32 px` : s.kind === "vicon" ? `${slotName(s)} — réduite à 12-26 px` : s.kind === "vbadge" ? `Fond du badge — option, masqué` : s.kind === "appicon" ? `${slotName(s)} — réduite à 16 px dans l'onglet` : `${slotName(s)} — affiché ${finalSize(s)} px`;
    const text = await textRaster(`<span foreground="${GREY}"><b>${esc(label.split(" — ")[0])}</b>\n${esc(label.split(" — ")[1] ?? "")}</span>`, fontFile, TEXT.label, wrap);
    const top = f.y - b.y + f.h + 14;
    if (top + text.height > b.h - 6) throw new Error(`légende hors de la carte : ${s.label}`);
    parts.push({ ...rawInput(text), left: f.x - b.x, top });
  }
  if (preview) {
    const t = await textRaster(`<span foreground="${GREY}"><b>Aperçu 3 × 3 (tuile actuelle)</b>\nne pas modifier</span>`, fontFile, TEXT.label, preview.w);
    parts.push({ ...rawInput(t), left: preview.x, top: preview.y + preview.h + 14 });
  }

  // Panneau : « où », consignes, vignette.
  const pw = card.panel.w;
  let py = card.panel.y;
  const where = await textRaster(`<span foreground="${GREY}">${esc(card.where)}</span>`, fontFile, TEXT.body, pw);
  parts.push({ ...rawInput(where), left: card.panel.x, top: py });
  py += where.height + 22;
  const rules = await textRaster(`<span foreground="${GREY}">${card.rules.map((r) => `• ${esc(r)}`).join("\n")}</span>`, fontFile, TEXT.body, pw);
  parts.push({ ...rawInput(rules), left: card.panel.x, top: py });
  py += rules.height;
  if (py > b.h - 12) throw new Error(`carte « ${card.group} » : le panneau déborde (${py} > ${b.h - 12} px)`);
  if (card.vignette) {
    const v = card.vignette;
    parts.push({ input: Buffer.from(vignetteSvg(card.element, c, v.w, v.h)), left: v.x, top: v.y });
    if (card.element === "icones") parts.push({ input: Buffer.from(closeVignetteSvg(c, v.w, v.h)), left: v.x, top: v.y + v.h + 20 });
  }
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().composite(parts).raw().toBuffer({ resolveWithObject: true });
  return toRaster({ data, info });
}

/** Aperçu 3 × 3 du papier : à droite de la tuile (relatif à la carte). */
function papierPreviewFrame(card: MultiCard): { x: number; y: number; w: number; h: number } {
  const tile = slotsOfRole("logo").find((s) => s.id === "papier")!;
  const f = frameOf(tile, "multi");
  return { x: f.x - card.board.x + f.w + 60, y: f.y - card.board.y, w: 1020, h: 1020 };
}

/** Repères d'une carte (dans `_guides`) : cases (rose), zone utile (bleu pointillé), marges du cadre (vert). */
async function guidesRaster(card: MultiCard): Promise<Raster> {
  const b = card.board;
  const parts: string[] = [];
  for (const s of slotsOfRole(card.role).filter((x) => x.element === card.element)) {
    const f = frameOf(s, "multi");
    const x = f.x - b.x;
    const y = f.y - b.y;
    parts.push(`<rect x="${x - 2}" y="${y - 2}" width="${f.w + 4}" height="${f.h + 4}" fill="none" stroke="${HIGHLIGHT}" stroke-width="3"/>`);
    const m = card.margin ?? 0;
    if (m > 0) parts.push(`<rect x="${x + m}" y="${y + m}" width="${f.w - 2 * m}" height="${f.h - 2 * m}" fill="none" stroke="#0077cc" stroke-width="3" stroke-dasharray="14 8"/>`);
    if (s.slice) {
      const k = drawScale(s);
      const { top, right, bottom, left } = s.slice;
      for (const [x1, y1, x2, y2] of [
        [x + left * k, y, x + left * k, y + f.h],
        [x + f.w - right * k, y, x + f.w - right * k, y + f.h],
        [x, y + top * k, x + f.w, y + top * k],
        [x, y + f.h - bottom * k, x + f.w, y + f.h - bottom * k],
      ]) {
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#00a36c" stroke-width="3" stroke-dasharray="8 8"/>`);
      }
      // Option B (lot 58) : le coin du haut à gauche et le côté du haut, en orange ; le reste de la case reste vide.
      const o = 'fill="none" stroke="#e8590c" stroke-width="5" stroke-dasharray="20 10"';
      parts.push(`<rect x="${x + 4}" y="${y + 4}" width="${left * k - 8}" height="${top * k - 8}" ${o}/>`);
      parts.push(`<rect x="${x + left * k + 4}" y="${y + 4}" width="${f.w - (left + right) * k - 8}" height="${top * k - 8}" ${o}/>`);
    }
  }
  const { data, info } = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}">${parts.join("")}</svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return toRaster({ data, info });
}

/* ---- Pré-remplissage ---------------------------------------------------------- */

type Asset = NonNullable<BuildOptions["assets"]>[string];

/**
 * SVG à motif (`<pattern>`) rendu en grand : librsvg y devient très lent (non linéaire, le motif sous un masque : 110 à 130 s pour un
 * calque de 5760 × 3200 px du modèle « fanzine-riso », contre 1,5 s par quart). On le rend donc par TUILES carrées de 144 unités
 * (520 px à 260 dpi : bords sur des pixels entiers, pas de couture), recopiées dans une image de la taille du rendu d'un seul tenant.
 * Rend `null` quand le fichier ne s'y prête pas (pas de viewBox exploitable) : l'appelant rend alors d'un bloc.
 */
const TILE_UNITS = 144;
async function renderSvgTiled(data: Buffer, density: number): Promise<{ data: Buffer; width: number; height: number } | null> {
  const text = data.toString("utf8");
  const root = /<svg\b[^>]*>/i.exec(text);
  const vb = root && /viewBox="\s*([-\d.]+)[ ,]+([-\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)\s*"/.exec(root[0]);
  if (!root || !vb) return null;
  const [minX, minY, vw, vh] = vb.slice(1).map(Number);
  if (!(vw > 0 && vh > 0)) return null;
  const scale = density / 72;
  const W = Math.round(vw * scale);
  const H = Math.round(vh * scale);
  const canvas = Buffer.alloc(W * H * 4);
  const stripped = root[0].replace(/\s(?:width|height|viewBox|preserveAspectRatio)="[^"]*"/gi, "");
  for (let y0 = 0; y0 < vh; y0 += TILE_UNITS) {
    for (let x0 = 0; x0 < vw; x0 += TILE_UNITS) {
      const tw = Math.min(TILE_UNITS, vw - x0);
      const th = Math.min(TILE_UNITS, vh - y0);
      const tag = stripped.replace(/<svg\b/i, `<svg width="${tw}" height="${th}" viewBox="${minX + x0} ${minY + y0} ${tw} ${th}"`);
      const tile = await sharp(Buffer.from(text.replace(root[0], tag)), { density }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const px = Math.round(x0 * scale);
      const py = Math.round(y0 * scale);
      const cols = Math.min(tile.info.width, W - px);
      for (let r = 0; r < tile.info.height && py + r < H; r++) tile.data.copy(canvas, ((py + r) * W + px) * 4, r * tile.info.width * 4, (r * tile.info.width + cols) * 4);
    }
  }
  return { data: canvas, width: W, height: H };
}

/** Rend un fichier (SVG ou bitmap) à `w × h`, net : un SVG est rastérisé directement à la bonne résolution. */
async function renderFile(file: string, w: number, h: number): Promise<Buffer> {
  const data = await readFile(file);
  if (/\.svg$/i.test(file)) {
    const head = data.subarray(0, 4096).toString("utf8");
    const vb = head.match(/viewBox="\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)\s*"/);
    const width = vb ? Number(vb[1]) : Number(head.match(/\bwidth="([\d.]+)/)?.[1] ?? w);
    const density = Math.min(1200, Math.max(72, Math.ceil((72 * w) / (width || w))));
    // Motif en grand format : par tuiles (voir renderSvgTiled).
    if (process.env.KIT_SVG_TILES !== "0" && w * h > 4_000_000 && /<pattern\b/i.test(data.toString("utf8"))) {
      const tiled = await renderSvgTiled(data, density);
      if (tiled) return sharp(tiled.data, { raw: { width: tiled.width, height: tiled.height, channels: 4 } }).resize(w, h, { fit: "fill" }).ensureAlpha().raw().toBuffer();
    }
    return sharp(data, { density }).resize(w, h, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  }
  return sharp(data).resize(w, h, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer();
}

/** Élément déjà dessiné (kit appliqué au thème) replacé dans sa grande case : forme rognée centrée, le reste étiré à la case ; masque teinté. */
async function drawnRaster(slot: SlotSpec, asset: Asset, theme: Theme): Promise<Raster> {
  const k = drawScale(slot);
  const { w: W, h: H } = slot.draw!;
  const whole = !slot.crop;
  const w = whole ? W : Math.min(W, Math.round(asset.w * k));
  const h = whole ? H : Math.min(H, Math.round(asset.h * k));
  let piece = await renderFile(asset.file, w, h);
  if (slot.mono && !asset.colored) {
    const alpha = Buffer.alloc(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = piece[i * 4 + 3];
    const hex = slot.kind === "stroke" ? theme.tokens.color.primary : theme.tokens.color.ink;
    piece = await sharp({ create: { width: w, height: h, channels: 3, background: hex } }).joinChannel(alpha, { raw: { width: w, height: h, channels: 1 } }).raw().toBuffer();
    piece = await sharp(piece, { raw: { width: w, height: h, channels: 4 } }).raw().toBuffer();
  }
  const { data, info } = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: piece, raw: { width: w, height: h, channels: 4 }, left: Math.round((W - w) / 2), top: Math.round((H - h) / 2) }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  return toRaster({ data, info });
}

/** Aperçu 3 × 3 de la tuile (calque verrouillé à côté de la case du papier). */
async function tilePreview(tile: Raster): Promise<Raster> {
  const cell = 340;
  const one = await sharp(Buffer.from(tile.data.buffer, tile.data.byteOffset, tile.data.length), { raw: { width: tile.width, height: tile.height, channels: 4 } })
    .resize(cell, cell, { kernel: "lanczos3" })
    .raw()
    .toBuffer();
  const parts: OverlayOptions[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) parts.push({ input: one, raw: { width: cell, height: cell, channels: 4 }, left: x * cell, top: y * cell });
  // Repères fins aux raccords des tuiles (rose, pointillés) : un raccord visible se voit tout de suite.
  const seams = [1, 2].flatMap((i) => [`<line x1="${i * cell}" y1="0" x2="${i * cell}" y2="${cell * 3}"/>`, `<line x1="0" y1="${i * cell}" x2="${cell * 3}" y2="${i * cell}"/>`]).join("");
  parts.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell * 3}" height="${cell * 3}"><g stroke="${HIGHLIGHT}" stroke-opacity="0.55" stroke-width="2" stroke-dasharray="10 10">${seams}</g></svg>`), left: 0, top: 0 });
  const { data, info } = await sharp({ create: { width: cell * 3, height: cell * 3, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite(parts)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return toRaster({ data, info });
}

/* ---- Écriture d'un PSD (composite sur disque, RLE ligne à ligne) --------------- */

async function writePsdFile(role: KitRole, children: Layer[], outFile: string, workDir: string, compositeOut?: string): Promise<number> {
  const size = DOC(role);
  const flat: { r: Raster; x: number; y: number }[] = [];
  const collect = (list: Layer[]) => {
    for (const l of list) {
      if (l.children) collect(l.children);
      else if (l.imageData) flat.push({ r: l.imageData as Raster, x: l.left ?? 0, y: l.top ?? 0 });
    }
  };
  collect(children);
  await mkdir(workDir, { recursive: true });
  await purgeStaleComposites(workDir);
  const compositeFile = path.join(workDir, `kit-composite-${process.pid}-${Date.now()}.v`);
  try {
    await sharp({ create: { width: size.width, height: size.height, channels: 3, background: { r: 214, g: 216, b: 221 } } })
      .composite(flat.map(({ r, x, y }) => ({ ...rawInput(r), left: x, top: y })))
      .toFile(compositeFile);
    const vh = await sharp(compositeFile).metadata();
    if (vh.width !== size.width || vh.height !== size.height || !vh.channels || vh.channels < 3 || vh.depth !== "uchar") throw new Error(`composite : format inattendu (${vh.width} × ${vh.height}, ${vh.channels} canaux, ${vh.depth})`);
    flat.length = 0;
    memStep(`${role} : composite`);
    gc();
    // Document déclaré en 1 × 1 à l'écriture (ag-psd alloue sinon 12 octets par pixel), vraie taille réécrite dans l'en-tête.
    const psd: Psd = { width: 1, height: 1, children };
    const blank = writePsdBuffer(psd, { noBackground: true });
    children.length = 0;
    gc();
    memStep(`${role} : PSD écrit`);
    const head = Buffer.from(psdWithoutComposite(blank));
    head.writeUInt32BE(size.height, 14);
    head.writeUInt32BE(size.width, 18);
    const buffer = Buffer.concat([head, await compositeRle(compositeFile, vh.channels, size)]);
    memStep(`${role} : composite RLE`);
    if (compositeOut) await sharp(compositeFile).png({ compressionLevel: 1 }).toFile(compositeOut);
    await writeFile(outFile, buffer);
    return buffer.length;
  } finally {
    await rm(compositeFile, { force: true });
  }
}

/* ---- Construction ------------------------------------------------------------- */

export type MultiBuildOptions = BuildOptions & {
  /** Dossier où écrire les trois PSD. */
  outDir: string;
  /** Rôles à construire (défaut : les trois) — les tests n'en construisent parfois qu'un. */
  roles?: KitRole[];
  /** Captures : composite de chaque fichier en PNG dans ce dossier (`<rôle>.png`). */
  compositeDir?: string;
};

export type MultiBuildResult = { files: { role: KitRole; file: string; path: string; bytes: number }[]; stats: KitBuildStats; manifest: KitManifest };

export async function buildKitMulti(theme: Theme, publicDir: string, opts: MultiBuildOptions): Promise<MultiBuildResult> {
  ensureAgPsd();
  sharp.cache(false);
  sharp.concurrency(1);
  const fontFile = path.join(/* turbopackIgnore: true */ publicDir, "kit", "Figtree.ttf");
  const prefilled: string[] = [];
  const placeholders: string[] = [];
  const manifest: KitManifest = { exportId: opts.exportId, themeId: theme.id, themeVersion: opts.themeVersion, kitVersion: KIT_V4_VERSION, slots: {}, previews: {}, hotspots: {} };
  if (opts.manifestDir) await mkdir(opts.manifestDir, { recursive: true });
  await mkdir(opts.outDir, { recursive: true });
  const workDir = opts.manifestDir ? path.dirname(opts.manifestDir) : os.tmpdir();
  let layerCount = 0;

  /** Empreinte telle que l'import la recalculera, aperçu « avant » ; le raster n'est plus utilisé ensuite. */
  const record = async (id: string, raster: Raster, wide: boolean) => {
    const imported = asImported({ width: raster.width, height: raster.height, data: Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.length) });
    manifest.slots[id] = { hash: frameHash(imported) };
    if (opts.manifestDir) {
      const file = `${opts.exportId}--${id.replace(/\//g, "--")}.png`;
      await writePreview(imported, path.join(opts.manifestDir, file), wide);
      manifest.previews![id] = file;
    }
  };

  const slotLayer = async (slot: SlotSpec): Promise<Layer> => {
    const d = slot.draw!;
    let raster: Raster | null = null;
    const drawn = opts.assets?.[slot.id];
    if (drawn) {
      raster = await drawnRaster(slot, drawn, theme);
      prefilled.push(slot.id);
    }
    if (!raster && slot.kind === "signature") {
      raster = await signatureRaster(theme, opts.siteName, publicDir, drawSlot(slot), drawScale(slot));
      placeholders.push(slot.id);
    }
    if (!raster) {
      raster = await rasterSvg(currentLookSvg(slot, theme, drawScale(slot)), d.w, d.h);
      placeholders.push(slot.id);
    }
    await record(slot.id, raster, false);
    const f = frameOf(slot, "multi");
    // Lot 121 : le fond du badge (option) est masqué au départ ; importé tel quel, il reste « inchangé ».
    return layerAt(slot.layer, f.x, f.y, raster, slot.kind === "vbadge" ? { hidden: true } : {});
  };

  /** Plan n du décor (1 = le plus lointain) en grand : plan dessiné du kit, sinon calque SVG du thème, sinon gabarit. */
  const planRaster = async (n: number): Promise<{ raster: Raster; from: "kit" | "theme" | "gabarit" }> => {
    const W = DECOR_CANVAS.width;
    const H = DECOR_CANVAS.height;
    const drawn = opts.assets?.[`hero/plan-${n}`];
    if (drawn) {
      const w = Math.min(W, drawn.w * DECOR_SCALE);
      const h = Math.min(H, drawn.h * DECOR_SCALE);
      const piece = await renderFile(drawn.file, w, h);
      const { data, info } = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: piece, raw: { width: w, height: h, channels: 4 }, left: (drawn.x ?? 0) * DECOR_SCALE, top: (drawn.y ?? 0) * DECOR_SCALE }])
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { raster: toRaster({ data, info }), from: "kit" };
    }
    const layer = theme.assets.heroLayers?.[n - 1];
    if (layer && !theme.assets.kit?.plansOnly) {
      const buf = await renderFile(path.join(/* turbopackIgnore: true */ publicDir, layer.replace(/^\//, "")), W, H);
      return { raster: { width: W, height: H, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) }, from: "theme" };
    }
    const spec = SLOTS.find((s) => s.id === `hero/plan-${Math.min(n, 5)}`)!;
    return { raster: await rasterSvg(currentLookSvg(spec, theme, DECOR_SCALE), W, H), from: "gabarit" };
  };

  const identityLayer = async (role: KitRole): Promise<Layer> => {
    const text = await textRaster(`<span foreground="#6b7078">identifiant du kit :\n${opts.exportId}\nfichier ${KIT_ROLES.indexOf(role) + 1} sur 3\n(ne pas supprimer)</span>`, fontFile, 22);
    const doc = DOC(role);
    return layerAt(`${EXPORT_ID_PREFIX}${opts.exportId} · role-${role} — ne pas supprimer`, doc.width - text.width - 60, HEAD(role) - 20 - text.height - 14, text, LOCKED);
  };

  const files: MultiBuildResult["files"] = [];
  for (const role of opts.roles ?? KIT_ROLES) {
    const children: Layer[] = [];
    const guides: Layer[] = [];
    if (role === "decor") {
      // Plans du décor actuel, du fond (en bas de la pile) vers l'avant : calques de premier niveau, libres.
      const kitPlans = theme.assets.kit?.plans ?? [];
      const own = theme.assets.kit?.plansOnly ? kitPlans.length : Math.max(kitPlans.length, theme.assets.heroLayers?.length ?? 0);
      const count = Math.min(MAX_DECOR_PLANS, own > 0 ? own : 5);
      for (let n = 1; n <= count; n++) {
        const { raster, from } = await planRaster(n);
        (from === "gabarit" ? placeholders : prefilled).push(`hero/plan-${n}`);
        await record(`hero/plan-${n}`, raster, true);
        const name = n === 1 ? "Plan 1 — le plus lointain (ciel)" : n === count ? `Plan ${n} — premier plan` : `Plan ${n}`;
        children.push(layerAt(name, 0, DECOR_HEAD, raster));
        gc();
        memStep(`décor : plan ${n}`);
      }
      // Repères : cadre du décor (4 traits), zone du titre.
      const W = DECOR_CANVAS.width;
      const H = DECOR_CANVAS.height;
      const hex = Uint8ClampedArray.from([0xd0, 0x00, 0x6f, 0xff]);
      const solid = (w: number, h: number): Raster => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i += 4) data.set(hex, i);
        return { width: w, height: h, data };
      };
      guides.push(layerAt("repère · haut du décor", 0, DECOR_HEAD, solid(W, 8), LOCKED), layerAt("repère · bas du décor", 0, DECOR_HEAD + H - 8, solid(W, 8), LOCKED), layerAt("repère · gauche du décor", 0, DECOR_HEAD, solid(8, H), LOCKED), layerAt("repère · droite du décor", W - 8, DECOR_HEAD, solid(8, H), LOCKED));
      const tz = { x: TITLE_ZONE.x * DECOR_SCALE, y: TITLE_ZONE.y * DECOR_SCALE, w: TITLE_ZONE.w * DECOR_SCALE, h: TITLE_ZONE.h * DECOR_SCALE };
      const zone = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tz.w}" height="${tz.h}"><rect x="3" y="3" width="${tz.w - 6}" height="${tz.h - 6}" fill="none" stroke="${HIGHLIGHT}" stroke-width="6" stroke-dasharray="36 20"/></svg>`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      guides.push(layerAt("repère · zone du titre", tz.x, DECOR_HEAD + tz.y, toRaster(zone), LOCKED));
      const zl = await textRaster(`<span foreground="${HIGHLIGHT}" background="#ffffffcc"> Zone du titre : décor calme (le nom s'affiche ici) </span>`, fontFile, TEXT.label);
      guides.push(layerAt("repère · légende de la zone du titre", tz.x + 24, DECOR_HEAD + tz.y + 20, zl, LOCKED));
    } else {
      const roleSlots = slotsOfRole(role);
      const cards = MULTI_CARDS.filter((cd) => cd.role === role);
      // Ordre ag-psd : du bas vers le haut. Dernière carte au fond, première en haut.
      for (const card of [...cards].reverse()) {
        const raster = await cardRaster(card, theme, fontFile);
        const inner: Layer[] = [layerAt(PREVIEW_LAYER, card.board.x, card.board.y, raster, LOCKED)];
        const slots = roleSlots.filter((s) => s.element === card.element);
        const stack = card.element === "icones" || card.element === "curseur" ? [...slots].reverse() : slots;
        for (const s of stack) {
          if (s.kind !== "cursor") {
            inner.push(await slotLayer(s));
            continue;
          }
          // Curseur : un groupe « Normal » / « Clic » = le dessin et le repère du point chaud (au-dessus).
          const drawing = await slotLayer(s);
          drawing.name = CURSOR_DRAWING_LAYER;
          const asset = opts.assets?.[s.id];
          const hs = asset?.x !== undefined && asset.y !== undefined ? { x: asset.x * 2, y: asset.y * 2 } : CURSOR_DEFAULT_HOTSPOT[s.cursor!];
          manifest.hotspots![s.id] = hs;
          const k = drawScale(s);
          const f = frameOf(s, "multi");
          const ring = await hotspotRaster(k);
          const cx = f.x + hs.x * k + k / 2;
          const cy = f.y + hs.y * k + k / 2;
          const marker = layerAt(HOTSPOT_LAYER, Math.round(cx - ring.width / 2), Math.round(cy - ring.height / 2), ring);
          inner.push({ name: s.layer, opened: true, children: [drawing, marker] });
        }
        children.push({ name: card.group, opened: true, children: inner });
        guides.unshift(layerAt(`repères · ${card.group}`, card.board.x, card.board.y, await guidesRaster(card), LOCKED));
        gc();
        memStep(card.group);
      }
      // Papier : aperçu 3 × 3 (calque verrouillé) à côté de la tuile.
      if (role === "logo") {
        const group = children.find((g) => g.name === "2 · Papier")!;
        const tileLayer = group.children!.find((l) => l.name === ALL_SLOTS.find((s) => s.id === "papier")!.layer)!;
        const tile = tileLayerRaster(tileLayer);
        const card = cards.find((cd) => cd.element === "papier")!;
        const pf = papierPreviewFrame(card);
        const prev = await tilePreview(tile);
        group.children!.push(layerAt("Aperçu 3 × 3 — ne pas modifier", card.board.x + pf.x, card.board.y + pf.y, prev, LOCKED));
      }
    }
    guides.push(await identityLayer(role));
    children.push({ name: GUIDES_GROUP, opened: false, ...LOCKED, children: guides });
    children.push(layerAt(README_LAYER, 20, 10, await headerRaster(role, theme, opts.siteName, fontFile), LOCKED));
    layerCount += countLayers(children);
    const outFile = path.join(opts.outDir, KIT_FILES[role].file);
    if (opts.compositeDir) await mkdir(opts.compositeDir, { recursive: true });
    const bytes = await writePsdFile(role, children, outFile, workDir, opts.compositeDir ? path.join(opts.compositeDir, `${role}.png`) : undefined);
    files.push({ role, file: KIT_FILES[role].file, path: outFile, bytes });
    gc();
    memStep(`${role} : écrit (${Math.round(bytes / 1048576)} Mo)`);
  }
  if (opts.manifestDir) await saveManifest(opts.manifestDir, manifest);
  return { files, stats: { layers: layerCount, prefilled, placeholders, exportId: opts.exportId }, manifest };
}

const countLayers = (list: Layer[]): number => list.reduce((n, l) => n + (l.children ? countLayers(l.children) : 1), 0);

/** Raster d'une couche (case de la tuile, déjà rognée à son contenu = la case entière : opaque). */
function tileLayerRaster(layer: Layer): Raster {
  return layer.imageData as unknown as Raster;
}

