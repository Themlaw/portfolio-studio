import { z } from "zod";

import type { AppLocale } from "@/i18n/routing";

import { cached, TAGS } from "./cache";
import { getDb, schema } from "./db";
import { parseJson } from "./json";

const localized = z.object({ fr: z.string(), en: z.string() });

/** Réglages validés ; une valeur absente ou corrompue retombe sur un défaut sûr. */
const siteSchema = z.object({
  name: z.string().min(1),
  role: localized,
  email: z.string(),
  credit: localized,
});
const socialsSchema = z.array(z.object({ label: z.string().min(1), href: z.string() }));

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

export async function getSocials(): Promise<Social[]> {
  return validated("socials", (await getRawSettings()).socials, socialsSchema, []);
}
