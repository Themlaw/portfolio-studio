/**
 * Nouvelle saisie du mot de passe avant une opération sensible (audit de sécurité, P2 : téléchargement d'une sauvegarde).
 *
 * Même frein que la connexion (throttle.ts), sur des compteurs à part (préfixe `reauth`) : au plus IP_MAX essais par minute et
 * par IP, puis délai progressif par compte et par IP. Sans ça, l'écran deviendrait un oracle du mot de passe pour qui a volé un
 * cookie de session. Vérification par Better Auth (`verifyPassword`, empreinte scrypt du compte de la session).
 */
import { getAuth } from "./index";
import { clientIpFromForwarded, UNKNOWN_IP } from "./client-ip";
import { readAuthConfig } from "./config";
import { ipAttempt, recordFailure, recordSuccess, waitSeconds } from "./throttle";

export type ReauthResult = { ok: true } | { ok: false; reason: "disabled" | "wrong" | "throttled"; wait?: number };

export async function verifyCurrentPassword(requestHeaders: Headers, email: string, password: string): Promise<ReauthResult> {
  const config = readAuthConfig();
  if (!config.passwordEnabled) return { ok: false, reason: "disabled" };
  const ip = clientIpFromForwarded(requestHeaders.get("x-forwarded-for"), config.trustedProxyHops) ?? UNKNOWN_IP;
  const ipWait = ipAttempt(`reauth|${ip}`);
  if (ipWait > 0) return { ok: false, reason: "throttled", wait: ipWait };
  const who = `reauth|${email.trim().toLowerCase()}`;
  const wait = waitSeconds(who, ip);
  if (wait > 0) return { ok: false, reason: "throttled", wait };
  try {
    await getAuth().api.verifyPassword({ body: { password }, headers: requestHeaders });
  } catch {
    recordFailure(who, ip);
    console.warn(`[auth] mot de passe incorrect à la confirmation (téléchargement d'une sauvegarde), IP ${ip}`);
    return { ok: false, reason: "wrong" };
  }
  recordSuccess(who, ip);
  return { ok: true };
}
