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
import { alphaBox, contourFidelity, crop, encodeBitmap, monoStats, opaqueShare, seamStats, stretchableSvg, SVG_MAX_PATHS, SVG_MAX_RATIO, textureStats, thumbHashOf, TILE_REPEAT, tileRepeatStats, translucentShare, vectorizeLayer, type Rgba } from "./formats";
import { suggestPalette, type PaletteSuggestion } from "./palette";
import { preflightProblem, preflightPsd, type PreflightLimits, type PsdPreflight } from "./psd-header";
import { findReference, frameHash, writePreview, type KitManifest } from "./manifest";
import { flattenSlot, freeRaw, layoutOf, resolveSlots, SlotRefusal, treeProblem, treeStats, type TreeStats } from "./resolve";
import { DEFAULT_LIMITS } from "./limits";
import { compareSwatches, cursorWarning, encodeCursor, hotspotCss, readHotspot, readSwatchSlot, type ColorReport, type SwatchRead } from "./extras";
import { ALL_SLOTS, CURSOR_DEFAULT_HOTSPOT, CURSOR_SLOTS, frameOf, HERO, SLOTS, SWATCH_SLOTS, type Layout, type SlotSpec } from "./spec";

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

export type SlotReport = {
  id: string;
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
  palette?: PaletteSuggestion | null;
  totals?: { firstView: number; all: number };
  /** Kit v3 : couleurs des pastilles de « 8 · Palette » (absent : pas de groupe Palette dans ce kit). */
  colors?: ColorReport[];
  /** Kit v3 : groupes présents dans le fichier (un ancien kit n'a ni palette ni curseurs). */
  extras?: { palette: boolean; cursors: boolean };
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

export async function importKit(psdPath: string, outDir: string, opts: ImportOptions = {}): Promise<KitReport> {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const preflight = await preflightPsd(psdPath, limits.maxLayers * 4);
  const problem = preflightProblem(preflight, limits);
  if (problem) return { ok: false, preflight, problem, slots: [], ignoredLayers: [] };
  const layout = layoutOf(preflight.width, preflight.height)!;

  ensureAgPsd();
  const t0 = performance.now();
  let buffer: Buffer | null = await readFile(psdPath);
  let psd: ReturnType<typeof readPsd> | null = readPsd(buffer, { ...PSD_READ_OPTIONS });
  if (opts.simulatedTree) psd.children = opts.simulatedTree;
  const readMs = Math.round(performance.now() - t0);
  const afterReadMb = Math.round(process.resourceUsage().maxRSS / 1024);

  // Limites recomptées sur l'arbre réellement lu (blocs Lr16 / Lr32 compris),
  // avant tout décodage de pixels.
  const tree = treeStats(psd.children);
  const treeRefusal = treeProblem(tree, limits, { width: preflight.width, height: preflight.height });
  if (treeRefusal) return { ok: false, preflight, problem: treeRefusal, tree, slots: [], ignoredLayers: [] };
  const { sources, ignored: ignoredLayers, exportId } = resolveSlots(psd.children, layout);

  await mkdir(outDir, { recursive: true });
  const slots: SlotReport[] = [];
  // Phase 1 : chaque emplacement est aplati dans sa boîte, son empreinte
  // calculée, ses pixels mis de côté (RVBA brut sur disque). Phase 2 : le PSD
  // libéré, chaque emplacement redessiné est contrôlé et encodé à son tour.
  // Le pic ne dépend alors plus de la taille du PSD.
  const work = path.join(outDir, ".travail");
  await mkdir(work, { recursive: true });
  type Pending = { slot: SlotSpec; report: SlotReport; base: string; ms: number };
  const pending: Pending[] = [];
  const hashes = new Map<string, string>();

  for (const slot of SLOTS) {
    const start = performance.now();
    const report: SlotReport = { id: slot.id, label: slot.label, status: "ok", change: "new", messages: [], ms: 0 };
    const warn = (m: string) => {
      if (!report.messages.includes(m)) report.messages.push(m);
      if (report.status === "ok") report.status = "warn";
    };
    const done = () => {
      report.ms = Math.round(performance.now() - start);
      report.peakMb = Math.round(process.resourceUsage().maxRSS / 1024);
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
    const flat = flatOrNull ?? { img: { width: slot.size.w, height: slot.size.h, data: Buffer.alloc(slot.size.w * slot.size.h * 4) }, overflow: false };
    if (flat.overflow) warn("Des pixels débordent de la case de l'emplacement : ils sont coupés.");
    const base = slotFileBase(slot.id);
    report.hash = frameHash(flat.img);
    hashes.set(slot.id, report.hash);
    await writeFile(path.join(work, `${base}.rgba`), flat.img.data);
    pending.push({ slot, report, base, ms: performance.now() - start });
  }

  // Palette et curseurs (kit v3) : lus seulement si leur groupe est là. La couleur
  // exportée (manifeste du kit d'origine, sinon couleur du thème) sert à repérer
  // les pixels repeints, même partiellement.
  const swatchReads: SwatchRead[] = [];
  const idManifest = exportId ? (opts.manifests ?? []).find((m) => m.exportId === exportId) : undefined;
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
  type CursorPending = Pending & { hotspot: { x: number; y: number } };
  const cursorPending: CursorPending[] = [];
  for (const slot of CURSOR_SLOTS) {
    const source = sources.get(slot.id);
    if (!source) continue;
    const start = performance.now();
    const report: SlotReport = { id: slot.id, label: slot.label, status: "ok", change: "new", messages: [], ms: 0, source: source.path };
    const warn = (m: string) => {
      if (!report.messages.includes(m)) report.messages.push(m);
      if (report.status === "ok") report.status = "warn";
    };
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
    const img = flat?.img ?? { width: slot.size.w, height: slot.size.h, data: Buffer.alloc(slot.size.w * slot.size.h * 4) };
    if (flat?.overflow) warn("Des pixels débordent de la case du curseur : ils sont coupés.");
    const hs = readHotspot(source, frameOf(slot, layout, source.boardOrigin), CURSOR_DEFAULT_HOTSPOT[slot.cursor!]);
    if (hs.message) warn(hs.message);
    const base = slotFileBase(slot.id);
    report.hash = frameHash(img);
    await writeFile(path.join(work, `${base}.rgba`), img.data);
    cursorPending.push({ slot, report, base, ms: performance.now() - start, hotspot: { x: hs.x, y: hs.y } });
  }
  const extras = { palette: swatchReads.length > 0, cursors: cursorPending.length > 0 || slots.some((s) => s.id.startsWith("curseur/")) };

  // PSD libéré avant les encodages lourds (AVIF d'un plan pleine largeur).
  // Toute référence aux données brutes disparaît : une variable de boucle encore
  // vivante dans le cadre suspendu de la fonction (mesuré au heap snapshot)
  // retenait sinon tout le PSD par un calque ignoré jamais décodé.
  freeRaw(psd.children);
  sources.clear();
  psd = null;
  buffer = null;
  // Plusieurs passes : la mémoire externe d'un ArrayBuffer est rendue au cycle suivant.
  for (let i = 0; i < 3; i++) {
    (globalThis as { gc?: () => void }).gc?.();
    await new Promise((r) => setImmediate(r));
  }
  /** RSS courant (pas le pic) une fois le PSD libéré. */
  const afterFreeMb = Math.round(process.memoryUsage().rss / 1024 / 1024);

  // Le kit d'origine est reconnu quel que soit l'écran où il est envoyé : le thème
  // visé par défaut est celui dont le kit a été exporté (`reference.themeId`), pas
  // celui de la page ; `foreign` n'est que l'avertissement d'un écart.
  const { reference: ref } = findReference(exportId, hashes, opts.manifests ?? []);
  const foreign = ref && opts.themeId !== undefined && ref.manifest.themeId !== opts.themeId ? ref : null;
  let planChanged = false;

  for (const { slot, report, base, ms } of pending) {
    const start = performance.now() - ms;
    const warn = (m: string) => {
      report.messages.push(m);
      if (report.status === "ok") report.status = "warn";
    };
    const done = () => {
      report.ms = Math.round(performance.now() - start);
      report.peakMb = Math.round(process.resourceUsage().maxRSS / 1024);
      slots.push(report);
    };
    const framed: Rgba = { width: slot.size.w, height: slot.size.h, data: await readFile(path.join(work, `${base}.rgba`)) };
    if (ref) report.change = ref.manifest.slots[slot.id]?.hash === report.hash ? "unchanged" : "redrawn";
    if (report.change === "unchanged") {
      // Inchangé : rien à reconvertir, l'asset actuel du thème est gardé.
      done();
      continue;
    }
    if (slot.kind === "plan") planChanged = true;
    await writePreview(framed, path.join(outDir, `${base}.apres.png`), slot.kind === "plan");
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
    if (slot.kind === "plan" && slot.transparent && shareOpaque > 0.98) {
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

    const { avif, webp } = await encodeBitmap(img);
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

    if (slot.mono) {
      const m = monoStats(img);
      report.mono = { spread: Math.round(m.spread * 10) / 10 };
      if (!m.mono) warn("Plusieurs couleurs : seule la forme est gardée (elle prend la couleur du thème).");
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
      const flat = tex.coverage1 >= 0.97;
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

    if (slot.kind === "plan") report.thumbhash = await thumbHashOf(img);
    done();
  }

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
    const before = ref?.manifest.hotspots?.[slot.id];
    if (ref) report.change = ref.manifest.slots[slot.id]?.hash === report.hash && before?.x === hotspot.x && before?.y === hotspot.y ? "unchanged" : "redrawn";
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
    report.peakMb = Math.round(process.resourceUsage().maxRSS / 1024);
    slots.push(report);
  }

  // Palette : seulement si le paysage a changé (sinon, c'est celle du thème) ;
  // plans relus du disque à ce moment-là seulement.
  let palette: PaletteSuggestion | null = null;
  if (planChanged) {
    const plans: Rgba[] = [];
    for (const { slot, base } of pending) if (slot.kind === "plan") plans.push({ width: slot.size.w, height: slot.size.h, data: await readFile(path.join(work, `${base}.rgba`)) });
    palette = await suggestPalette(plans);
  }
  await rm(work, { recursive: true, force: true });
  // Ordre de la spec (les emplacements absents ou en erreur sont arrivés en phase 1).
  slots.sort((x, y) => ALL_SLOTS.findIndex((s) => s.id === x.id) - ALL_SLOTS.findIndex((s) => s.id === y.id));
  const totals = {
    firstView: slots.filter((s) => FIRST_VIEW.has(s.id)).reduce((a, s) => a + (s.bytes ?? 0), 0),
    all: slots.reduce((a, s) => a + (s.bytes ?? 0), 0),
  };
  const report: KitReport = {
    ok: !slots.some((s) => s.status === "error"),
    preflight,
    layout,
    exportId,
    reference: ref ? { exportId: ref.manifest.exportId, themeId: ref.manifest.themeId, how: ref.how, matches: ref.matches } : null,
    foreign: foreign ? { exportId: foreign.manifest.exportId, themeId: foreign.manifest.themeId } : null,
    tree,
    readMs,
    afterReadMb,
    afterFreeMb,
    peakMb: Math.round(process.resourceUsage().maxRSS / 1024),
    slots,
    ignoredLayers,
    palette,
    totals,
    ...(colors ? { colors } : {}),
    extras,
  };
  await writeFile(path.join(outDir, "rapport.json"), JSON.stringify(report, null, 2));
  return report;
}

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
