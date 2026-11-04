/**
 * Écritures de la bibliothèque de cadres (lot 74, admin et menu « Cadre perso » de la toile) : importer (PNG / WebP transparent ou SVG),
 * renommer, régler l'épaisseur, supprimer. Module de données : src/themes/frame-library.ts (réglage `frameLibrary`, aucune table).
 *
 * Importer : le fichier est converti au plus léger comme les papiers peints et le kit (AVIF + WebP, ou SVG optimisé SANS script ni
 * ressource externe), rangé sous `kit/<hash>.<ext>` ; le bord est déduit de la transparence quand c'est possible.
 * Supprimer un cadre UTILISÉ : les images qui le portent repassent à « Aucun » (écriture sur les blocs publiés, les brouillons de page
 * et les planches, version de brouillon augmentée : un onglet resté ouvert reçoit un conflit au lieu de ré-enregistrer l'ancien contenu).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";

import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { optimize } from "svgo/browser";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { getStorage } from "@/lib/storage";
import { decodeProblem } from "@/lib/images/budget";
import { svgProblem } from "@/lib/themes/svg-check";
import { sniffImage } from "@/lib/upload/sniff";
import {
  defaultThickness,
  FRAME_LIBRARY_KEY,
  FRAME_LIBRARY_MAX,
  FRAME_NAME_MAX,
  FRAME_THICKNESS_MAX,
  FRAME_THICKNESS_MIN,
  frameIdFor,
  readFrameLibrary,
  visitCustomFrames,
  type FrameEntry,
} from "@/themes/frame-library";

import { done, fail, type ActionResult } from "./result";

export const FRAME_FORMAT_HELP = "PNG ou WebP sur fond transparent, ou SVG.";
export const FRAME_MAX_BYTES = 12 * 1024 * 1024;
const MAX_SIDE = 2400;
const ALPHA_EMPTY = 8;
/** Rendu d'un SVG pour repérer son bord : plus grand côté, et borne de pixels (marge d'arrondi de la densité comprise). */
const RASTER_SIDE = 1200;
const RASTER_MAX_PIXELS = (RASTER_SIDE + 8) * (RASTER_SIDE + 8);
/** Bitmap reçu : pixels au plus (en-tête lu avant tout décodage), puis budget de décodage (`decodeProblem`). */
const BITMAP_MAX_PIXELS = 40_000_000;
/** Délai dur d'un traitement sharp dans la requête (filtres SVG lourds, image pathologique). */
const SHARP_TIMEOUT_S = 20;

/* ---- Lecture directe (admin, sans cache) ---------------------------------------------------------------------------------------- */

export function readLibraryRow(): FrameEntry[] {
  return readFrameLibrary(parseJson(getDb().select().from(schema.settings).where(eq(schema.settings.key, FRAME_LIBRARY_KEY)).get()?.value));
}

function writeLibrary(frames: FrameEntry[]): void {
  const db = getDb();
  if (!frames.length) {
    db.delete(schema.settings).where(eq(schema.settings.key, FRAME_LIBRARY_KEY)).run();
    return;
  }
  const value = JSON.stringify({ frames });
  db.insert(schema.settings).values({ key: FRAME_LIBRARY_KEY, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
}

/* ---- Analyse du bord ------------------------------------------------------------------------------------------------------------ */

/**
 * Épaisseur du bord (px de l'image) sur chaque côté : on part du milieu du côté (une bande centrale, pour passer outre festons et coins)
 * et on avance vers l'intérieur tant qu'il y a de la matière ; le premier alignement vide termine le bord. Un côté sans vide (image
 * pleine) ou un bord au-delà de la moitié de l'image : non déterminable (`null`).
 */
export function detectSlice(data: Uint8Array, w: number, h: number): [number, number, number, number] | null {
  const bandX0 = Math.floor(w * 0.4);
  const bandX1 = Math.max(bandX0 + 1, Math.ceil(w * 0.6));
  const bandY0 = Math.floor(h * 0.4);
  const bandY1 = Math.max(bandY0 + 1, Math.ceil(h * 0.6));
  const solidAt = (x: number, y: number) => data[(y * w + x) * 4 + 3] > ALPHA_EMPTY;
  const rowHas = (y: number) => {
    for (let x = bandX0; x < bandX1; x++) if (solidAt(x, y)) return true;
    return false;
  };
  const colHas = (x: number) => {
    for (let y = bandY0; y < bandY1; y++) if (solidAt(x, y)) return true;
    return false;
  };
  const scan = (len: number, has: (i: number) => boolean, reverse: boolean): number | null => {
    let n = 0;
    for (let i = 0; i < len / 2; i++) {
      if (!has(reverse ? len - 1 - i : i)) return n > 0 ? n : null;
      n++;
    }
    return null;
  };
  const t = scan(h, rowHas, false);
  const b = scan(h, rowHas, true);
  const l = scan(w, colHas, false);
  const r = scan(w, colHas, true);
  if (t === null || b === null || l === null || r === null) return null;
  return [t, r, b, l];
}

const fallbackSlice = (w: number, h: number): [number, number, number, number] => {
  const s = Math.max(1, Math.min(200, Math.round(Math.min(w, h) * 0.15)));
  return [s, s, s, s];
};

/* ---- SVG ------------------------------------------------------------------------------------------------------------------------ */

/**
 * Refus lisibles : un cadre SVG est une image, jamais un programme ni une page qui charge autre chose. Même liste blanche que les
 * éléments dessinés d'un thème importé (`svgProblem` de src/lib/themes/svg-check.ts : éléments de dessin seulement ; DOCTYPE et entités,
 * <style>, <set> / <animate>, gestionnaires, liens et url() externes refusés), appliquée AVANT svgo (le fichier reçu, tel quel) et APRÈS
 * (ce qui sera servi) : svgo ne fait que réduire, il ne sert jamais de filtre.
 */
function frameSvgProblem(data: Uint8Array): string | null {
  const reason = svgProblem(data);
  if (!reason) return null;
  return `Ce SVG n'est pas accepté (${reason}). Exporte-le comme simple dessin : sans script, sans feuille de style, sans animation ni contenu extérieur (Illustrator : « Styles : attributs de présentation » ; Inkscape : « SVG simple »).`;
}

type Processed = { image: FrameEntry["image"]; files: { ext: string; data: Buffer }[]; slice: [number, number, number, number]; detected: boolean };

/** Exportée pour les tests (scripts/test-cadres62.mjs). */
export async function processSvg(buf: Buffer): Promise<Processed | string> {
  const bad = frameSvgProblem(buf);
  if (bad) return bad;
  const text = buf.toString("utf8");
  let optimized: string;
  try {
    optimized = optimize(text, { multipass: true, floatPrecision: 2, plugins: ["preset-default", "removeScripts"] as never[] }).data;
  } catch {
    return "Ce fichier n'a pas pu être lu comme un SVG (fichier abîmé ?).";
  }
  // Taille naturelle : la viewBox, sinon width / height. Sans elle, border-image ne sait pas découper l'image.
  const root = /<svg\b[^>]*>/i.exec(optimized)?.[0];
  if (!root) return "Ce fichier n'est pas un SVG.";
  const vb = /viewBox="\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)\s*"/i.exec(root);
  const wAttr = /\swidth="([\d.]+)(?:px)?"/i.exec(root);
  const hAttr = /\sheight="([\d.]+)(?:px)?"/i.exec(root);
  const w = Math.round(vb ? Number(vb[1]) : wAttr ? Number(wAttr[1]) : 0);
  const h = Math.round(vb ? Number(vb[2]) : hAttr ? Number(hAttr[1]) : 0);
  if (!(w >= 3 && h >= 3) || w > 4096 || h > 4096) return "Ce SVG a une taille illisible ou trop grande (4096 px au plus de chaque côté).";
  let svg = optimized;
  let rootFixed = root.replace(/\s(width|height)="[^"]*"/gi, "");
  if (!vb) rootFixed = rootFixed.replace(/<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`);
  rootFixed = rootFixed.replace(/<svg\b/i, `<svg width="${w}" height="${h}"`);
  svg = svg.replace(root, rootFixed);
  const after = frameSvgProblem(Buffer.from(svg));
  if (after) return after;
  // Analyse du bord sur un rendu de RASTER_SIDE px au plus, dessiné directement à cette taille (densité réduite, jamais suréchantillonné :
  // un SVG de 4096 px à 192 dpi faisait ~67 Mpx dans la requête), avec une borne de pixels explicite et un délai : rien de plus lourd qu'une
  // vignette ne tourne dans le processus Next. Seul le bord déduit (slice) en dépend : le fichier servi reste le SVG.
  const scale = Math.min(1, RASTER_SIDE / Math.max(w, h));
  const tw = Math.max(3, Math.round(w * scale));
  const th = Math.max(3, Math.round(h * scale));
  const raw = await sharp(Buffer.from(svg), { density: 72 * scale, limitInputPixels: RASTER_MAX_PIXELS })
    .timeout({ seconds: SHARP_TIMEOUT_S })
    .resize(tw, th, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch(() => null);
  if (!raw) return "Ce SVG n'a pas pu être dessiné : vérifie qu'il s'ouvre bien dans un navigateur.";
  const found = detectSlice(raw.data, raw.info.width, raw.info.height);
  const slice = found ? (found.map((s) => Math.max(1, Math.min(Math.floor(Math.min(w, h) / 2) - 1, Math.round(s / scale)))) as Processed["slice"]) : fallbackSlice(w, h);
  return { image: { w, h }, files: [{ ext: "svg", data: Buffer.from(svg) }], slice, detected: Boolean(found) };
}

/* ---- Bitmap : AVIF + WebP, comme le kit --------------------------------------------------------------------------------------- */

export async function processBitmap(buf: Buffer): Promise<Processed | string> {
  // En-tête seul (aucun pixel décodé) : dimensions, puis budget de décodage commun (un PNG entrelacé, un WebP ou un AVIF se décodent
  // d'un bloc : refusés avant d'ouvrir s'ils dépassent le budget du conteneur).
  const meta = await sharp(buf, { limitInputPixels: false }).metadata().catch(() => null);
  if (!meta?.width || !meta.height) return "Ce fichier n'a pas pu être lu comme une image (fichier abîmé ou incomplet ?).";
  if (meta.width * meta.height > BITMAP_MAX_PIXELS) return `Cette image est trop grande pour un cadre (${meta.width} × ${meta.height} px, 40 millions de pixels au plus).`;
  const heavy = decodeProblem({ ...meta, width: meta.width, height: meta.height });
  if (heavy) return heavy;
  const rotated = (meta.orientation ?? 1) >= 5;
  const sw = rotated ? meta.height : meta.width;
  const sh = rotated ? meta.width : meta.height;
  if (sw < 3 || sh < 3) return "Cette image est trop petite pour être un cadre.";
  const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const base = sharp(buf, { limitInputPixels: BITMAP_MAX_PIXELS }).timeout({ seconds: SHARP_TIMEOUT_S }).rotate().ensureAlpha();
  const decoded = await (k < 1 ? base.resize(Math.round(sw * k), Math.round(sh * k)) : base)
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch(() => null);
  if (!decoded) return "Ce fichier n'a pas pu être lu comme une image (fichier abîmé ou trop lourd ?).";
  const { data, info } = decoded;
  const w = info.width;
  const h = info.height;
  const found = detectSlice(data, w, h);
  const slice = found ?? fallbackSlice(w, h);
  const img = () => sharp(data, { raw: { width: w, height: h, channels: 4 } }).timeout({ seconds: SHARP_TIMEOUT_S });
  const [avif, webp] = await Promise.all([
    img().avif({ quality: 78, effort: 4, chromaSubsampling: "4:4:4" }).toBuffer(),
    img().webp({ quality: 92, alphaQuality: 100, effort: 4, smartSubsample: false }).toBuffer(),
  ]);
  return { image: { w, h }, files: [{ ext: "avif", data: avif }, { ext: "webp", data: webp }], slice: slice.map((s) => Math.min(s, Math.floor(Math.min(w, h) / 2) - 1)) as Processed["slice"], detected: Boolean(found) };
}

/** Nom proposé d'après le fichier : sans extension ni séparateurs, 60 caractères au plus. */
function nameOf(original: string | null | undefined, fallback: string): string {
  const base = (original ?? "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, FRAME_NAME_MAX);
  return base || fallback;
}

/**
 * Le début du fichier ressemble-t-il à un SVG (prologue XML, commentaires, DOCTYPE, puis <svg) ? Lecture pas à pas par `indexOf`, en
 * temps linéaire : l'ancienne expression régulière `(?:<!--[\s\S]*?-->\s*)*` revenait en arrière de façon exponentielle
 * (`"<!---->".repeat(290)` bloquait le processus, donc tout le site). Un DOCTYPE est reconnu ici pour être REFUSÉ ensuite, avec un
 * message lisible, par `frameSvgProblem`.
 */
export function looksSvg(buf: Uint8Array): boolean {
  const s = Buffer.from(buf.subarray(0, 2048)).toString("utf8");
  let i = s.charCodeAt(0) === 0xfeff ? 1 : 0;
  const skipSpace = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  skipSpace();
  if (s.startsWith("<?xml", i)) {
    const end = s.indexOf("?>", i);
    if (end < 0) return false;
    i = end + 2;
    skipSpace();
  }
  while (s.startsWith("<!--", i)) {
    const end = s.indexOf("-->", i + 4);
    if (end < 0) return false;
    i = end + 3;
    skipSpace();
  }
  if (s.slice(i, i + 9).toUpperCase() === "<!DOCTYPE") {
    const end = s.indexOf(">", i);
    if (end < 0) return false;
    i = end + 1;
    skipSpace();
  }
  return /^<svg[\s>]/i.test(s.slice(i, i + 5));
}

/**
 * Ajoute un cadre à la bibliothèque d'après un fichier reçu (chemin temporaire : l'appelant le supprime). Même contenu déjà présent :
 * le cadre existant (`reused`). Refus lisibles : format, taille, SVG piégé.
 */
export async function importFrame(file: { tmpPath: string; size: number; head: Uint8Array; filename: string }): Promise<ActionResult<{ entry: FrameEntry; reused: boolean }>> {
  if (file.size > FRAME_MAX_BYTES) return fail("Ce fichier est trop lourd pour un cadre (12 Mo au plus).");
  const buf = await readFile(file.tmpPath);
  const type = sniffImage(file.head);
  const svg = !type && looksSvg(buf);
  if (!svg && (!type || !["image/png", "image/webp", "image/avif"].includes(type.mime))) {
    return fail(`Un cadre doit être un fichier ${FRAME_FORMAT_HELP} Ce fichier n'est pas utilisable (le JPEG n'a pas de transparence).`);
  }
  const library = readLibraryRow();
  if (library.length >= FRAME_LIBRARY_MAX) return fail(`La bibliothèque est pleine (${FRAME_LIBRARY_MAX} cadres) : supprime-en avant d'en ajouter.`);
  const processed = svg ? await processSvg(buf) : await processBitmap(buf);
  if (typeof processed === "string") return fail(processed);

  const storage = getStorage();
  const image: FrameEntry["image"] = { ...processed.image };
  for (const f of processed.files) {
    const key = `kit/${createHash("sha256").update(f.data).digest("hex").slice(0, 16)}.${f.ext}`;
    if (!(await storage.stat(key))) await storage.put(key, Readable.from(f.data));
    (image as Record<string, unknown>)[f.ext] = `/media/${key}`;
  }
  const same = library.find((e) => (e.image.svg ?? e.image.webp) === (image.svg ?? image.webp));
  if (same) return done({ entry: same, reused: true });

  const name = nameOf(file.filename, `Cadre ${new Date().toLocaleDateString("fr-FR")}`);
  const entry: FrameEntry = {
    id: frameIdFor(name, library.map((e) => e.id)),
    name,
    image,
    slice: processed.slice,
    thickness: defaultThickness(processed.slice[0]),
    detected: processed.detected,
    createdAt: Math.floor(Date.now() / 1000),
  };
  writeLibrary([...library, entry]);
  return done({ entry, reused: false });
}

export function renameFrame(id: string, name: unknown): ActionResult<null> {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return fail("Donne un nom au cadre.");
  if (n.length > FRAME_NAME_MAX) return fail(`Nom trop long (${FRAME_NAME_MAX} caractères au plus).`);
  const library = readLibraryRow();
  if (!library.some((e) => e.id === id)) return fail("Ce cadre n'existe plus.");
  writeLibrary(library.map((e) => (e.id === id ? { ...e, name: n } : e)));
  return done(null);
}

export function setFrameThickness(id: string, value: unknown): ActionResult<null> {
  if (typeof value !== "number" || !Number.isFinite(value) || value < FRAME_THICKNESS_MIN || value > FRAME_THICKNESS_MAX) return fail(`Épaisseur hors limites (${FRAME_THICKNESS_MIN} à ${FRAME_THICKNESS_MAX} px).`);
  const library = readLibraryRow();
  if (!library.some((e) => e.id === id)) return fail("Ce cadre n'existe plus.");
  writeLibrary(library.map((e) => (e.id === id ? { ...e, thickness: Math.round(value * 10) / 10 } : e)));
  return done(null);
}

/* ---- Où un cadre sert ------------------------------------------------------------------------------------------------------------ */

export type FrameUse = { pageId: number | null; pageTitle: string; count: number };

type Holder = { read: () => unknown; write: (v: unknown) => void; page: number | null; project?: number };

/** Tous les JSON qui peuvent porter un cadre : blocs publiés, brouillons de page, planches publiées et brouillons de planche. */
function holders(): { published: Holder[]; drafts: Holder[] } {
  const db = getDb();
  const published: Holder[] = [];
  const drafts: Holder[] = [];
  for (const b of db.select({ id: schema.blocks.id, pageId: schema.blocks.pageId, props: schema.blocks.props }).from(schema.blocks).all()) {
    if (!b.props.includes('"custom"')) continue;
    const tree = parseJson(b.props);
    published.push({ read: () => tree, write: (v) => db.update(schema.blocks).set({ props: JSON.stringify(v) }).where(eq(schema.blocks.id, b.id)).run(), page: b.pageId });
  }
  for (const p of db.select({ id: schema.pages.id, draft: schema.pages.draft }).from(schema.pages).all()) {
    if (!p.draft || !JSON.stringify(p.draft).includes('"custom"')) continue;
    const tree = p.draft;
    drafts.push({ read: () => tree, write: (v) => db.update(schema.pages).set({ draft: v as never, draftRev: sqlPlus1() }).where(eq(schema.pages.id, p.id)).run(), page: p.id });
  }
  for (const pr of db.select({ id: schema.projects.id, layout: schema.projects.layout, draftLayout: schema.projects.draftLayout, draftPage: schema.projects.draftLayoutPageId }).from(schema.projects).all()) {
    if (pr.layout && JSON.stringify(pr.layout).includes('"custom"')) {
      const tree = pr.layout;
      published.push({ read: () => tree, write: (v) => db.update(schema.projects).set({ layout: v as never }).where(eq(schema.projects.id, pr.id)).run(), page: null, project: pr.id });
    }
    if (pr.draftLayout && JSON.stringify(pr.draftLayout).includes('"custom"')) {
      const tree = pr.draftLayout;
      drafts.push({
        read: () => tree,
        write: (v) => {
          db.update(schema.projects).set({ draftLayout: v as never }).where(eq(schema.projects.id, pr.id)).run();
          if (pr.draftPage !== null) db.update(schema.pages).set({ draftRev: sqlPlus1() }).where(eq(schema.pages.id, pr.draftPage)).run();
        },
        page: pr.draftPage,
        project: pr.id,
      });
    }
  }
  return { published, drafts };
}

const sqlPlus1 = () => sql`${schema.pages.draftRev} + 1` as unknown as number;

/**
 * Images qui portent chaque cadre perso. Une page (ou une planche) compte pour sa version la plus fournie, publiée ou brouillon :
 * le même contenu n'est jamais compté deux fois.
 */
export function frameUseCounts(): Map<string, number> {
  const { published, drafts } = holders();
  const tally = (hs: Holder[]) => {
    const out = new Map<string, Map<string, number>>(); // lieu → cadre → images
    for (const h of hs) {
      const place = h.project !== undefined ? `p${h.project}` : `g${h.page}`;
      const here = out.get(place) ?? new Map<string, number>();
      visitCustomFrames(structuredClone(h.read()), (id) => (here.set(id, (here.get(id) ?? 0) + 1), false));
      out.set(place, here);
    }
    return out;
  };
  const a = tally(published);
  const b = tally(drafts);
  const total = new Map<string, number>();
  for (const place of new Set([...a.keys(), ...b.keys()])) {
    const ids = new Set([...(a.get(place)?.keys() ?? []), ...(b.get(place)?.keys() ?? [])]);
    for (const id of ids) total.set(id, (total.get(id) ?? 0) + Math.max(a.get(place)?.get(id) ?? 0, b.get(place)?.get(id) ?? 0));
  }
  return total;
}

/** Pages et planches touchées par un cadre (pour revalider le cache). */
export type FrameTouched = { pages: number[]; projects: number[] };

/** Supprime un cadre : les images qui le portent repassent à « Aucun » (publié, brouillons, planches), puis il quitte la bibliothèque. */
export function deleteFrame(id: string): ActionResult<{ name: string; images: number; touched: FrameTouched }> {
  const library = readLibraryRow();
  const entry = library.find((e) => e.id === id);
  if (!entry) return fail("Ce cadre n'existe plus.");
  const images = frameUseCounts().get(id) ?? 0;
  const touched: FrameTouched = { pages: [], projects: [] };
  const db = getDb();
  db.transaction(() => {
    const { published, drafts } = holders();
    for (const h of [...published, ...drafts]) {
      const tree = h.read();
      const r = visitCustomFrames(tree, (x) => x === id);
      if (!r.changed) continue;
      h.write(tree);
      if (h.page !== null) touched.pages.push(h.page);
      if (h.project !== undefined) touched.projects.push(h.project);
    }
    writeLibrary(library.filter((e) => e.id !== id));
  });
  // Les fichiers restent sur le disque (quelques Ko, partagés par hash avec le kit) : rien ne risque de manquer ailleurs.
  return done({ name: entry.name, images, touched });
}
