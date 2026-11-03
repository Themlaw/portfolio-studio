/**
 * Import d'un kit PSD (job « kit-import » de la file lourde, processus enfant).
 *
 * 1. Préalable SANS décodage (psd-header.ts) : taille, PSB, RVB, 8 bits,
 *    dimensions (kit v2 ou v1), nombre et surface des calques.
 * 2. Lecture ag-psd en `useRawData` : structure seule, pixels encore
 *    compressés ; emplacements résolus par nom (resolve.ts), chaque calque
 *    décodé à son tour puis libéré, aplati et replacé dans sa boîte.
 * 3. Empreinte de chaque emplacement comparée au kit d'origine (manifest.ts) :
 *    inchangé → pas reconverti ; redessiné → contrôles, rognage, choix du
 *    format (SVG si ≤ 1,5 × AVIF et ≤ 500 chemins ; textures et tuile en
 *    bitmap ; formes d'une couleur en masque SVG), ThumbHash des plans,
 *    raccord et répétition du papier, aperçu « après », palette suggérée.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { PathSimplifyMode } from "@neplex/vectorizer";
import { readPsd, type Layer } from "ag-psd";
import sharp from "sharp";

import { ensureAgPsd } from "./ag-psd-node";
import { alphaBox, contourFidelity, crop, encodeBitmap, monoStats, opaqueShare, reduceTo, seamStats, stretchableSvg, SVG_MAX_PATHS, SVG_MAX_RATIO, textureStats, thumbHashOf, TILE_REPEAT, tileRepeatStats, translucentShare, vectorizeLayer, type Rgba } from "./formats";
import { DAMAGED_FILE, preflightProblem, preflightPsd, PsdPreflightError, type PreflightLimits, type PsdPreflight } from "./psd-header";
import { assembleCornerSide, framePreview, isCornerSide } from "./frame9";
import { emptyFrameHash, findReference, frameHash, writePreview, type KitManifest } from "./manifest";
import { flattenSlot, freeRaw, layoutOf, resolveDecor, resolveSlots, SlotRefusal, treeProblem, treeStats, type TreeStats } from "./resolve";
import { DEFAULT_LIMITS } from "./limits";
import { compareSwatches, cursorWarning, encodeCursor, hotspotCss, readHotspot, readSwatchSlot, type ColorReport, type SwatchRead } from "./extras";
import { ALL_SLOTS, CURSOR_DEFAULT_HOTSPOT, CURSOR_SLOTS, decorSlot, drawScale, frameOf, HERO, keepsDrawnColors, KIT_FILES, KIT_ROLES, MAX_DECOR_PLANS, roleOfSize, SLOTS, slotsOfFile, slotsOfRole, SWATCH_SLOTS, type KitRole, type Layout, type SlotSpec } from "./spec";

/**
 * Fidélité exigée d'un tracé (mesurée sur kit-A, phase 6c) : écart moyen du
 * bord ≤ 0,6 px (pixels différents / longueur du contour d'origine). Le réglage
 * de la PoC (tracé réduit à 1920 px) donnait 0,70–1,03 px sur les plans (tremblé
 * « fait main » lissé) ; pleine résolution : 0,44–0,59 px ; AVIF : 0,02 px.
 * L'IoU n'est qu'indicatif : sur une forme fine (trait, icône) un écart de
 * 0,5 px la fait tomber à 0,93 sans défaut visible.
 */
export const MAX_EDGE_DEVIATION = 0.6;
const faithful = (f: { iou: number; deviation: number }) => f.deviation <= MAX_EDGE_DEVIATION;
const rounded = (f: { iou: number; deviation: number }) => ({ iou: Math.round(f.iou * 10000) / 10000, deviation: Math.round(f.deviation * 1000) / 1000 });
/** Tracé à pleine résolution (le document fait 2880 px de large au plus). */
const FULL = 4096;
/** Réglages vtracer retenus : spline fine (masques, couleurs), polygone (aplats). */
const FINE = { filterSpeckle: 1, cornerThreshold: 20, lengthThreshold: 1.5, spliceThreshold: 15, pathPrecision: 2 };
const POLYGON = { filterSpeckle: 1, mode: PathSimplifyMode.Polygon, pathPrecision: 1 };

export { DEFAULT_LIMITS };

/** Inchangé (même empreinte que le kit d'origine), redessiné, nouveau (pas de kit d'origine), absent. */
export type SlotChange = "unchanged" | "redrawn" | "new" | "missing";

/** Fichier d'où vient un emplacement : l'un des trois du kit v4, ou « mono » (ancien kit en un seul PSD). */
export type FileId = KitRole | "mono";
export type FileReport = { id: FileId; label: string; fileName?: string; received: boolean; slots: number };
/** Décor libre (kit v4) : nombre de plans lus, et si leur composition (nombre, ordre) diffère de l'export. */
export type DecorReport = { count: number; reference: boolean; structure: "unchanged" | "changed"; /** Plans du décor exporté. */ previous: number };

export type SlotReport = {
  id: string;
  /** Fichier du kit d'où vient l'emplacement. */
  file?: FileId;
  /** Décor libre : rang (0 = le plus lointain) du plan exporté dont celui-ci est la copie inchangée. */
  from?: number;
  label: string;
  status: "ok" | "warn" | "error";
  change: SlotChange;
  messages: string[];
  ms: number;
  /** Chemin du calque ou du groupe lu (« 6 · Icônes / Flèche droite »). */
  source?: string;
  /** Pic mémoire du processus (Mo) à la fin de cet emplacement (cumulatif). */
  peakMb?: number;
  /** Boîte retenue, relative à la zone de l'emplacement. */
  box?: { x: number; y: number; w: number; h: number };
  hash?: string;
  textured?: { coverage8: number; distinct: number };
  mono?: { spread: number };
  /** Logo : gardé tel quel (couleurs d'origine), pas en masque teinté par le thème (lot 61 : même d'une seule couleur). */
  colored?: boolean;
  seam?: { edge: number; interior: number; ratio: number };
  /** Répétition de la tuile : autocorrélation à une fraction de la période, contraste du motif (niveaux). */
  repeat?: { rho: number; contrast: number };
  candidates?: { svg?: number; svgPaths?: number; avif?: number; webp?: number };
  chosen?: "svg" | "svg-mask" | "avif" | "avif-mask" | "png";
  /** Curseur : point chaud (px CSS, image affichée à 32 × 32). */
  hotspot?: { x: number; y: number };
  /** Fidélité du contour du SVG candidat (IoU, écart moyen du bord en px). */
  fidelity?: { iou: number; deviation: number };
  /** Poids servi (format retenu ; AVIF : sans le repli WebP). */
  bytes?: number;
  files?: string[];
  /** Lot 99 : trait (barre de défilement) et flèches : le dessin en COULEURS D'ORIGINE (AVIF + WebP), en plus du masque teinté de `files`. */
  colorFiles?: string[];
  thumbhash?: string;
  /** Aperçu « après » (PNG réduit, dans le dossier de sortie). */
  preview?: string;
};

export type KitReport = {
  ok: boolean;
  preflight: PsdPreflight;
  problem?: string;
  layout?: Layout;
  exportId?: string | null;
  /** Kit d'origine reconnu (par l'identifiant du PSD ou par le contenu). */
  reference?: { exportId: string; themeId: string; how: "identifiant" | "contenu"; matches: number } | null;
  /** Kit reconnu mais exporté depuis un AUTRE thème que celui de l'écran d'envoi : appliqué à son thème d'origine par défaut. */
  foreign?: { exportId: string; themeId: string } | null;
  /** Arbre recompté après lecture (fait foi sur l'en-tête). */
  tree?: TreeStats;
  readMs?: number;
  /** Pic mémoire juste après la lecture ag-psd (Mo). */
  afterReadMb?: number;
  /** Mémoire résidente courante après libération du PSD, avant les encodages (Mo). */
  afterFreeMb?: number;
  peakMb?: number;
  slots: SlotReport[];
  ignoredLayers: string[];
  totals?: { firstView: number; all: number };
  /** Kit v3 : couleurs des pastilles de « 8 · Palette » (absent : pas de groupe Palette dans ce kit). */
  colors?: ColorReport[];
  /** Kit v3 : groupes présents dans le fichier (un ancien kit n'a ni palette ni curseurs). */
  extras?: { palette: boolean; cursors: boolean };
  /** Fichiers du kit (v4 : les trois, reçus ou non ; ancien kit : un seul). */
  files?: FileReport[];
  /** Kit v4 : le décor libre. */
  decor?: DecorReport;
};

export const FIRST_VIEW = new Set(["hero/plan-1", "hero/plan-2", "hero/plan-3", "hero/plan-4", "hero/plan-5", "signature", "papier"]);
export const slotFileBase = (id: string) => id.replace(/\//g, "--");

/** Effets de calque Photoshop, en français (panneau Style de calque). */
const EFFECTS: Record<string, string> = {
  dropShadow: "Ombre portée",
  innerShadow: "Ombre interne",
  outerGlow: "Lueur externe",
  innerGlow: "Lueur interne",
  bevel: "Biseautage et estampage",
  satin: "Satin",
  solidFill: "Incrustation couleur",
  gradientOverlay: "Incrustation en dégradé",
  patternOverlay: "Incrustation de motif",
  stroke: "Contour",
};
const enabled = (e: unknown) => (Array.isArray(e) ? e.some((x) => x && (x as { enabled?: boolean }).enabled !== false) : Boolean(e) && typeof e === "object" && (e as { enabled?: boolean }).enabled !== false);

/** Effets, objet dynamique, texte : signalés (sur le calque et dans un groupe aplati). */
function layerWarnings(nodes: Layer[], warn: (m: string) => void, slotLabel: string) {
  for (const layer of nodes) {
    if (layer.children) {
      layerWarnings(layer.children, warn, slotLabel);
      continue;
    }
    const where = (layer.name ?? "").trim() === slotLabel ? slotLabel : `« ${layer.name} » (${slotLabel})`;
    const fx = Object.entries(layer.effects ?? {})
      .filter(([k, v]) => k in EFFECTS && enabled(v))
      .map(([k]) => EFFECTS[k]);
    if (fx.length) warn(`${fx.join(", ")} détecté${fx.length > 1 ? "s" : "e"} sur ${where} : non pris en compte, pixellise le calque dans Photoshop (Calque > Pixelliser > Style de calque).`);
    if (layer.placedLayer) warn(`Objet dynamique sur ${where} : pixellise-le dans Photoshop (Calque > Pixelliser > Objet dynamique) pour figer son rendu.`);
    if (layer.text) warn(`Calque de texte sur ${where} : pixellise-le dans Photoshop (Calque > Pixelliser > Texte) pour figer la police.`);
  }
}

/**
 * Lecture ag-psd : structure seule (pixels des calques encore compressés).
 * `totalMemoryLimit` borne ce qu'ag-psd décode LUI-MÊME pendant la lecture
 * (motifs Patt / Pat2 / Pat3, composite), sinon 2 Go par défaut.
 */
export const PSD_READ_OPTIONS = {
  useRawData: true,
  useImageData: true,
  skipCompositeImageData: true,
  skipThumbnail: true,
  skipLinkedFilesData: true,
  totalMemoryLimit: 64 << 20,
} as const;

/**
 * `themeId` : thème visé (seuls ses kits exportés servent de référence).
 * `simulatedTree` : TESTS seulement — remplace l'arbre lu par ag-psd, pour
 * prouver que le contrôle de l'arbre est bien appelé (test-kit-import).
 */
export type ImportOptions = {
  limits?: PreflightLimits;
  keepCrops?: boolean;
  manifests?: KitManifest[];
  themeId?: string;
  simulatedTree?: Layer[];
  /** Palette résolue du thème visé (src/themes/palette.ts) : référence des pastilles sans kit reconnu, fonds des curseurs. */
  palette?: Record<string, string>;
};

/** Un PSD à importer : chemin sur le disque, et son nom d'origine (affiché dans la revue). */
export { DAMAGED_FILE };

export type KitInput = string | { path: string; name?: string };

const gcNow = () => (globalThis as { gc?: () => void }).gc?.();
const rssMb = () => Math.round(process.memoryUsage().rss / 1024 / 1024);
const peakMbNow = () => Math.round(process.resourceUsage().maxRSS / 1024);

const fileRank = (f: FileId | undefined) => (f === "decor" ? 0 : f === "logo" ? 1 : f === "icones" ? 2 : 3);

/**
 * Import d'un kit : UN PSD (ancien kit mono-fichier v1/v2/v3, ou un fichier du
 * kit v4), ou plusieurs (les trois fichiers du kit v4, éventuellement en
 * partie). Chaque fichier est reconnu par la taille de son document et par le
 * rôle noté dans son identifiant (jamais par son nom de fichier). Les fichiers
 * sont lus l'un après l'autre : le PSD est libéré avant le suivant, le pic ne
 * dépend pas du nombre de fichiers.
 */
export async function importKit(input: KitInput | KitInput[], outDir: string, opts: ImportOptions = {}): Promise<KitReport> {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const inputs = (Array.isArray(input) ? input : [input]).map((i) => (typeof i === "string" ? { path: i, name: path.basename(i) } : { path: i.path, name: i.name ?? path.basename(i.path) }));
  const many = inputs.length > 1;
  const prefix = (name: string) => (many ? `« ${name} » : ` : "");

  // Préalable de chaque fichier, SANS décodage.
  type Known = { path: string; name: string; pre: PsdPreflight; layout: Layout; role: KitRole | null };
  const known: Known[] = [];
  for (const f of inputs) {
    let pre: PsdPreflight;
    try {
      pre = await preflightPsd(f.path, limits.maxLayers * 4);
    } catch (error) {
      if (!(error instanceof PsdPreflightError)) throw error;
      return { ok: false, preflight: EMPTY_PREFLIGHT, problem: `${prefix(f.name)}${error.message}`, slots: [], ignoredLayers: [] };
    }
    const problem = preflightProblem(pre, limits);
    if (problem) return { ok: false, preflight: pre, problem: `${prefix(f.name)}${problem}`, slots: [], ignoredLayers: [] };
    const layout = layoutOf(pre.width, pre.height)!;
    known.push({ ...f, pre, layout, role: layout === "multi" ? roleOfSize(pre.width, pre.height) : null });
  }
  if (many) {
    const legacy = known.find((k) => k.layout !== "multi");
    if (legacy) return { ok: false, preflight: legacy.pre, problem: `« ${legacy.name} » est un ancien kit en un seul fichier : envoie-le seul.`, slots: [], ignoredLayers: [] };
    const seen = new Set<KitRole>();
    for (const k of known) {
      if (seen.has(k.role!)) return { ok: false, preflight: k.pre, problem: `Deux fichiers sont « ${KIT_FILES[k.role!].label} » (« ${k.name} » en double) : envoie un seul exemplaire de chaque.`, slots: [], ignoredLayers: [] };
      seen.add(k.role!);
    }
    known.sort((a, b) => KIT_ROLES.indexOf(a.role!) - KIT_ROLES.indexOf(b.role!));
  }
  ensureAgPsd();

  await mkdir(outDir, { recursive: true });
  const slots: SlotReport[] = [];
  // Phase 1 : chaque emplacement est aplati dans sa case, réduit à sa taille
  // d'usage, son empreinte calculée, ses pixels mis de côté (RVBA brut sur
  // disque). Phase 2 : tous les PSD libérés, chaque emplacement redessiné est
  // contrôlé et encodé à son tour. Le pic ne dépend alors ni de la taille d'un
  // PSD ni du nombre de fichiers.
  const work = path.join(outDir, ".travail");
  await mkdir(work, { recursive: true });
  type Pending = { slot: SlotSpec; report: SlotReport; base: string; ms: number };
  const pending: Pending[] = [];
  type CursorPending = Pending & { hotspot: { x: number; y: number } };
  const cursorPending: CursorPending[] = [];
  const hashes = new Map<string, string>();
  const swatchReads: SwatchRead[] = [];
  const ignoredLayers: string[] = [];
  const fileReports: FileReport[] = [];
  let exportId: string | null = null;
  let idManifest: KitManifest | undefined;
  let tree: TreeStats | undefined;
  let readMs = 0;
  let afterReadMb = 0;
  let hasCursorGroup = false;
  let simulated = opts.simulatedTree;

  for (const file of known) {
    const { layout, role, pre } = file;
    const fid: FileId = role ?? "mono";
    const t0 = performance.now();
    let buffer: Buffer | null = await readFile(file.path);
    let psd: ReturnType<typeof readPsd> | null;
    try {
      psd = readPsd(buffer, { ...PSD_READ_OPTIONS });
    } catch {
      // Fichier tronqué ou abîmé : le décodage échoue (la cause est le fichier, pas le serveur).
      return { ok: false, preflight: pre, problem: `${prefix(file.name)}${DAMAGED_FILE}`, slots: [], ignoredLayers: [] };
    }
    if (simulated) {
      psd.children = simulated;
      simulated = undefined;
    }
    readMs += Math.round(performance.now() - t0);
    afterReadMb = Math.max(afterReadMb, peakMbNow());

    // Limites recomptées sur l'arbre réellement lu (blocs Lr16 / Lr32 compris),
    // avant tout décodage de pixels.
    const st = treeStats(psd.children);
    if (!tree || st.area > tree.area) tree = st;
    const treeRefusal = treeProblem(st, limits, { width: pre.width, height: pre.height });
    if (treeRefusal) return { ok: false, preflight: pre, problem: `${prefix(file.name)}${treeRefusal}`, tree: st, slots: [], ignoredLayers: [] };

    const warnFor = (report: SlotReport) => (m: string) => {
      if (!report.messages.includes(m)) report.messages.push(m);
      if (report.status === "ok") report.status = "warn";
    };
    const newReport = (slot: SlotSpec, extra: Partial<SlotReport> = {}): SlotReport => ({ id: slot.id, label: slot.kind === "signature" ? "Logo" : slot.label, status: "ok", change: "new", messages: [], ms: 0, file: fid, ...extra });

    if (role === "decor") {
      const dec = resolveDecor(psd.children);
      exportId ??= dec.exportId;
      if (dec.role && dec.role !== role) return { ok: false, preflight: pre, problem: `« ${file.name} » se déclare « ${KIT_FILES[dec.role].label} » mais a la taille du fichier « ${KIT_FILES[role].label} » : ne redimensionne pas le document.`, slots: [], ignoredLayers: [] };
      ignoredLayers.push(...dec.ignored);
      let n = 0;
      for (const source of dec.plans) {
        const start = performance.now();
        const placeholder = source.slot;
        const report = newReport(placeholder, { source: source.path });
        const warn = warnFor(report);
        const done = () => {
          report.ms = Math.round(performance.now() - start);
          report.peakMb = peakMbNow();
          slots.push(report);
        };
        layerWarnings(source.nodes, warn, placeholder.label);
        let flat: ReturnType<typeof flattenSlot>;
        try {
          flat = flattenSlot(source, layout, warn);
        } catch (error) {
          if (!(error instanceof SlotRefusal)) throw error;
          n++;
          const slot = decorSlot(n);
          slot.label = placeholder.label.replace(/^Plan \d+/, `Plan ${n}`);
          report.id = slot.id;
          report.label = slot.label;
          report.status = "error";
          report.messages.push(error.message);
          done();
          continue;
        }
        if (!flat || blank(flat.img)) {
          ignoredLayers.push(`${source.path} (calque vide ou hors du cadre du décor : ignoré)`);
          continue;
        }
        n++;
        if (n > MAX_DECOR_PLANS) return { ok: false, preflight: pre, problem: `${prefix(file.name)}Le décor compte plus de ${MAX_DECOR_PLANS} plans (calques ou groupes de premier niveau non vides) : fusionne des calques dans Photoshop.`, slots: [], ignoredLayers: [] };
        const slot = decorSlot(n);
        slot.label = placeholder.label.replace(/^Plan \d+/, `Plan ${n}`);
        report.id = slot.id;
        report.label = slot.label;
        if (flat.overflow) warn("Des pixels débordent du cadre du décor : ils sont coupés.");
        report.hash = frameHash(flat.img);
        hashes.set(`hero/plan-${n}`, report.hash);
        const small = await reduceTo(flat.img, slot.size.w, slot.size.h);
        flat = null;
        const base = slotFileBase(slot.id);
        await writeFile(path.join(work, `${base}.rgba`), small.data);
        pending.push({ slot, report, base, ms: performance.now() - start });
      }
      if (n === 0) ignoredLayers.push(`${file.name} : aucun plan dans le décor, il reste inchangé.`);
    } else {
      const { sources, ignored, exportId: id, role: marked } = resolveSlots(psd.children, layout, role);
      exportId ??= id;
      if (marked && role && marked !== role) return { ok: false, preflight: pre, problem: `« ${file.name} » se déclare « ${KIT_FILES[marked].label} » mais a la taille du fichier « ${KIT_FILES[role].label} » : ne redimensionne pas le document.`, slots: [], ignoredLayers: [] };
      ignoredLayers.push(...ignored);
      // Lot 83 : la case « Icône du site » n'existe que dans le kit v4 (et pas dans le fichier « logo » d'avant).
      const inFile = new Set(role ? slotsOfFile(role, pre.width, pre.height).map((s) => s.id) : ALL_SLOTS.filter((s) => !s.multiOnly).map((s) => s.id));

      for (const slot of SLOTS.filter((s) => inFile.has(s.id))) {
        const start = performance.now();
        const report = newReport(slot);
        const warn = warnFor(report);
        const done = () => {
          report.ms = Math.round(performance.now() - start);
          report.peakMb = peakMbNow();
          slots.push(report);
        };
        const source = sources.get(slot.id);
        if (!source) {
          report.change = "missing";
          warn(`Calque « ${slot.layer} » introuvable : l'élément actuel du thème est gardé.`);
          done();
          continue;
        }
        report.source = source.path;
        if (source.nodes.length === 1 && source.nodes[0].hidden) warn("Calque masqué dans le PSD : importé quand même.");
        layerWarnings(source.nodes, warn, slot.label);
        // Case vide : empreinte d'une case transparente (inchangée si le kit
        // d'origine l'était aussi, sinon l'élément actuel du thème est gardé).
        let flatOrNull: ReturnType<typeof flattenSlot>;
        try {
          flatOrNull = flattenSlot(source, layout, warn);
        } catch (error) {
          if (!(error instanceof SlotRefusal)) throw error;
          report.status = "error";
          report.messages.push(error.message);
          done();
          continue;
        }
        if (flatOrNull?.overflow) warn("Des pixels débordent de la case de l'emplacement : ils sont coupés.");
        report.hash = flatOrNull ? frameHash(flatOrNull.img) : emptyFrameHash(frameOf(slot, layout, source.boardOrigin).w * frameOf(slot, layout, source.boardOrigin).h * 4);
        hashes.set(slot.id, report.hash);
        const img = flatOrNull ? await reduceTo(flatOrNull.img, slot.size.w, slot.size.h) : { width: slot.size.w, height: slot.size.h, data: Buffer.alloc(slot.size.w * slot.size.h * 4) };
        flatOrNull = null;
        const base = slotFileBase(slot.id);
        await writeFile(path.join(work, `${base}.rgba`), img.data);
        pending.push({ slot, report, base, ms: performance.now() - start });
      }

      // Palette (anciens kits v3) et curseurs : lus seulement si leur groupe est là. La couleur
      // exportée (manifeste du kit d'origine, sinon couleur du thème) sert à repérer
      // les pixels repeints, même partiellement.
      idManifest ??= exportId ? (opts.manifests ?? []).find((m) => m.exportId === exportId) : undefined;
      for (const slot of SWATCH_SLOTS) {
        const source = sources.get(slot.id);
        if (!source) continue;
        try {
          swatchReads.push(readSwatchSlot(slot, source, layout, idManifest?.colors?.[slot.paletteKey!] ?? opts.palette?.[slot.paletteKey!]));
        } catch (error) {
          if (!(error instanceof SlotRefusal)) throw error;
          swatchReads.push({ slot, messages: [error.message] });
        }
      }
      for (const slot of CURSOR_SLOTS.filter((s) => inFile.has(s.id))) {
        const source = sources.get(slot.id);
        if (!source) continue;
        const start = performance.now();
        const report = newReport(slot, { source: source.path });
        const warn = warnFor(report);
        layerWarnings(source.nodes, warn, slot.label);
        let flat: ReturnType<typeof flattenSlot> = null;
        try {
          flat = flattenSlot(source, layout, warn);
        } catch (error) {
          if (!(error instanceof SlotRefusal)) throw error;
          report.status = "error";
          report.messages.push(error.message);
          report.ms = Math.round(performance.now() - start);
          slots.push(report);
          continue;
        }
        const img = flat ? await reduceTo(flat.img, slot.size.w, slot.size.h) : { width: slot.size.w, height: slot.size.h, data: Buffer.alloc(slot.size.w * slot.size.h * 4) };
        if (flat?.overflow) warn("Des pixels débordent de la case du curseur : ils sont coupés.");
        const hs = readHotspot(source, frameOf(slot, layout, source.boardOrigin), CURSOR_DEFAULT_HOTSPOT[slot.cursor!], layout === "multi" ? drawScale(slot) : 1);
        if (hs.message) warn(hs.message);
        const base = slotFileBase(slot.id);
        report.hash = flat ? frameHash(flat.img) : emptyFrameHash(frameOf(slot, layout).w * frameOf(slot, layout).h * 4);
        hashes.set(slot.id, report.hash);
        await writeFile(path.join(work, `${base}.rgba`), img.data);
        cursorPending.push({ slot, report, base, ms: performance.now() - start, hotspot: { x: hs.x, y: hs.y } });
      }
      hasCursorGroup ||= slotsOfRoleOrAll(role).some((s) => s.kind === "cursor" && sources.has(s.id));
    }
    fileReports.push({ id: fid, label: role ? KIT_FILES[role].label : "Kit en un seul fichier", fileName: file.name, received: true, slots: 0 });

    // PSD libéré avant le fichier suivant et avant les encodages lourds (AVIF d'un
    // plan pleine largeur). Toute référence aux données brutes disparaît : une
    // variable de boucle encore vivante dans le cadre suspendu de la fonction
    // (mesuré au heap snapshot) retenait sinon tout le PSD.
    freeRaw(psd.children);
    psd = null;
    buffer = null;
    // Plusieurs passes : la mémoire externe d'un ArrayBuffer est rendue au cycle suivant.
    for (let i = 0; i < 3; i++) {
      gcNow();
      await new Promise((r) => setImmediate(r));
    }
  }
  /** RSS courant (pas le pic) une fois les PSD libérés. */
  const afterFreeMb = rssMb();
  const extras = { palette: swatchReads.length > 0, cursors: cursorPending.length > 0 || hasCursorGroup || slots.some((s) => s.id.startsWith("curseur/")) };
  const multi = known[0].layout === "multi";
  if (multi) for (const r of KIT_ROLES) if (!fileReports.some((f) => f.id === r)) fileReports.push({ id: r, label: KIT_FILES[r].label, received: false, slots: 0 });
  fileReports.sort((a, b) => fileRank(a.id) - fileRank(b.id));
  // La revue de plusieurs fichiers dit lequel est passé.
  const layoutOut: Layout = known[0].layout;

  // Le kit d'origine est reconnu quel que soit l'écran où il est envoyé : le thème
  // visé par défaut est celui dont le kit a été exporté (`reference.themeId`), pas
  // celui de la page ; `foreign` n'est que l'avertissement d'un écart.
  const { reference: ref } = findReference(exportId, hashes, opts.manifests ?? [], undefined);
  const foreign = ref && opts.themeId !== undefined && ref.manifest.themeId !== opts.themeId ? ref : null;
  // Décor libre : plans exportés (empreintes `hero/plan-n`, dans l'ordre), pour reconnaître un plan inchangé même déplacé.
  const refPlans: string[] = [];
  if (ref) for (let i = 1; ref.manifest.slots[`hero/plan-${i}`]; i++) refPlans.push(ref.manifest.slots[`hero/plan-${i}`].hash);

  for (const { slot, report, base, ms } of pending) {
    const start = performance.now() - ms;
    const warn = (m: string) => {
      report.messages.push(m);
      if (report.status === "ok") report.status = "warn";
    };
    const done = () => {
      report.ms = Math.round(performance.now() - start);
      report.peakMb = peakMbNow();
      slots.push(report);
    };
    let framed: Rgba = { width: slot.size.w, height: slot.size.h, data: await readFile(path.join(work, `${base}.rgba`)) };
    if (ref) {
      if (slot.id.startsWith("decor/")) {
        const idx = refPlans.indexOf(report.hash!);
        report.change = idx >= 0 ? "unchanged" : "redrawn";
        if (idx >= 0) report.from = idx;
      } else report.change = ref.manifest.slots[slot.id]?.hash === report.hash ? "unchanged" : "redrawn";
    }
    if (report.change === "unchanged") {
      // Inchangé : rien à reconvertir, l'asset actuel du thème est gardé.
      done();
      continue;
    }
    // Cadre en 9 parties (lot 58) : option B (un coin + un côté) = cadre complet par rotation ; la revue montre le cadre sur 3 formats.
    if (slot.kind === "nine" && isCornerSide(framed)) {
      framed = assembleCornerSide(framed);
      report.messages.push("Option B : le coin et le côté dessinés ont été tournés pour fabriquer les 4 coins et les 4 côtés.");
    }
    if (slot.kind === "nine" && alphaBox(framed)) {
      await writeFile(path.join(outDir, `${base}.apres.png`), await framePreview(framed));
      report.messages.push("Aperçu sur trois formats (carré, panorama, portrait) : les coins restent tels quels, les côtés répètent le motif.");
    } else await writePreview(framed, path.join(outDir, `${base}.apres.png`), slot.kind === "plan");
    report.preview = `${base}.apres.png`;

    const box = alphaBox(framed);
    if (!box) {
      report.change = "missing";
      warn("Case vide : l'élément actuel du thème est gardé.");
      report.preview = undefined;
      done();
      continue;
    }
    report.box = box;
    const shareOpaque = opaqueShare(framed);
    if (!slot.transparent && shareOpaque < 0.995) warn(`${Math.round((1 - shareOpaque) * 100)} % de pixels transparents : cet emplacement doit être opaque.`);
    if (slot.kind === "plan" && slot.transparent && shareOpaque > 0.98 && !slot.firstPlan) {
      report.status = "error";
      report.messages.push("Plan entièrement opaque : il masquerait les plans du fond. Efface le ciel au-dessus du décor.");
      done();
      continue;
    }
    // Forme teintée (signature, trait, icônes) : seule la forme est gardée. Un logo collé avec son fond
    // opaque deviendrait un rectangle plein de la couleur du texte dans le bandeau.
    if (slot.mono && slot.transparent && shareOpaque > 0.98) {
      const msg = "Calque entièrement opaque : le site ne garde que la forme, qui serait un rectangle plein. Efface le fond autour du dessin (fond transparent).";
      if (slot.kind === "signature") {
        report.status = "error";
        report.messages.push(msg);
        done();
        continue;
      }
      warn(msg);
    }
    if (slot.kind === "plan" && slot.usefulHeight && box.y < HERO.height - slot.usefulHeight - 40) {
      warn(`Le décor monte à ${HERO.height - box.y} px depuis le bas, au-delà de la hauteur utile (${slot.usefulHeight} px) : il risque de passer derrière le titre.`);
    }

    // Rognage à la forme (plans, signature, trait, scotch) ; tuile, cadre et icônes : la boîte entière.
    const img = slot.crop ? crop(framed, box) : framed;
    const files: string[] = [];
    if (opts.keepCrops) await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).png().toFile(path.join(outDir, `${base}.source.png`));

    // Lot 99 : le trait (barre de défilement) et les flèches gardent AUSSI leurs couleurs : un masque teinté ne garde que la forme.
    const keepsColors = keepsDrawnColors(slot);
    const { avif, webp } = await encodeBitmap(img, slot.kind === "signature" || slot.kind === "tile" || slot.kind === "stroke" || slot.kind === "nine" || slot.kind === "appicon" || keepsColors);
    report.candidates = { avif: avif.length, webp: webp.length };
    const tex = textureStats(img);
    report.textured = { coverage8: Math.round(tex.coverage8 * 1000) / 1000, distinct: tex.distinct };
    if (slot.kind === "tile") {
      report.seam = seamStats(img);
      if (report.seam.ratio > 2) warn(`Raccord visible (écart aux bords ${report.seam.edge.toFixed(1)} contre ${report.seam.interior.toFixed(1)} à l'intérieur) : utilise Filtre > Autres > Translation pour vérifier.`);
      const rep = tileRepeatStats(img);
      report.repeat = { rho: Math.round(rep.rho * 100) / 100, contrast: Math.round(rep.contrast * 10) / 10 };
      if (rep.rho > TILE_REPEAT.rho && rep.contrast > TILE_REPEAT.contrast)
        warn(`La tuile se répète de façon visible : un motif à l'échelle de la tuile (autocorrélation ${report.repeat.rho} à une fraction de la période, contraste ${report.repeat.contrast} niveaux) dessine une grille une fois répété. Préfère un grain fin et sans forme, ou atténue le motif.`);
    }

    // Logo : il GARDE ses couleurs par défaut (lot 61 : « Garder mes couleurs »), même d'une seule couleur (lot 49 : seulement en plusieurs
    // couleurs, d'où un logo rouge redevenu noir sur le site, audit THEMES2-05). « Prendre la couleur du texte » se choisit dans l'éditeur de
    // thème : même fichier, rendu en masque teinté (variants.css), rien à renvoyer.
    const monoInfo = slot.mono ? monoStats(img) : null;
    const colored = slot.kind === "signature";
    if (monoInfo) report.mono = { spread: Math.round(monoInfo.spread * 10) / 10 };
    if (colored) {
      report.colored = true;
      report.messages.push(
        monoInfo?.mono
          ? "Logo d'une seule couleur : il garde sa couleur. Dans l'éditeur du thème, « Prendre la couleur du texte » le teinte comme le texte."
          : "Logo en plusieurs couleurs : il garde ses couleurs d'origine (il ne prend pas la couleur du thème).",
      );
    }
    if (slot.mono && !colored) {
      const m = monoInfo!;
      if (keepsColors) {
        report.messages.push(
          slot.kind === "stroke"
            ? "La barre de défilement des planches garde tes couleurs d'origine, exactement comme dessinées. Le soulignement et les filets du site ne gardent que la forme (teinte du thème)."
            : "La flèche garde ses couleurs d'origine, à la taille dessinée, sans carré ajouté autour.",
        );
      } else if (!m.mono) warn("Plusieurs couleurs : seule la forme est gardée (elle prend la couleur du thème).");
      const v = await vectorizeLayer(img, "mask", undefined, FINE, FULL);
      report.candidates.svg = Buffer.byteLength(v.svg);
      report.candidates.svgPaths = v.paths;
      const fid = await contourFidelity(img, v.svg);
      report.fidelity = rounded(fid);
      // Trait : étiré dans les deux sens (soulignement, filet, barre du rail).
      await writeFile(path.join(outDir, `${base}.mask.svg`), slot.kind === "stroke" ? stretchableSvg(v.svg) : v.svg);
      if (faithful(fid)) {
        report.chosen = "svg-mask";
        report.bytes = report.candidates.svg;
        files.push(`${base}.mask.svg`);
      } else {
        // Masque bitmap (alpha de l'AVIF / du WebP) : mask-image l'accepte aussi.
        report.chosen = "avif-mask";
        report.bytes = avif.length;
        report.messages.push(`Contour trop simplifié par le tracé (écart ${fid.deviation.toFixed(2)} px) : masque gardé en bitmap.`);
      }
    } else if (slot.bitmapOnly || tex.textured || translucentShare(img) > 0.2) {
      report.chosen = "avif";
      report.bytes = avif.length;
      if (!slot.bitmapOnly) report.messages.push(tex.textured ? "Texture ou dégradé : gardé en bitmap." : "Transparence partielle : gardée en bitmap (un tracé vectoriel la perdrait).");
    } else {
      // Aplat d'une seule couleur (bords exceptés) : forme tracée sur l'alpha, net et sans liseré.
      const flat = !colored && tex.coverage1 >= 0.97;
      const v = flat ? await vectorizeLayer(img, "flat", tex.dominant, POLYGON, FULL) : await vectorizeLayer(img, "color", undefined, FINE, FULL);
      if (flat) report.messages.push(`Aplat ${tex.dominant} : tracé de la forme.`);
      report.candidates.svg = Buffer.byteLength(v.svg);
      report.candidates.svgPaths = v.paths;
      const fid = await contourFidelity(img, v.svg);
      report.fidelity = rounded(fid);
      const light = report.candidates.svg <= SVG_MAX_RATIO * avif.length && v.paths <= SVG_MAX_PATHS;
      const svgWins = light && faithful(fid);
      if (light && !svgWins) report.messages.push(`Contour trop simplifié par le tracé (écart ${fid.deviation.toFixed(2)} px) : gardé en AVIF malgré un SVG plus léger.`);
      report.chosen = svgWins ? "svg" : "avif";
      report.bytes = svgWins ? report.candidates.svg : avif.length;
      await writeFile(path.join(outDir, `${base}.svg`), v.svg);
      if (svgWins) files.push(`${base}.svg`);
    }
    await writeFile(path.join(outDir, `${base}.avif`), avif);
    await writeFile(path.join(outDir, `${base}.webp`), webp);
    if (report.chosen === "avif" || report.chosen === "avif-mask") files.push(`${base}.avif`, `${base}.webp`);
    report.files = files;
    if (keepsColors) {
      report.colorFiles = [`${base}.avif`, `${base}.webp`];
    }

    if (slot.kind === "plan") report.thumbhash = await thumbHashOf(img);
    done();
  }

  // Décor libre : le même nombre de plans, dans le même ordre, tous inchangés = rien à faire.
  const decorSlots = slots.filter((s) => s.id.startsWith("decor/"));
  const decor: DecorReport | undefined = fileReports.some((f) => f.id === "decor" && f.received) && decorSlots.length
    ? {
        count: decorSlots.length,
        reference: Boolean(ref) && refPlans.length > 0,
        structure: ref && refPlans.length === decorSlots.length && decorSlots.every((s, i) => s.change === "unchanged" && s.from === i) ? "unchanged" : "changed",
        previous: refPlans.length,
      }
    : undefined;

  // Couleurs des pastilles : changées → forcées à l'application.
  const colors = extras.palette ? compareSwatches(swatchReads, ref?.manifest ?? null, opts.palette) : undefined;
  // Curseurs : fonds sur lesquels ils doivent se voir (couleurs repeintes comprises).
  const ground = (k: string) => colors?.find((c) => c.key === k && c.change === "changed")?.after ?? opts.palette?.[k];
  const grounds: { hex: string; label: string }[] = [];
  for (const [k, label] of [
    ["bg", "le fond"],
    ["bgDeep", "le fond profond"],
    ["surface", "la surface"],
  ]) {
    const hex = ground(k);
    if (hex && /^#[0-9a-f]{6}$/i.test(hex)) grounds.push({ hex, label });
  }
  for (const { slot, report, base, ms, hotspot } of cursorPending) {
    const start = performance.now() - ms;
    const warn = (m: string) => {
      report.messages.push(m);
      if (report.status === "ok") report.status = "warn";
    };
    const framed: Rgba = { width: slot.size.w, height: slot.size.h, data: await readFile(path.join(work, `${base}.rgba`)) };
    const hsBefore = ref?.manifest.hotspots?.[slot.id];
    if (ref) report.change = ref.manifest.slots[slot.id]?.hash === report.hash && hsBefore?.x === hotspot.x && hsBefore?.y === hotspot.y ? "unchanged" : "redrawn";
    if (report.change !== "unchanged") {
      if (!alphaBox(framed)) {
        report.change = "missing";
        warn("Case vide : le curseur actuel est gardé.");
      } else {
        await writePreview(framed, path.join(outDir, `${base}.apres.png`), false);
        report.preview = `${base}.apres.png`;
        const { png, png2x } = await encodeCursor(framed);
        await writeFile(path.join(outDir, `${base}.png`), png);
        await writeFile(path.join(outDir, `${base}.2x.png`), png2x);
        report.files = [`${base}.png`, `${base}.2x.png`];
        report.chosen = "png";
        report.bytes = png2x.length;
        report.hotspot = hotspotCss(hotspot);
        const problem = cursorWarning(framed, grounds);
        if (problem) warn(problem);
      }
    }
    report.ms = Math.round(performance.now() - start);
    report.peakMb = peakMbNow();
    slots.push(report);
  }

  await rm(work, { recursive: true, force: true });
  // Ordre : fichier par fichier, puis ordre de la spec (les emplacements absents ou en erreur sont arrivés en phase 1).
  // Kit v4 : l'ordre des cartes dans le fichier (de haut en bas, de gauche à droite).
  const order = (s: SlotReport) => {
    if (s.id.startsWith("decor/")) return Number(s.id.slice(6));
    const at = ALL_SLOTS.find((x) => x.id === s.id)?.at;
    return at ? 100 + at.y * 4000 + at.x : 100 + ALL_SLOTS.findIndex((x) => x.id === s.id);
  };
  slots.sort((x, y) => fileRank(x.file) - fileRank(y.file) || order(x) - order(y));
  for (const f of fileReports) f.slots = slots.filter((s) => s.file === f.id).length;
  const totals = {
    firstView: slots.filter((s) => FIRST_VIEW.has(s.id) || s.id.startsWith("decor/")).reduce((a, s) => a + (s.bytes ?? 0), 0),
    all: slots.reduce((a, s) => a + (s.bytes ?? 0), 0),
  };
  const report: KitReport = {
    ok: !slots.some((s) => s.status === "error"),
    preflight: known[0].pre,
    layout: layoutOut,
    exportId,
    reference: ref ? { exportId: ref.manifest.exportId, themeId: ref.manifest.themeId, how: ref.how, matches: ref.matches } : null,
    foreign: foreign ? { exportId: foreign.manifest.exportId, themeId: foreign.manifest.themeId } : null,
    tree,
    readMs,
    afterReadMb,
    afterFreeMb,
    peakMb: peakMbNow(),
    slots,
    ignoredLayers,
    totals,
    files: fileReports,
    ...(decor ? { decor } : {}),
    ...(colors ? { colors } : {}),
    extras,
  };
  await writeFile(path.join(outDir, "rapport.json"), JSON.stringify(report, null, 2));
  return report;
}

/** Aucun pixel visible (alpha ≤ 8 partout). */
const blank = (img: Rgba) => {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 8) return false;
  return true;
};
const slotsOfRoleOrAll = (role: KitRole | null) => (role ? slotsOfRole(role) : ALL_SLOTS);
const EMPTY_PREFLIGHT: PsdPreflight = { fileBytes: 0, version: 1, channels: 0, width: 0, height: 0, depth: 0, colorMode: 0, layerCount: 0, layerArea: 0, largestLayer: 0 };

/**
 * Manifeste d'un kit déjà envoyé (kit v1 sans identifiant, ou PSD d'origine
 * retrouvé) : empreinte de chaque emplacement, lue comme à l'import, et
 * aperçus « avant » dans `previewDir` (facultatif).
 */
export async function manifestFromPsd(psdPath: string, meta: { exportId: string; themeId: string; themeVersion: string }, previewDir?: string): Promise<KitManifest> {
  ensureAgPsd();
  const pre = await preflightPsd(psdPath);
  const layout = layoutOf(pre.width, pre.height);
  if (!layout) throw new Error(`taille de document inconnue : ${pre.width} × ${pre.height}`);
  const psd = readPsd(await readFile(psdPath), { ...PSD_READ_OPTIONS });
  const { sources } = resolveSlots(psd.children, layout);
  const manifest: KitManifest = { ...meta, kitVersion: layout === "v1" ? 1 : pre.height === 4000 ? 2 : 3, slots: {}, previews: {} };
  if (previewDir) await mkdir(previewDir, { recursive: true });
  for (const slot of SLOTS) {
    const source = sources.get(slot.id);
    if (!source) continue;
    const flat = flattenSlot(source, layout, () => {});
    if (!flat) continue;
    manifest.slots[slot.id] = { hash: frameHash(flat.img) };
    if (previewDir) {
      const file = `${meta.exportId}--${slotFileBase(slot.id)}.png`;
      await writePreview(flat.img, path.join(previewDir, file), slot.kind === "plan");
      manifest.previews![slot.id] = file;
    }
  }
  freeRaw(psd.children);
  return manifest;
}
