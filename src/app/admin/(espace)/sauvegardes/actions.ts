"use server";

/**
 * Server actions de l'écran Sauvegardes (lot 76). Chacune : `await assertAdmin()`. Les réglages envoyés valent
 * `null` pour « revenir à la valeur d'origine » (variable d'environnement, sinon défaut).
 */
import { cookies, headers } from "next/headers";
import { z } from "zod";

import { readAuthConfig } from "@/lib/auth/config";
import { assertAdmin } from "@/lib/auth/guard";
import { verifyCurrentPassword } from "@/lib/auth/reauth";
import { isFreshSession, isUnlocked, UNLOCK_COOKIE, UNLOCK_PATH, UNLOCK_TTL_MS, unlockValue } from "@/lib/backup/unlock";
import { LIMITS } from "@/lib/backup/config";
import { applyBackupSettings, getBackupStatus, startBackupNow, type BackupStatus } from "@/lib/backup/service";
import { writeBackupOverrides } from "@/lib/backup/settings";
import { done, fail, zodFieldErrors, type ActionResult } from "@/lib/edit/result";
import { audited } from "@/lib/journal/audit";
import { adminT } from "@/i18n/admin-msg";

export const saveBackupSettingsAction = audited("saveBackupSettingsAction", async function saveBackupSettingsAction(input: unknown): Promise<ActionResult<BackupStatus>> {
  await assertAdmin();
  const t = adminT("actions");
  const Input = z.object({
    enabled: z.boolean().nullable(),
    media: z.boolean().nullable(),
    keep: z.number().int(t("integer")).min(LIMITS.keep.min, t("atLeast", { n: LIMITS.keep.min })).max(LIMITS.keep.max, t("atMost", { n: LIMITS.keep.max })).nullable(),
    quietMin: z.number().min(LIMITS.quietMin.min, t("atLeastMinutes", { n: LIMITS.quietMin.min })).max(LIMITS.quietMin.max, t("atMostMinutes", { n: LIMITS.quietMin.max })).nullable(),
    maxHours: z.number().min(LIMITS.maxHours.min, t("atLeastHours", { n: LIMITS.maxHours.min })).max(LIMITS.maxHours.max, t("atMostHours", { n: LIMITS.maxHours.max })).nullable(),
  });
  const parsed = Input.safeParse(input);
  if (!parsed.success) return fail(t("Vérifie les réglages."), zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const overrides = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null));
  writeBackupOverrides(overrides);
  await applyBackupSettings();
  return done(await getBackupStatus());
});

/** Lance une sauvegarde en fond et rend la main ; l'écran suit l'avancement avec `backupStatusAction`. */
export const backupNowAction = audited("backupNowAction", async function backupNowAction(): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const r = await startBackupNow();
  return r.ok ? done(null) : fail(r.message);
});

const Unlock = z.object({ password: z.string().max(256).optional() });

/**
 * Déverrouille le téléchargement des sauvegardes pour 10 minutes (audit de sécurité P2) : connexion récente, ou mot de passe
 * retapé (même frein que la connexion). Pose un cookie lié à CETTE session, limité au chemin des téléchargements.
 * `fieldErrors.reauth` : "password" (le demander), "relogin" (connexion par Authentik : se reconnecter), "wrong", "throttled".
 */
export const unlockBackupDownloadAction = audited("unlockBackupDownloadAction", async function unlockBackupDownloadAction(input: unknown): Promise<ActionResult<null>> {
  const session = await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const parsed = Unlock.safeParse(input ?? {});
  if (!parsed.success) return fail(t("Mot de passe trop long."));
  const auth = readAuthConfig();
  const jar = await cookies();
  const grant = () => {
    jar.set(UNLOCK_COOKIE, unlockValue(auth.secret, session.session.id), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: UNLOCK_PATH, maxAge: UNLOCK_TTL_MS / 1000 });
    return done(null);
  };
  if (isFreshSession(session.session.createdAt) || isUnlocked(auth.secret, session.session.id, jar.get(UNLOCK_COOKIE)?.value)) return grant();
  if (!auth.passwordEnabled) return fail(t("Pour télécharger une sauvegarde, reconnecte-toi (ta connexion date de plus de 10 minutes)."), { reauth: "relogin" });
  const password = parsed.data.password ?? "";
  if (!password) return fail(t("Confirme ton mot de passe pour télécharger une sauvegarde."), { reauth: "password" });
  const r = await verifyCurrentPassword(await headers(), session.user.email, password);
  if (r.ok) return grant();
  if (r.reason === "throttled") return fail(t("tooManyTries", { wait: r.wait ?? 60 }), { reauth: "throttled" });
  if (r.reason === "disabled") return fail(t("Pour télécharger une sauvegarde, reconnecte-toi."), { reauth: "relogin" });
  return fail(t("Mot de passe incorrect."), { reauth: "wrong" });
});

export async function backupStatusAction(): Promise<ActionResult<BackupStatus>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  return done(await getBackupStatus());
}
