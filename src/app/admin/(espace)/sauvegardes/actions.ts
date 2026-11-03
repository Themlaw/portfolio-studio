"use server";

/**
 * Server actions de l'écran Sauvegardes (lot 76). Chacune : `await assertAdmin()`. Les réglages envoyés valent
 * `null` pour « revenir à la valeur d'origine » (variable d'environnement, sinon défaut).
 */
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import { LIMITS } from "@/lib/backup/config";
import { applyBackupSettings, getBackupStatus, startBackupNow, type BackupStatus } from "@/lib/backup/service";
import { writeBackupOverrides } from "@/lib/backup/settings";
import { done, fail, zodFieldErrors, type ActionResult } from "@/lib/edit/result";
import { audited } from "@/lib/journal/audit";

const Input = z.object({
  enabled: z.boolean().nullable(),
  media: z.boolean().nullable(),
  keep: z.number().int("Un nombre entier.").min(LIMITS.keep.min, `Au moins ${LIMITS.keep.min}.`).max(LIMITS.keep.max, `Au plus ${LIMITS.keep.max}.`).nullable(),
  quietMin: z.number().min(LIMITS.quietMin.min, `Au moins ${LIMITS.quietMin.min} minute.`).max(LIMITS.quietMin.max, `Au plus ${LIMITS.quietMin.max} minutes.`).nullable(),
  maxHours: z.number().min(LIMITS.maxHours.min, `Au moins ${LIMITS.maxHours.min} heure.`).max(LIMITS.maxHours.max, `Au plus ${LIMITS.maxHours.max} heures.`).nullable(),
});

export const saveBackupSettingsAction = audited("saveBackupSettingsAction", async function saveBackupSettingsAction(input: unknown): Promise<ActionResult<BackupStatus>> {
  await assertAdmin();
  const parsed = Input.safeParse(input);
  if (!parsed.success) return fail("Vérifie les réglages.", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const overrides = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null));
  writeBackupOverrides(overrides);
  await applyBackupSettings();
  return done(await getBackupStatus());
});

/** Lance une sauvegarde en fond et rend la main ; l'écran suit l'avancement avec `backupStatusAction`. */
export const backupNowAction = audited("backupNowAction", async function backupNowAction(): Promise<ActionResult<null>> {
  await assertAdmin();
  const r = await startBackupNow();
  return r.ok ? done(null) : fail(r.message);
});

export async function backupStatusAction(): Promise<ActionResult<BackupStatus>> {
  await assertAdmin();
  return done(await getBackupStatus());
}
