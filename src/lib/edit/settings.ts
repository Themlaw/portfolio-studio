/** Écriture des réglages d'identité du site (admin). */
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { SiteNameSchema, SocialsSchema } from "@/lib/site-schema";

import { markOnboarding } from "./onboarding";
import { done, fail, zodFieldErrors, type ActionResult } from "./result";
import { syncSiteDraftWithPublished } from "./site";

const localized = z.object({ fr: z.string().trim().max(160), en: z.string().trim().max(160) });

/** URL de réseau : https uniquement (refuse javascript:, data:, http:…). */
export const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && Boolean(u.hostname);
    } catch {
      return false;
    }
  }, "Adresse web invalide : elle doit commencer par https:// (ex. https://www.instagram.com/…).");

export const SettingsSchema = z.object({
  site: z.object({
    name: SiteNameSchema,
    role: localized,
    email: z.email("Adresse e-mail invalide (ex. nom@domaine.fr).").max(254),
    credit: localized,
    /** Icônes des réseaux dans l'en-tête (v0.13.1). */
    headerSocials: z.boolean().optional(),
  }),
  // Réseaux : mêmes règles que sur la toile (http(s) ou mailto:, réseau reconnu).
  socials: SocialsSchema,
});

export type SettingsInput = z.infer<typeof SettingsSchema>;

export function saveSettings(input: unknown): ActionResult<null> {
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Certains champs sont invalides : corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  }
  const db = getDb();
  db.transaction((tx) => {
    for (const [key, value] of [
      ["site", parsed.data.site],
      ["socials", parsed.data.socials],
    ] as const) {
      tx.insert(schema.settings)
        .values({ key, value: JSON.stringify(value) })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: JSON.stringify(value) } })
        .run();
    }
    // Brouillon commun du site (lot 96) : il reprend ces valeurs pour ne pas les ré-écraser à la publication d'une page.
    syncSiteDraftWithPublished(parsed.data.site, parsed.data.socials);
  });
  markOnboarding("identity");
  return done(null);
}
