/**
 * Résolution d'une page pour le rendu public, avec l'aperçu de l'admin :
 * une page NON publiée n'est rendue qu'en draft mode ET avec une session admin
 * valide (« Prévisualiser la page ↗ » de l'éditeur). Hors draft mode, seules
 * les pages publiées existent (index en cache).
 */
import { draftMode } from "next/headers";
import { cache } from "react";

import type { AppLocale } from "@/i18n/routing";

import { getAdminSession } from "./auth/guard";
import { isBuildPhase } from "./cache";
import { getDb, schema } from "./db";
import { findPage, type PageSummary } from "./pages";

/** Aperçu de l'admin actif (draft mode + session valide) ? */
export const isAdminPreview = cache(async (): Promise<boolean> => {
  if (isBuildPhase()) return false;
  if (!(await draftMode()).isEnabled) return false;
  return Boolean(await getAdminSession());
});

export const resolvePage = cache(async (locale: AppLocale, segments: string[] = []): Promise<PageSummary | null> => {
  const page = await findPage(locale, segments);
  if (page || !(await isAdminPreview())) return page;
  const wanted = segments.join("/");
  const row = getDb()
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      title: schema.pages.title,
      meta: schema.pages.meta,
      navOrder: schema.pages.navOrder,
      themeOverrides: schema.pages.themeOverrides,
    })
    .from(schema.pages)
    .all()
    .find((p) => (p.slug[locale] ?? "") === wanted);
  return row ? (row as PageSummary) : null;
});
