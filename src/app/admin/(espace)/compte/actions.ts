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

const ChangePassword = z
  .object({
    currentPassword: z.string().min(1, "Tape ton mot de passe actuel.").max(MAX_PASSWORD_LENGTH, `${MAX_PASSWORD_LENGTH} caractères au plus.`),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH, `Au moins ${MIN_PASSWORD_LENGTH} caractères.`).max(MAX_PASSWORD_LENGTH, `${MAX_PASSWORD_LENGTH} caractères au plus.`),
    confirm: z.string().max(MAX_PASSWORD_LENGTH, `${MAX_PASSWORD_LENGTH} caractères au plus.`),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Les deux mots de passe ne sont pas identiques." })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "Choisis un mot de passe différent de l'actuel." });

const apiCode = (error: unknown) => (error as { body?: { code?: unknown } } | null)?.body?.code;

export const changePasswordAction = audited("changePasswordAction", async function changePasswordAction(input: unknown): Promise<ActionResult<null>> {
  const session = await assertAdmin();
  const config = readAuthConfig();
  if (!config.passwordEnabled) return fail("La connexion par mot de passe est désactivée sur ce site : le mot de passe se gère dans Authentik.");
  const parsed = ChangePassword.safeParse(input);
  if (!parsed.success) return fail("Vérifie les champs.", zodFieldErrors(parsed.error.issues));
  const h = await headers();
  const ip = clientIpFromForwarded(h.get("x-forwarded-for"), config.trustedProxyHops) ?? UNKNOWN_IP;
  // Mêmes freins, mêmes compteurs et mêmes clés que la route /api/auth/change-password (complément #61) : IP réduite à son /64,
  // puis délai du couple (compte, IP), puis délai du compte toutes IP confondues. Avant : clé par adresse IPv6 entière et aucun
  // frein par compte, donc l'action restait un oracle du mot de passe actuel pour qui change d'adresse dans son /64 ou d'IP.
  const who = session.user.email.trim().toLowerCase();
  const bucket = ipBucket(ip);
  const ipWait = ipAttempt(bucket);
  if (ipWait > 0) return fail(`Trop d'essais depuis cette adresse : réessaie dans ${ipWait} s.`);
  const wait = Math.max(waitSeconds(who, bucket), accountWaitSeconds(who, bucket));
  if (wait > 0) {
    noteThrottledAttempt(who);
    return fail(`Trop d'échecs pour ce compte : réessaie dans ${wait} s.`);
  }
  try {
    await getAuth().api.changePassword({ body: { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword, revokeOtherSessions: true }, headers: h });
  } catch (error) {
    const code = apiCode(error);
    if (code === "INVALID_PASSWORD") {
      recordFailure(who, bucket);
      console.warn(`[auth] changement de mot de passe refusé (mot de passe actuel incorrect), IP ${ip}`);
      return fail("Mot de passe actuel incorrect.", { currentPassword: "Mot de passe actuel incorrect." });
    }
    if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
      const range = `Entre ${MIN_PASSWORD_LENGTH} et ${MAX_PASSWORD_LENGTH} caractères.`;
      return fail(range, { newPassword: range });
    }
    if (code === "CREDENTIAL_ACCOUNT_NOT_FOUND") return fail("Ce compte n'a pas de mot de passe (connexion par Authentik).");
    throw error;
  }
  recordSuccess(who, bucket);
  console.log("[auth] mot de passe changé depuis l'admin : toutes les autres sessions sont déconnectées");
  return done(null);
});

export const revokeOtherSessionsAction = audited("revokeOtherSessionsAction", async function revokeOtherSessionsAction(): Promise<ActionResult<{ revoked: number }>> {
  const session = await assertAdmin();
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
  const parsed = parseAdminLang(lang);
  if (!parsed) {
    const t = makeAdminTranslator("fr", await loadAdminMessages("fr"), "account");
    return fail(t("langInvalid"));
  }
  writeUserAdminLang(session.user.id, parsed);
  const h = await headers();
  (await cookies()).set(ADMIN_LANG_COOKIE, parsed, { path: "/", maxAge: ADMIN_LANG_COOKIE_MAX_AGE, sameSite: "lax", secure: h.get("x-forwarded-proto") === "https" });
  return done({ lang: parsed });
});
