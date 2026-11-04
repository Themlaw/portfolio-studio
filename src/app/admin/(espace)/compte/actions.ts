"use server";

/**
 * Server actions de l'écran « Sécurité du compte » (audit de sécurité, P3). Chacune : `await assertAdmin()`, journalisée.
 *  - changer le mot de passe : TOUJOURS avec déconnexion des autres sessions (forcée aussi côté Better Auth, crochet `before`
 *    de src/lib/auth/index.ts, pour qui appellerait /api/auth/change-password directement) ; même frein que la connexion
 *    (5 essais par minute et par IP, puis délai par compte) : l'action ne devient pas un oracle du mot de passe actuel ;
 *  - déconnecter les autres sessions (la session en cours reste).
 */
import { headers } from "next/headers";
import { z } from "zod";

import { getAuth } from "@/lib/auth";
import { clientIpFromForwarded, UNKNOWN_IP } from "@/lib/auth/client-ip";
import { readAuthConfig } from "@/lib/auth/config";
import { assertAdmin } from "@/lib/auth/guard";
import { revokeOtherUserSessions } from "@/lib/auth/sessions";
import { ipAttempt, recordFailure, recordSuccess, waitSeconds } from "@/lib/auth/throttle";
import { done, fail, zodFieldErrors, type ActionResult } from "@/lib/edit/result";
import { audited } from "@/lib/journal/audit";

const ChangePassword = z
  .object({
    currentPassword: z.string().min(1, "Tape ton mot de passe actuel.").max(128, "128 caractères au plus."),
    newPassword: z.string().min(8, "Au moins 8 caractères.").max(128, "128 caractères au plus."),
    confirm: z.string().max(128, "128 caractères au plus."),
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
  const who = `chpw|${session.user.email.toLowerCase()}`;
  const wait = Math.max(ipAttempt(`chpw|${ip}`), waitSeconds(who, ip));
  if (wait > 0) return fail(`Trop d'essais : réessaie dans ${wait} s.`);
  try {
    await getAuth().api.changePassword({ body: { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword, revokeOtherSessions: true }, headers: h });
  } catch (error) {
    const code = apiCode(error);
    if (code === "INVALID_PASSWORD") {
      recordFailure(who, ip);
      console.warn(`[auth] changement de mot de passe refusé (mot de passe actuel incorrect), IP ${ip}`);
      return fail("Mot de passe actuel incorrect.", { currentPassword: "Mot de passe actuel incorrect." });
    }
    if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") return fail("Entre 8 et 128 caractères.", { newPassword: "Entre 8 et 128 caractères." });
    if (code === "CREDENTIAL_ACCOUNT_NOT_FOUND") return fail("Ce compte n'a pas de mot de passe (connexion par Authentik).");
    throw error;
  }
  recordSuccess(who, ip);
  console.log("[auth] mot de passe changé depuis l'admin : toutes les autres sessions sont déconnectées");
  return done(null);
});

export const revokeOtherSessionsAction = audited("revokeOtherSessionsAction", async function revokeOtherSessionsAction(): Promise<ActionResult<{ revoked: number }>> {
  const session = await assertAdmin();
  const revoked = revokeOtherUserSessions(session.user.id, session.session.id);
  console.log(`[auth] ${revoked} autre(s) session(s) déconnectée(s) depuis l'admin`);
  return done({ revoked });
});
