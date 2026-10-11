import { z } from "zod";

import type { AppLocale } from "@/i18n/routing";

import { cached, TAGS } from "./cache";
import { getDb, schema } from "./db";
import { getDraftSite } from "./draft-view";
import { parseJson } from "./json";
import { fontFaceCss, readLibrary } from "./fonts/faces";
import { SiteStylesSchema, type SiteStyles } from "./look";
import { NavSchema, NETWORKS, safeSocialHref, type NavItem } from "./site-schema";

const localized = z.object({ fr: z.string(), en: z.string() });

/** Réglages validés ; une valeur absente ou corrompue retombe sur un défaut sûr. */
const siteSchema = z.object({
  name: z.string().min(1),
  role: localized,
  email: z.string(),
  credit: localized,
  headerSocials: z.boolean().optional(),
});
const socialsSchema = z.array(z.object({ label: z.string().min(1), href: z.string(), kind: z.enum(NETWORKS).optional() }));

const DEFAULT_SITE: z.infer<typeof siteSchema> = {
  name: "Portfolio",
  role: { fr: "", en: "" },
  email: "",
  credit: { fr: "", en: "" },
};

export type Social = z.infer<typeof socialsSchema>[number];
export type SiteIdentity = { name: string; role: string; email: string; credit: string; headerSocials: boolean };

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
  return { name: raw.name, email: raw.email, role: raw.role[locale] ?? raw.role.fr, credit: raw.credit[locale] ?? raw.credit.fr, headerSocials: raw.headerSocials === true };
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

/** Styles du site publiés (lot 2) : rôles de texte, arrondi ; absents = thème seul. */
export async function getSiteStyles(): Promise<SiteStyles | undefined> {
  const raw = (await getRawSettings()).styles;
  if (raw === undefined) return undefined;
  const parsed = SiteStylesSchema.safeParse(raw);
  if (!parsed.success) console.error("[settings] « styles » invalide, styles du thème utilisés");
  return parsed.data;
}

/** Feuille @font-face des polices Google téléchargées par le serveur (lot 2). */
export async function getFontFacesCss(): Promise<string> {
  return fontFaceCss(readLibrary((await getRawSettings()).fontLibrary));
}

export type SiteView = { site: SiteIdentity; socials: Social[]; nav: NavItem[] | null; draft: boolean; styles?: SiteStyles };

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
      site: { name: i.name, email: i.email, role: i.role[locale] || i.role.fr, credit: i.credit[locale] || i.credit.fr, headerSocials: i.headerSocials === true },
      socials: draft.socials.filter((s) => safeSocialHref(s.href)),
      nav: draft.nav,
      draft: true,
      styles: draft.styles,
    };
  }
  const [site, socials, nav, styles] = await Promise.all([getSite(locale), getSocials(), getNavSetting(), getSiteStyles()]);
  return { site, socials, nav, draft: false, styles };
}
