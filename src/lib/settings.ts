import { z } from "zod";

import type { AppLocale } from "@/i18n/routing";

import { cached, TAGS } from "./cache";
import { getDb, schema } from "./db";
import { getDraftSite } from "./draft-view";
import { parseJson } from "./json";
import { NavSchema, NETWORKS, safeSocialHref, type NavItem } from "./site-schema";

const localized = z.object({ fr: z.string(), en: z.string() });

/** Réglages validés ; une valeur absente ou corrompue retombe sur un défaut sûr. */
const siteSchema = z.object({
  name: z.string().min(1),
  role: localized,
  email: z.string(),
  credit: localized,
});
const socialsSchema = z.array(z.object({ label: z.string().min(1), href: z.string(), kind: z.enum(NETWORKS).optional() }));

const DEFAULT_SITE: z.infer<typeof siteSchema> = {
  name: "Portfolio",
  role: { fr: "", en: "" },
  email: "",
  credit: { fr: "", en: "" },
};

export type Social = z.infer<typeof socialsSchema>[number];
export type SiteIdentity = { name: string; role: string; email: string; credit: string };

async function getRawSettings(): Promise<Record<string, unknown>> {
  return cached(["settings"], [TAGS.settings], () => {
    const rows = getDb().select().from(schema.settings).all();
    return Object.fromEntries(rows.map((r) => [r.key, parseJson(r.value)]));
  });
}

function validated<T>(key: string, value: unknown, schema: z.ZodType<T>, fallback: T): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  console.error(`[settings] « ${key} » absent ou invalide, valeur par défaut utilisée`);
  return fallback;
}

export async function getSite(locale: AppLocale): Promise<SiteIdentity> {
  const raw = validated("site", (await getRawSettings()).site, siteSchema, DEFAULT_SITE);
  return { name: raw.name, email: raw.email, role: raw.role[locale] ?? raw.role.fr, credit: raw.credit[locale] ?? raw.credit.fr };
}

/**
 * Réseaux publiés : chaque lien est revalidé à la lecture (une donnée ancienne
 * ou un lien « à compléter » n'est jamais rendu).
 */
export async function getSocials(): Promise<Social[]> {
  return validated("socials", (await getRawSettings()).socials, socialsSchema, []).filter((s) => safeSocialHref(s.href));
}

/** Menu publié (réglage `nav`, v0.13), ou null avant la migration. */
export async function getNavSetting(): Promise<NavItem[] | null> {
  const raw = (await getRawSettings()).nav;
  if (raw === undefined) return null;
  const parsed = NavSchema.safeParse(raw);
  if (!parsed.success) console.error("[settings] « nav » invalide, menu des pages utilisé");
  return parsed.success ? parsed.data : null;
}

export type SiteView = { site: SiteIdentity; socials: Social[]; nav: NavItem[] | null; draft: boolean };

/**
 * Identité, réseaux et menu tels que la page `pageId` les montre : la version
 * publiée, ou — vue brouillon de l'éditeur, page qui tient le brouillon de
 * l'en-tête — ce brouillon (src/lib/edit/site.ts).
 */
export async function getSiteView(locale: AppLocale, pageId: number | null | undefined): Promise<SiteView> {
  const draft = pageId ? await getDraftSite(pageId) : null;
  if (draft) {
    const i = draft.identity;
    return {
      site: { name: i.name, email: i.email, role: i.role[locale] || i.role.fr, credit: i.credit[locale] || i.credit.fr },
      socials: draft.socials.filter((s) => safeSocialHref(s.href)),
      nav: draft.nav,
      draft: true,
    };
  }
  const [site, socials, nav] = await Promise.all([getSite(locale), getSocials(), getNavSetting()]);
  return { site, socials, nav, draft: false };
}
