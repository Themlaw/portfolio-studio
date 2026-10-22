/** « Premiers pas » du tableau de bord : étapes cochées par un geste réel (thème choisi, identité remplie) et masquage. */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";

import { done, fail, type ActionResult } from "./result";

const KEY = "onboarding";
export const OnboardingSchema = z.object({ theme: z.boolean().optional(), identity: z.boolean().optional(), hidden: z.boolean().optional() });
export type OnboardingState = z.infer<typeof OnboardingSchema>;

export function readOnboarding(): OnboardingState {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, KEY)).get();
  const parsed = OnboardingSchema.safeParse(parseJson(row?.value));
  return parsed.success ? parsed.data : {};
}

function write(next: OnboardingState): void {
  const value = JSON.stringify(next);
  getDb().insert(schema.settings).values({ key: KEY, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
}

/** Une étape faite par un vrai geste (jamais bloquant : une erreur d'écriture ne doit pas faire échouer l'action d'origine). */
export function markOnboarding(step: "theme" | "identity"): void {
  try {
    const cur = readOnboarding();
    if (!cur[step]) write({ ...cur, [step]: true });
  } catch (e) {
    console.error("[onboarding] écriture impossible", e);
  }
}

export function setOnboardingHidden(hidden: unknown): ActionResult<null> {
  if (typeof hidden !== "boolean") return fail("Valeur invalide.");
  write({ ...readOnboarding(), hidden });
  return done(null);
}
