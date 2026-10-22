"use server";

/** Server action des « Premiers pas » : masquer ou réafficher la liste du tableau de bord. */
import { assertAdmin } from "@/lib/auth/guard";
import { setOnboardingHidden } from "@/lib/edit/onboarding";
import type { ActionResult } from "@/lib/edit/result";

export async function setOnboardingHiddenAction(hidden: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  return setOnboardingHidden(hidden);
}
