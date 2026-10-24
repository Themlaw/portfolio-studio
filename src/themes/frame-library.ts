/**
 * Bibliothèque de cadres (lot 74) : module PUR (données, validation, feuille CSS), lu par le serveur, la toile et les tests.
 *
 * Un cadre importé = une image (PNG / WebP transparent, ou SVG) découpée en 9 parties comme le cadre du kit (border-image) :
 * `slice` = marges de découpe en px de l'image (haut, droite, bas, gauche) ; `thickness` = épaisseur AFFICHÉE du côté du haut
 * (px CSS), les trois autres côtés suivent proportionnellement. Stockée dans le réglage `frameLibrary` (aucune table, aucun SQL) ;
 * les fichiers vivent sous `/media/kit/<hash>.<ext>` comme les dessins du kit (mêmes conversions au plus léger : AVIF + WebP, ou
 * SVG optimisé). Un cadre choisi sur une photo est `frame: { kind: "custom", id }` (src/lib/look.ts).
 *
 * Rendu : `frameLibraryCss` écrit UNE règle par cadre, sur `.media-frame[data-frame="custom"][data-frame-id="…"]`, avec la même
 * mécanique que le cadre du kit (src/themes/variants.css) : bordure DANS la boîte (la taille du média ne change jamais), épaisseurs des
 * 4 côtés, `border-image-repeat: round`. Un identifiant inconnu (cadre supprimé) n'a aucune règle : aucun cadre.
 */
import { z } from "zod";

export const FRAME_LIBRARY_KEY = "frameLibrary";
export const FRAME_LIBRARY_MAX = 60;
export const FRAME_THICKNESS_MIN = 2;
export const FRAME_THICKNESS_MAX = 80;
export const FRAME_NAME_MAX = 60;

const kitPath = (ext: string) => z.string().regex(new RegExp(`^/media/kit/[0-9a-f]{16}\\.${ext}$`), "chemin de cadre invalide");
const side = z.number().int().min(1).max(2400);

export const FrameEntrySchema = z.strictObject({
  /** Identifiant stable (`[a-z0-9-]+`, 80 au plus) : celui de `frame: { kind: "custom", id }`. */
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(FRAME_NAME_MAX),
  image: z.strictObject({
    svg: kitPath("svg").optional(),
    avif: kitPath("avif").optional(),
    webp: kitPath("webp").optional(),
    w: z.number().int().min(3).max(4096),
    h: z.number().int().min(3).max(4096),
  }),
  slice: z.tuple([side, side, side, side]),
  thickness: z.number().min(FRAME_THICKNESS_MIN).max(FRAME_THICKNESS_MAX),
  /** Le bord a été repéré automatiquement dans la transparence (sinon une valeur de repli est utilisée : à régler). */
  detected: z.boolean(),
  createdAt: z.number().int().nonnegative(),
});
export type FrameEntry = z.infer<typeof FrameEntrySchema>;

const LibrarySchema = z.strictObject({ frames: z.array(z.unknown()) });

/** Lecture tolérante du réglage : les entrées invalides sont ignorées (jamais une exception au rendu). */
export function readFrameLibrary(raw: unknown): FrameEntry[] {
  const lib = LibrarySchema.safeParse(raw);
  if (!lib.success) return [];
  const seen = new Set<string>();
  const out: FrameEntry[] = [];
  for (const e of lib.data.frames) {
    const p = FrameEntrySchema.safeParse(e);
    if (!p.success || seen.has(p.data.id) || (!p.data.image.svg && !(p.data.image.avif && p.data.image.webp))) continue;
    seen.add(p.data.id);
    out.push(p.data);
  }
  return out;
}

/** Épaisseur affichée par côté (px CSS) : [haut, droite, bas, gauche], proportionnelle à la découpe. */
export function frameWidths(e: Pick<FrameEntry, "slice" | "thickness">): [number, number, number, number] {
  const k = e.thickness / e.slice[0];
  return e.slice.map((s) => Math.max(1, Math.round(s * k * 10) / 10)) as [number, number, number, number];
}

/** Épaisseur par défaut (px CSS) : la moitié de la découpe, comme le cadre du kit (dessiné en 2x, net en écran dense). */
export function defaultThickness(top: number): number {
  return Math.min(FRAME_THICKNESS_MAX, Math.max(FRAME_THICKNESS_MIN, Math.round(top / 2)));
}

/** Identifiant libre d'après un nom (sans accent, `[a-z0-9-]`), suffixé s'il existe déjà. */
export function frameIdFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "cadre";
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

const urlOf = (i: FrameEntry["image"]) => (i.svg ? `url("${i.svg}")` : `image-set(url("${i.avif}") type("image/avif"), url("${i.webp}") type("image/webp"))`);

/** Vignette : le fichier le plus simple à afficher (SVG, sinon WebP). */
export const frameThumb = (e: Pick<FrameEntry, "image">): string => e.image.svg ?? e.image.webp ?? "";

/**
 * Règle CSS d'un cadre. Même mécanique que le cadre du kit depuis le lot 79 (src/themes/variants.css) : la photo garde sa taille et sa place,
 * la bordure l'entoure en DÉPASSANT (marges négatives posées par `.media-frame` d'après `--fbt/--fbr/--fbb/--fbl`), plafonnée à la place
 * laissée autour (`--room`). Épaisseurs entières (px) ; le sélecteur est plus précis que `.media-frame`.
 */
export function frameRule(e: FrameEntry): string {
  const w = frameWidths(e);
  const [st, sr, sb, sl] = e.slice;
  const max = Math.max(...w);
  const side = (n: number) => `round(calc(${n} * var(--cf-k)),1px)`;
  return (
    `.media-frame[data-frame="custom"][data-frame-id="${e.id}"]{` +
    // Réduit sur petit écran / petite photo / peu de place autour : jamais plus de 4 % de la largeur, 16 % de la boîte, ni la place libre.
    `--cf-k:min(1px,calc(4vw / ${max}),calc(var(--cap-w,100vw) * 0.16 / ${max}),calc(var(--room,24px) / ${max}));` +
    `--fbt:${side(w[0])};--fbr:${side(w[1])};--fbb:${side(w[2])};--fbl:${side(w[3])};` +
    `border-style:solid;border-color:transparent;border-width:var(--fbt) var(--fbr) var(--fbb) var(--fbl);` +
    `border-image-source:${urlOf(e.image)};border-image-slice:${st} ${sr} ${sb} ${sl};border-image-repeat:round;` +
    `clip-path:inset(0 round var(--media-radius,0px))}`
  );
}

/** Feuille de tous les cadres de la bibliothèque (vide sans cadre : une page sans cadre importé reste identique). */
export function frameLibraryCss(list: readonly FrameEntry[]): string {
  return list.map(frameRule).join("\n");
}

/** Données d'une entrée pour la toile (menu « Cadre perso ») : léger, sérialisable. */
export type FrameChoice = { id: string; name: string; thumb: string };
export const frameChoiceOf = (e: FrameEntry): FrameChoice => ({ id: e.id, name: e.name, thumb: frameThumb(e) });
