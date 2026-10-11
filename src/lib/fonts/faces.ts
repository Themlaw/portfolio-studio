/**
 * Bibliothèque des polices Google téléchargées par le serveur (lot 2) :
 * forme du réglage `fontLibrary`, feuille @font-face servie par le site, et
 * lecture de la réponse CSS de Google. Module pur (zod) : testé par
 * scripts/test-look.mjs ; les écritures sont dans ./library.ts.
 */
import { z } from "zod";

import { isGoogleFamily } from "../../themes/google-fonts";

/** 12 familles, 8 styles (graisse × italique) par famille, 24 Mo en tout. */
export const FONT_LIMITS = { families: 12, facesPerFamily: 8, fileBytes: 600_000, totalBytes: 24_000_000, cssBytes: 64_000 } as const;
export const SUBSETS = ["latin", "latin-ext"] as const;
/** Hôtes fixes : jamais une adresse fournie par le client. */
export const GOOGLE_CSS = "https://fonts.googleapis.com/css2";
export const GSTATIC = /^https:\/\/fonts\.gstatic\.com\/[A-Za-z0-9/_.-]{1,300}\.woff2$/;
/** Sous-ensemble à la demande (`text=`, aperçus du menu) : adresse sans extension. */
export const GSTATIC_TEXT = /^https:\/\/fonts\.gstatic\.com\/l\/font\?[A-Za-z0-9=&_.-]{1,400}$/;
export const FONT_FILE = /^[0-9a-f]{16}\.woff2$/;
/** Plages unicode telles que Google les donne (U+0000-00FF, U+0131…). */
const UNICODE_RANGE = /^U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?(,\s*U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?)*$/;

export const FaceSchema = z.strictObject({
  weight: z.number().int().min(100).max(900),
  italic: z.boolean(),
  subset: z.enum(SUBSETS),
  file: z.string().regex(FONT_FILE),
  range: z.string().max(2000).regex(UNICODE_RANGE),
  bytes: z.number().int().min(1).max(FONT_LIMITS.fileBytes),
});
export type Face = z.infer<typeof FaceSchema>;

export const FontLibrarySchema = z
  .record(z.string().max(60).refine(isGoogleFamily, "famille hors catalogue"), z.array(FaceSchema).max(FONT_LIMITS.facesPerFamily * SUBSETS.length))
  .refine((v) => Object.keys(v).length <= FONT_LIMITS.families, `${FONT_LIMITS.families} polices au plus`);
export type FontLibrary = z.infer<typeof FontLibrarySchema>;

/** Lecture tolérante : une famille illisible est ignorée. */
export function readLibrary(raw: unknown): FontLibrary {
  if (!raw || typeof raw !== "object") return {};
  const out: FontLibrary = {};
  for (const [family, faces] of Object.entries(raw)) {
    const one = FontLibrarySchema.safeParse({ [family]: faces });
    if (one.success && Object.keys(out).length < FONT_LIMITS.families) Object.assign(out, one.data);
  }
  return out;
}

/** Feuille @font-face des polices téléchargées (fichiers servis par /fonts/…). */
export function fontFaceCss(lib: FontLibrary): string {
  const rules: string[] = [];
  for (const [family, faces] of Object.entries(readLibrary(lib))) {
    for (const f of faces) {
      rules.push(
        `@font-face{font-family:"${family}";font-style:${f.italic ? "italic" : "normal"};font-weight:${f.weight};font-display:swap;src:url("/fonts/${f.file}") format("woff2");unicode-range:${f.range}}`,
      );
    }
  }
  return rules.join("\n").replace(/</g, "\\3c ");
}

/** Styles (graisse, italique) déjà téléchargés pour une famille. */
export function hasFace(lib: FontLibrary, family: string, weight: number, italic: boolean): boolean {
  return (lib[family] ?? []).some((f) => f.weight === weight && f.italic === italic);
}

/** Adresse de la feuille Google pour UN style (hôte fixe, famille du catalogue). */
export function googleCssUrl(family: string, weight: number, italic: boolean, text?: string): string {
  const fam = encodeURIComponent(family).replace(/%20/g, "+");
  const spec = `${fam}:ital,wght@${italic ? 1 : 0},${weight}`;
  return `${GOOGLE_CSS}?family=${spec}&display=swap${text ? `&text=${encodeURIComponent(text)}` : ""}`;
}

export type ParsedFace = { subset: string; weight: number; italic: boolean; url: string; range: string };

/**
 * Faces d'une réponse css2 de Google (blocs « /* latin *\/ @font-face{…} »).
 * Seuls les fichiers woff2 de fonts.gstatic.com sont retenus ; sans
 * commentaire de sous-ensemble (requête `text=`), le sous-ensemble est « text ».
 */
export function parseGoogleCss(css: string): ParsedFace[] {
  const out: ParsedFace[] = [];
  const re = /(?:\/\*\s*([a-z0-9-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  for (const m of css.slice(0, FONT_LIMITS.cssBytes).matchAll(re)) {
    const body = m[2];
    const url = /src:\s*url\(([^)]+)\)\s*format\(['"]woff2['"]\)/.exec(body)?.[1]?.replace(/['"]/g, "");
    const weight = Number(/font-weight:\s*(\d{3})/.exec(body)?.[1]);
    const italic = /font-style:\s*italic/.test(body);
    const range = /unicode-range:\s*([^;]+);?/.exec(body)?.[1]?.trim() ?? "U+0-10FFFF";
    const subset = m[1] ?? "text";
    if (!url || !weight || !(GSTATIC.test(url) || (subset === "text" && GSTATIC_TEXT.test(url)))) continue;
    out.push({ subset, weight, italic, url, range });
  }
  return out;
}

/**
 * Familles Google citées dans un texte JSON (références `g:<Famille>` des
 * styles de texte : site, brouillon du site, `look.text` des blocs). Seules
 * les familles du catalogue comptent.
 */
export function familiesIn(json: string): string[] {
  const out = new Set<string>();
  for (const m of json.matchAll(/"g:([^"\\]{1,80})"/g)) if (isGoogleFamily(m[1])) out.add(m[1]);
  return [...out];
}

/** Familles de la bibliothèque qu'aucun usage ne cite (hors `keep`). */
export function unusedFamilies(lib: FontLibrary, used: Iterable<string>, keep: Iterable<string> = []): string[] {
  const live = new Set([...used, ...keep]);
  return Object.keys(lib).filter((f) => !live.has(f));
}

/** Fichiers .woff2 référencés par la bibliothèque. */
export function libraryFiles(lib: FontLibrary): Set<string> {
  return new Set(Object.values(lib).flat().map((f) => f.file));
}
