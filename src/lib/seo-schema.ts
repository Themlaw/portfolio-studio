/**
 * Partage et référencement du site (lot 52) : description du site, image de partage par défaut, icône de l'onglet.
 * Réglage `seo`, séparé de `site` (l'identité suit le brouillon de l'éditeur, pas ceci : ici, « Enregistrer » met en ligne).
 * Module pur (zod seulement) : réglages, éditeur, serveur et tests.
 */
import { z } from "zod";

type L = { fr: string; en: string };

const Loc = (max: number) => z.strictObject({ fr: z.string().trim().max(max), en: z.string().trim().max(max) });

/** Ce que l'écran des réglages envoie. */
export const SeoInputSchema = z.strictObject({
  description: Loc(300),
  shareImage: z.number().int().positive().nullable(),
  favicon: z.number().int().positive().nullable(),
});
export type SeoInput = z.infer<typeof SeoInputSchema>;

/** Ce qui est gardé : l'icône est déjà déclinée en tailles, `dir` est son dossier dans le stockage. */
export type SeoStored = { description: L; shareImage: number | null; favicon: { mediaId: number; dir: string } | null };

export const EMPTY_SEO: SeoStored = { description: { fr: "", en: "" }, shareImage: null, favicon: null };

/** Tailles de l'icône produites (en pixels) : onglet, favicon large, iPhone, Android, grand format. */
export const ICON_SIZES = [32, 48, 180, 192, 512] as const;

const posInt = (v: unknown): number | null => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
const asL = (v: unknown): L => {
  const o = (v ?? {}) as Partial<L>;
  return { fr: typeof o.fr === "string" ? o.fr : "", en: typeof o.en === "string" ? o.en : "" };
};

/** Lecture tolérante du réglage stocké : un champ absent ou corrompu retombe sur son défaut. */
export function readSeo(raw: unknown): SeoStored {
  if (!raw || typeof raw !== "object") return EMPTY_SEO;
  const o = raw as Record<string, unknown>;
  const f = o.favicon as { mediaId?: unknown; dir?: unknown } | null | undefined;
  const mediaId = posInt(f?.mediaId);
  const favicon = mediaId && typeof f?.dir === "string" && /^icons\/[A-Za-z0-9_-]{1,40}$/.test(f.dir) ? { mediaId, dir: f.dir } : null;
  return { description: asL(o.description), shareImage: posInt(o.shareImage), favicon };
}

/**
 * Texte d'un onglet : « Page — Nom du site ». Le nom n'est pas répété s'il y figure déjà (titre choisi à la main),
 * et la page d'accueil, qui porte le nom du site, n'est pas dédoublée.
 */
export function tabTitle(pageTitle: string, siteName: string): string {
  const t = pageTitle.trim();
  const s = siteName.trim();
  if (!s) return t;
  if (!t) return s;
  if (t.toLowerCase().includes(s.toLowerCase())) return t;
  return `${t} — ${s}`;
}
