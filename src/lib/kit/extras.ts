/**
 * Import du kit (lot 4) : pastilles de la palette (« 8 · Palette ») et curseurs
 * (« 9 · Curseur »). Ni l'une ni l'autre ne deviennent des assets convertis
 * comme les autres emplacements :
 *  - une pastille donne une COULEUR : celle du remplissage d'un calque de
 *    forme (si Photoshop en a fait un), sinon la couleur la plus présente de
 *    ses pixels REPEINTS (ceux qui diffèrent de la couleur exportée : un coup
 *    de pinceau partiel compte, même s'il couvre moins de la moitié) ; les
 *    calques ajoutés au-dessus et le style « Incrustation couleur » sont
 *    aplatis avant (resolve.ts). Comparée à la couleur exportée : changée →
 *    forcée, inchangée → la nuance garde son mode (auto reste auto) ;
 *  - un curseur donne deux PNG (32 × 32 et 64 × 64 pour les écrans HiDPI),
 *    poids minimal (palette ≤ 256 couleurs), et son point chaud, lu au centre
 *    du calque repère « point chaud ».
 */
import type { Layer } from "ag-psd";
import sharp, { type Sharp } from "sharp";

import { cursorProblem } from "@/themes/cursor";
import { isStoredNuance, paletteLabel, parseColor, toHex, type PaletteKey } from "@/themes/palette";
import { OPAQUE_HEX, THEME_COLOR } from "@/themes/color-format";

import type { Rgba } from "./formats";
import { frameHash } from "./manifest";
import { flattenSlot, type SlotSource } from "./resolve";
import { CURSOR, type Layout, type SlotSpec } from "./spec";

/* ---- Pastilles ------------------------------------------------------------ */

export type ColorChange = "unchanged" | "changed" | "missing";
export type ColorReport = {
  key: PaletteKey;
  /** « Action · survol » */
  label: string;
  change: ColorChange;
  /** Couleur exportée (ou actuelle du thème si le kit d'origine n'est pas reconnu). */
  before?: string;
  /** Couleur lue dans la pastille. */
  after?: string;
  /** Comment elle a été lue. */
  how?: "forme" | "pixels";
  messages: string[];
};

/** Couleur lue : rgba si elle a une transparence et que le jeton l'accepte, sinon #rrggbb. */
function formatColor(r: number, g: number, b: number, alpha: number, free: boolean): string {
  const a = Math.round(alpha * 100) / 100;
  if (!free || a >= 1) return toHex([r, g, b]);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Couleur la plus présente des pixels visibles (alpha > 8), avec sa part. */
export function dominantColor(img: Rgba): { r: number; g: number; b: number; a: number; share: number } | null {
  const counts = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    if (a <= 8) continue;
    total++;
    // Clé RVBA sur 32 bits (nombre positif : multiplication plutôt que décalage).
    const key = ((img.data[i] * 256 + img.data[i + 1]) * 256 + img.data[i + 2]) * 256 + a;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!total) return null;
  let best = 0;
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return { r: Math.floor(best / 2 ** 24) % 256, g: Math.floor(best / 2 ** 16) % 256, b: Math.floor(best / 256) % 256, a: best % 256, share: n / total };
}

type AgColor = { r?: number; g?: number; b?: number; fr?: number; fg?: number; fb?: number };
/** Couleur de remplissage d'un calque de forme ou de remplissage (Photoshop), si c'est une couleur RVB unie. */
export function shapeFill(nodes: Layer[]): { r: number; g: number; b: number } | null {
  if (nodes.length !== 1 || nodes[0].children) return null;
  const fill = (nodes[0] as { vectorFill?: { type?: string; color?: AgColor } }).vectorFill;
  if (fill?.type !== "color" || !fill.color) return null;
  const c = fill.color;
  if (typeof c.r === "number" && typeof c.g === "number" && typeof c.b === "number") return { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) };
  if (typeof c.fr === "number" && typeof c.fg === "number" && typeof c.fb === "number") return { r: Math.round(c.fr * 255), g: Math.round(c.fg * 255), b: Math.round(c.fb * 255) };
  return null;
}

/** Même couleur (RVB exact, opacité à 1/255 près). */
export function sameColor(a: string | undefined, b: string | undefined): boolean {
  const x = a ? parseColor(a) : null;
  const y = b ? parseColor(b) : null;
  if (!x || !y) return false;
  return x.rgb.every((v, i) => Math.round(v) === Math.round(y.rgb[i])) && Math.abs(x.alpha - y.alpha) <= 1 / 255 + 1e-9;
}

/** Jetons acceptant une transparence (filets, détails). */
const FREE_KEYS = new Set<PaletteKey>(["line", "tertiary"]);

export type SwatchRead = { slot: SlotSpec; hash?: string; color?: string; how?: "forme" | "pixels"; messages: string[] };

/** Écart (par canal) à partir duquel un pixel compte comme « repeint ». */
const PAINTED_DELTA = 3;
/** Part minimale de pixels repeints pour que la pastille compte comme repeinte (un grain isolé ne suffit pas). */
const PAINTED_MIN_SHARE = 0.03;

/**
 * Couleur la plus présente parmi les pixels visibles qui diffèrent de `ref`
 * (RVB), regroupés par teintes voisines (un pinceau doux dégrade les bords).
 */
export function dominantRepainted(img: Rgba, ref: [number, number, number]): { r: number; g: number; b: number; a: number; share: number } | null {
  const buckets = new Map<number, { n: number; exact: Map<number, number> }>();
  let total = 0;
  let painted = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    if (a <= 8) continue;
    total++;
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    if (Math.abs(r - ref[0]) < PAINTED_DELTA && Math.abs(g - ref[1]) < PAINTED_DELTA && Math.abs(b - ref[2]) < PAINTED_DELTA) continue;
    painted++;
    const bucket = ((r >> 4) * 16 + (g >> 4)) * 16 + (b >> 4);
    const entry = buckets.get(bucket) ?? { n: 0, exact: new Map() };
    entry.n++;
    const exact = ((r * 256 + g) * 256 + b) * 256 + a;
    entry.exact.set(exact, (entry.exact.get(exact) ?? 0) + 1);
    buckets.set(bucket, entry);
  }
  if (!total || painted / total < PAINTED_MIN_SHARE) return null;
  let best: { n: number; exact: Map<number, number> } | null = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  let key = 0;
  let n = 0;
  for (const [k, c] of best!.exact) if (c > n) [key, n] = [k, c];
  return { r: Math.floor(key / 2 ** 24) % 256, g: Math.floor(key / 2 ** 16) % 256, b: Math.floor(key / 256) % 256, a: key % 256, share: painted / total };
}

/**
 * Lecture d'une pastille (pixels déjà aplatis dans sa case). `before` : la
 * couleur exportée ; avec elle, un repeint PARTIEL est lu (sans elle, seule la
 * couleur dominante l'est).
 */
export function readSwatch(slot: SlotSpec, source: SlotSource, img: Rgba | null, hash: string | undefined, before?: string): SwatchRead {
  const key = slot.paletteKey!;
  const free = FREE_KEYS.has(key);
  const messages: string[] = [];
  const shape = shapeFill(source.nodes);
  if (shape) return { slot, hash, color: toHex([shape.r, shape.g, shape.b]), how: "forme", messages };
  const ref = before ? parseColor(before) : null;
  const repainted = img && ref ? dominantRepainted(img, ref.rgb.map(Math.round) as [number, number, number]) : null;
  const dom = repainted ?? (img ? dominantColor(img) : null);
  if (!dom) return { slot, hash, messages: ["Pastille vide : la couleur actuelle est gardée."] };
  if (repainted && repainted.share < 0.5) messages.push(`Pastille repeinte en partie (${Math.round(repainted.share * 100)} % des pixels) : la couleur la plus présente parmi les pixels repeints est retenue.`);
  else if (!repainted && dom.share < 0.5) messages.push(`Plusieurs couleurs dans la pastille : la plus présente (${Math.round(dom.share * 100)} %) est retenue.`);
  if (dom.a < 255 && !free) messages.push("Transparence ignorée : cette couleur doit être opaque.");
  const color = formatColor(dom.r, dom.g, dom.b, dom.a / 255, free);
  // Format accepté par le schéma du thème (garde-fou : la lecture produit toujours un format valide).
  if (!(free ? THEME_COLOR : OPAQUE_HEX).test(color)) return { slot, hash, messages: [...messages, "Couleur illisible : la couleur actuelle est gardée."] };
  return { slot, hash, color, how: "pixels", messages };
}

/** Lecture d'une pastille depuis sa source (aplatissement avec styles de couleur, puis couleur). */
export function readSwatchSlot(slot: SlotSpec, source: SlotSource, layout: Layout, before: string | undefined): SwatchRead {
  const messages: string[] = [];
  const flat = flattenSlot(source, layout, (m) => messages.push(m), { overlay: true });
  const read = readSwatch(slot, source, flat?.img ?? null, flat ? frameHash(flat.img) : undefined, before);
  // Effets autres que l'incrustation de couleur, objets dynamiques, calques de réglage : jamais lus.
  for (const l of source.nodes) {
    const fx = Object.entries(l.effects ?? {}).filter(([k, v]) => k !== "solidFill" && k in UNREAD_FX && (Array.isArray(v) ? v.some((x) => x?.enabled !== false) : Boolean(v) && typeof v === "object" && (v as { enabled?: boolean }).enabled !== false));
    if (fx.length) messages.push(`${fx.map(([k]) => UNREAD_FX[k]).join(", ")} sur « ${l.name} » : non pris en compte, pixellise le calque (Calque > Pixelliser > Style de calque).`);
    if (l.placedLayer) messages.push(`Objet dynamique « ${l.name} » : pixellise-le (Calque > Pixelliser > Objet dynamique) pour que sa couleur soit lue.`);
  }
  return { ...read, messages: [...messages, ...read.messages] };
}
const UNREAD_FX: Record<string, string> = { dropShadow: "Ombre portée", innerShadow: "Ombre interne", outerGlow: "Lueur externe", innerGlow: "Lueur interne", bevel: "Biseautage", satin: "Satin", gradientOverlay: "Incrustation en dégradé", patternOverlay: "Incrustation de motif", stroke: "Contour" };

/**
 * Compare chaque pastille lue à la couleur exportée (manifeste du kit
 * d'origine) ou, faute de kit reconnu, à la couleur actuelle du thème.
 * Empreinte identique, ou même couleur : inchangée.
 */
export function compareSwatches(reads: SwatchRead[], ref: { slots: Record<string, { hash: string }>; colors?: Record<string, string> } | null, current: Record<string, string> | undefined): ColorReport[] {
  return reads.map((r) => {
    const key = r.slot.paletteKey!;
    const before = ref?.colors?.[key] ?? current?.[key];
    const base: ColorReport = { key, label: paletteLabel(key), change: "unchanged", before, after: r.color, how: r.how, messages: r.messages };
    if (!r.color) return { ...base, change: "missing" };
    if (ref && r.hash && ref.slots[r.slot.id]?.hash === r.hash) return { ...base, after: before ?? r.color };
    if (sameColor(r.color, before)) return base;
    return { ...base, change: "changed" };
  });
}

/** Nuance enregistrée qui passera de « auto » à choisie (affichage de la revue). */
export const becomesForced = (key: PaletteKey, auto: readonly string[] | undefined) => isStoredNuance(key) && Boolean(auto?.includes(key));

/* ---- Curseurs ------------------------------------------------------------- */

/**
 * Point chaud (px de la case 64 × 64) : centre du calque repère ; absent ou
 * hors de la case → défaut / ramené dans la case, avec un message.
 */
export function readHotspot(source: SlotSource | undefined, frame: { x: number; y: number }, fallback: { x: number; y: number }): { x: number; y: number; message?: string } {
  const h = source?.hotspot;
  if (!h) return { ...fallback, message: "Repère « point chaud » introuvable : le point chaud par défaut est utilisé (pointe en haut à gauche)." };
  const x = Math.floor((h.left + h.right - 1) / 2) - frame.x;
  const y = Math.floor((h.top + h.bottom - 1) / 2) - frame.y;
  const cx = Math.max(0, Math.min(CURSOR.size - 1, x));
  const cy = Math.max(0, Math.min(CURSOR.size - 1, y));
  return cx !== x || cy !== y ? { x: cx, y: cy, message: "Le repère « point chaud » sort de la case : ramené au bord." } : { x, y };
}

/** Point chaud en px CSS (image affichée à 32 × 32). */
export const hotspotCss = (h: { x: number; y: number }) => ({ x: Math.min(CURSOR.css - 1, Math.round(h.x / 2)), y: Math.min(CURSOR.css - 1, Math.round(h.y / 2)) });

/** PNG le plus léger : palette (≤ 256 couleurs) si elle suffit, sinon RVBA. */
async function smallPng(img: Sharp): Promise<Buffer> {
  const [indexed, full] = await Promise.all([
    img.clone().png({ palette: true, quality: 100, effort: 10, compressionLevel: 9, dither: 0 }).toBuffer(),
    img.clone().png({ compressionLevel: 9, effort: 10 }).toBuffer(),
  ]);
  return indexed.length <= full.length ? indexed : full;
}

/** Curseur 64 × 64 → PNG 2x (tel quel) et 1x (réduit, lanczos). */
export async function encodeCursor(img: Rgba): Promise<{ png: Buffer; png2x: Buffer }> {
  const raw = { raw: { width: img.width, height: img.height, channels: 4 as const } };
  const png2x = await smallPng(sharp(img.data, raw));
  const png = await smallPng(sharp(img.data, raw).resize(CURSOR.css, CURSOR.css, { kernel: "lanczos3" }));
  return { png, png2x };
}

/** Avertissement si le curseur se perd sur un des fonds du thème. */
export function cursorWarning(img: Rgba, grounds: { hex: string; label: string }[]): string | null {
  return grounds.length ? cursorProblem(img.data, grounds) : null;
}
