/**
 * Partage et référencement côté public (lot 52) : balises `og:*` / `twitter:*`, titres d'onglet, icône, plan du site.
 * Lectures par `cached` (étiquettes des réglages, des pages et des médias) : rien n'est relu hors invalidation.
 */
import type { Metadata } from "next";

import { extractProjectRefs, extractRefs } from "@/blocks/refs";
import { routing, type AppLocale } from "@/i18n/routing";

import { getProjectBoard } from "./gallery";
import { getMedia } from "./media";
import { getPageBlocks, localizedPath, type PageSummary } from "./pages";
import { isBuildPhase } from "./cache";
import { tabTitle, type SeoStored } from "./seo-schema";

/** Valeur de repli neutre : en production PUBLIC_BASE_URL doit être définie. */
const DEFAULT_BASE_URL = "http://localhost:3001";

/** Adresse publique du site (PUBLIC_BASE_URL), sans barre finale. */
export function publicBase(): string {
  const raw = process.env.PUBLIC_BASE_URL || DEFAULT_BASE_URL;
  try {
    return new URL(raw).toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export type ShareImage = { url: string; width: number; height: number };

/** Variante WebP d'au moins 1200 px de large (ce que les réseaux affichent), sinon la plus grande. */
export function pickShareVariant(webpSrcset: string, fallback: { url: string; w: number; h: number }): ShareImage {
  const items = webpSrcset
    .split(",")
    .map((s) => s.trim().split(/\s+/))
    .map(([url, w]) => ({ url, w: Number.parseInt(w ?? "", 10) }))
    .filter((x) => x.url && Number.isFinite(x.w))
    .sort((a, b) => a.w - b.w);
  const hit = items.find((x) => x.w >= 1200) ?? items.at(-1);
  if (!hit) return { url: fallback.url, width: fallback.w, height: fallback.h };
  const ratio = fallback.h / Math.max(1, fallback.w);
  return { url: hit.url, width: hit.w, height: Math.round(hit.w * ratio) };
}

/** Image de partage d'un média de la médiathèque (image prête seulement), ou null. */
export async function shareImageOfMedia(mediaId: number | null | undefined): Promise<ShareImage | null> {
  const m = await getMedia(mediaId);
  // Un SVG (décor du seed, sans variantes) n'est pas affiché par les réseaux sociaux : on passe à l'image suivante.
  if (!m || m.video || m.pdf || m.mime === "image/svg+xml") return null;
  if (m.sources) return pickShareVariant(m.sources.webp, { url: m.sources.largest.webp, w: m.sources.largest.w, h: m.sources.largest.h });
  return m.width && m.height ? { url: m.url, width: m.width, height: m.height } : null;
}

/**
 * Image de partage d'une page : celle choisie pour la page ; sinon la couverture de son contenu (première image, ou
 * première image du premier projet montré) ; sinon l'image du site.
 */
export async function pageShareImage(page: PageSummary, locale: AppLocale, seo: SeoStored): Promise<ShareImage | null> {
  const chosen = await shareImageOfMedia(page.meta?.image ?? null);
  if (chosen) return chosen;
  const blocks = await getPageBlocks(page.id);
  for (const b of blocks) {
    if (b.corrupt) continue;
    for (const id of extractRefs(b.type, b.props).media) {
      const found = await shareImageOfMedia(id);
      if (found) return found;
    }
  }
  for (const b of blocks) {
    if (b.corrupt) continue;
    for (const slug of extractProjectRefs(b.type, b.props)) {
      const project = await getProjectBoard(slug, locale);
      for (const a of project?.artworks ?? []) {
        if (a.mediaId && !a.video) {
          const found = await shareImageOfMedia(a.mediaId);
          if (found) return found;
        }
      }
    }
  }
  return shareImageOfMedia(seo.shareImage);
}

const OG_LOCALE: Record<string, string> = { fr: "fr_FR", en: "en_US" };

/** Titre, description, `og:*` et `twitter:card` d'une page publique. */
export async function pageSocialMetadata(opts: { page: PageSummary; locale: AppLocale; title: string; description: string; siteName: string; seo: SeoStored }): Promise<Metadata> {
  const { page, locale, siteName, seo } = opts;
  const title = tabTitle(opts.title, siteName);
  const description = opts.description || seo.description[locale] || seo.description.fr || undefined;
  const image = isBuildPhase() ? null : await pageShareImage(page, locale, seo);
  const url = localizedPath(page, locale);
  return {
    title,
    description,
    alternates: { canonical: url, languages: { ...Object.fromEntries(routing.locales.map((l) => [l, localizedPath(page, l)])), "x-default": localizedPath(page, routing.defaultLocale) } },
    openGraph: {
      type: "website",
      title,
      description,
      url,
      siteName,
      locale: OG_LOCALE[locale] ?? locale,
      alternateLocale: routing.locales.filter((l) => l !== locale).map((l) => OG_LOCALE[l] ?? l),
      ...(image ? { images: [{ url: image.url, width: image.width, height: image.height }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, ...(image ? { images: [image.url] } : {}) },
  };
}
