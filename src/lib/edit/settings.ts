/** Écriture des réglages d'identité du site (admin). */
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { SocialsSchema } from "@/lib/site-schema";

import { done, fail, zodFieldErrors, type ActionResult } from "./result";
import { readSiteDraft } from "./site";

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
  // Réseaux : mêmes règles que sur la toile (http(s) ou mailto:, réseau reconnu).
  socials: SocialsSchema,
});

export type SettingsInput = z.infer<typeof SettingsSchema>;

export function saveSettings(input: unknown): ActionResult<null> {
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Certains champs sont invalides : corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  }
  // En-tête / réseaux en cours de modification sur une page : un seul état à la fois.
  const pending = readSiteDraft();
  if (pending) {
    const title = pageName(pending.pageId);
    return fail(`L'en-tête et les réseaux sont en cours de modification sur la page ${title} : publie-la ou abandonne ses modifications d'abord.`);
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

function pageName(id: number): string {
  const rows = getDb().select({ id: schema.pages.id, title: schema.pages.title }).from(schema.pages).all();
  return rows.find((r) => r.id === id)?.title.fr || `n° ${id}`;
}
