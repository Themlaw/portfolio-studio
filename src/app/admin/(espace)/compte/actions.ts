"use server";

/**
 * Server actions de l'écran « Sécurité du compte » (audit de sécurité, P3). Chacune : `await assertAdmin()`, journalisée.
 *  - changer le mot de passe : TOUJOURS avec déconnexion des autres sessions (forcée aussi côté Better Auth, crochet `before`
 *    de src/lib/auth/index.ts, pour qui appellerait /api/auth/change-password directement) ; même frein que la connexion
 *    (5 essais par minute et par IP, puis délai par compte) : l'action ne devient pas un oracle du mot de passe actuel ;
 *  - déconnecter les autres sessions (la session en cours reste).
 */
import { cookies, headers } from "next/headers";
import { z } from "zod";

import { ADMIN_LANG_COOKIE, ADMIN_LANG_COOKIE_MAX_AGE, makeAdminTranslator, loadAdminMessages, parseAdminLang, type AdminLang } from "@/i18n/admin-lang";
import { adminT } from "@/i18n/admin-msg";
import { writeUserAdminLang } from "@/lib/admin-lang";
import { getAuth } from "@/lib/auth";
import { clientIpFromForwarded, ipBucket, UNKNOWN_IP } from "@/lib/auth/client-ip";
import { readAuthConfig } from "@/lib/auth/config";
import { assertAdmin } from "@/lib/auth/guard";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { revokeOtherUserSessions } from "@/lib/auth/sessions";
import { accountWaitSeconds, ipAttempt, noteThrottledAttempt, recordFailure, recordSuccess, waitSeconds } from "@/lib/auth/throttle";
import { done, fail, zodFieldErrors, type ActionResult } from "@/lib/edit/result";
import { audited } from "@/lib/journal/audit";

const apiCode = (error: unknown) => (error as { body?: { code?: unknown } } | null)?.body?.code;

export const changePasswordAction = audited("changePasswordAction", async function changePasswordAction(input: unknown): Promise<ActionResult<null>> {
  const session = await assertAdmin();
  const t = adminT("actions");
  const config = readAuthConfig();
  if (!config.passwordEnabled) return fail(t("passwordDisabled"));
  const ChangePassword = z
    .object({
      currentPassword: z.string().min(1, t("passwordCurrentRequired")).max(MAX_PASSWORD_LENGTH, t("passwordMaxChars", { max: MAX_PASSWORD_LENGTH })),
      newPassword: z.string().min(MIN_PASSWORD_LENGTH, t("passwordMinChars", { min: MIN_PASSWORD_LENGTH })).max(MAX_PASSWORD_LENGTH, t("passwordMaxChars", { max: MAX_PASSWORD_LENGTH })),
      confirm: z.string().max(MAX_PASSWORD_LENGTH, t("passwordMaxChars", { max: MAX_PASSWORD_LENGTH })),
    })
    .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: t("passwordsMismatch") })
    .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: t("passwordDifferent") });
  const parsed = ChangePassword.safeParse(input);
  if (!parsed.success) return fail(t("checkFields"), zodFieldErrors(parsed.error.issues));
  const h = await headers();
  const ip = clientIpFromForwarded(h.get("x-forwarded-for"), config.trustedProxyHops) ?? UNKNOWN_IP;
  // Mêmes freins, mêmes compteurs et mêmes clés que la route /api/auth/change-password (complément #61) : IP réduite à son /64,
  // puis délai du couple (compte, IP), puis délai du compte toutes IP confondues. Avant : clé par adresse IPv6 entière et aucun
  // frein par compte, donc l'action restait un oracle du mot de passe actuel pour qui change d'adresse dans son /64 ou d'IP.
  const who = session.user.email.trim().toLowerCase();
  const bucket = ipBucket(ip);
  const ipWait = ipAttempt(bucket);
  if (ipWait > 0) return fail(t("tooManyFromIp", { wait: ipWait }));
  const wait = Math.max(waitSeconds(who, bucket), accountWaitSeconds(who, bucket));
  if (wait > 0) {
    noteThrottledAttempt(who);
    return fail(t("tooManyForAccount", { wait }));
  }
  try {
    await getAuth().api.changePassword({ body: { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword, revokeOtherSessions: true }, headers: h });
  } catch (error) {
    const code = apiCode(error);
    if (code === "INVALID_PASSWORD") {
      recordFailure(who, bucket);
      console.warn(`[auth] changement de mot de passe refusé (mot de passe actuel incorrect), IP ${ip}`);
      return fail(t("currentPasswordWrong"), { currentPassword: t("currentPasswordWrong") });
    }
    if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
      const range = t("betweenChars", { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH });
      return fail(range, { newPassword: range });
    }
    if (code === "CREDENTIAL_ACCOUNT_NOT_FOUND") return fail(t("noPasswordAccount"));
    throw error;
  }
  recordSuccess(who, bucket);
  console.log("[auth] mot de passe changé depuis l'admin : toutes les autres sessions sont déconnectées");
  return done(null);
});

export const revokeOtherSessionsAction = audited("revokeOtherSessionsAction", async function revokeOtherSessionsAction(): Promise<ActionResult<{ revoked: number }>> {
  const session = await assertAdmin();
  const t = adminT("actions");
  const revoked = revokeOtherUserSessions(session.user.id, session.session.id);
  console.log(`[auth] ${revoked} autre(s) session(s) déconnectée(s) depuis l'admin`);
  return done({ revoked });
});

/**
 * Langue de l'interface d'administration (lot 130) : réglage du compte (settings) + cookie pour la connexion et les appareils
 * sans session. N'agit QUE sur l'interface : le contenu FR / EN du site et de l'éditeur ne change pas.
 */
export const setAdminLangAction = audited("setAdminLangAction", async function setAdminLangAction(lang: unknown): Promise<ActionResult<{ lang: AdminLang }>> {
  const session = await assertAdmin();
  const t = adminT("actions");
  const parsed = parseAdminLang(lang);
  if (!parsed) {
    const tt = makeAdminTranslator("fr", await loadAdminMessages("fr"), "account");
    return fail(tt("langInvalid"));
  }
  writeUserAdminLang(session.user.id, parsed);
  const h = await headers();
  (await cookies()).set(ADMIN_LANG_COOKIE, parsed, { path: "/", maxAge: ADMIN_LANG_COOKIE_MAX_AGE, sameSite: "lax", secure: h.get("x-forwarded-proto") === "https" });
  return done({ lang: parsed });
});
