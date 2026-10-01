/** Écriture des réglages d'identité du site (admin). */
import { z } from "zod";

import { getDb, schema } from "@/lib/db";

import { done, fail, zodFieldErrors, type ActionResult } from "./result";

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
    name: z.string().trim().min(1, "Le nom du site est obligatoire.").max(80),
    role: localized,
    email: z.email("Adresse e-mail invalide (ex. nom@domaine.fr).").max(254),
    credit: localized,
  }),
  socials: z
    .array(z.object({ label: z.string().trim().min(1, "Donne un nom à ce réseau (ex. Instagram).").max(40), href: httpsUrl }))
    .max(12, "12 réseaux au plus."),
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
  });
  return done(null);
}
