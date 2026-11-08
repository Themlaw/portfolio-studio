/**
 * Partage et référencement du site (lot 52) : description du site, image de partage par défaut, icône de l'onglet.
 * Réglage `seo`, séparé de `site` (l'identité suit le brouillon de l'éditeur, pas ceci : ici, « Enregistrer » met en ligne).
 * Module pur (zod seulement) : réglages, éditeur, serveur et tests.
 */
import { z } from "zod";

import { defaultFaviconConfig, readFaviconConfig, type FaviconConfig } from "./favicon-spec";

type L = { fr: string; en: string };

const Loc = (max: number) => z.strictObject({ fr: z.string().trim().max(max), en: z.string().trim().max(max) });

/** Ce que l'écran des réglages envoie (l'icône de l'onglet a son propre enregistrement : saveFavicon, lot 83). */
export const SeoInputSchema = z.strictObject({
  description: Loc(300),
  shareImage: z.number().int().positive().nullable(),
});
export type SeoInput = z.infer<typeof SeoInputSchema>;

/** Ce qui est gardé : l'icône est déjà déclinée en tailles, `dir` est son dossier dans le stockage. */
export type SeoStored = {
  description: L;
  shareImage: number | null;
  /** Image choisie (mode « image ») : déclinée à l'enregistrement dans `dir`. */
  favicon: { mediaId: number; dir: string } | null;
  /** Lot 83 : comment l'icône est choisie (automatique, une de mes images, kit) et les options du monogramme. */
  faviconMode: FaviconConfig;
};

export const EMPTY_SEO: SeoStored = { description: { fr: "", en: "" }, shareImage: null, favicon: null, faviconMode: defaultFaviconConfig("auto") };

/** Tailles de l'icône produites (en pixels) : onglet (16, 32), favicon large, iPhone (180), Android (192, 512). */
export const ICON_SIZES = [16, 32, 48, 180, 192, 512] as const;
/** Icône « maskable » d'Android : le dessin tient dans les 60 % du milieu (marge de sécurité de 20 % de chaque côté). */
export const MASKABLE_FILE = "maskable-512.png";

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
  return { description: asL(o.description), shareImage: posInt(o.shareImage), favicon, faviconMode: readFaviconConfig(o.faviconMode, Boolean(favicon)) };
}

/**
 * Icône « image » dont le média a disparu (purgé, à la corbeille, plus prêt) : retirée du réglage LU, sans rien écrire. `planIcon`
 * retombe alors sur l'ordre « Automatique » (calque du kit, logo du thème, sinon le monogramme) au lieu de pointer vers des fichiers
 * supprimés. `alive` : le média existe, est une image prête et n'est pas à la corbeille.
 */
export function withLiveFavicon(seo: SeoStored, alive: (mediaId: number) => boolean): SeoStored {
  return seo.favicon && !alive(seo.favicon.mediaId) ? { ...seo, favicon: null } : seo;
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
