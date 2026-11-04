import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";
import { CLIENT_IP_HEADER, clientIpFromForwarded, UNKNOWN_IP } from "@/lib/auth/client-ip";
import { readAuthConfig } from "@/lib/auth/config";
import { ipAttempt, recordFailure, recordSuccess, waitSeconds } from "@/lib/auth/throttle";
import { recordEvent } from "@/lib/journal/audit";

export const dynamic = "force-dynamic";

/**
 * Toutes les routes Better Auth (/api/auth/sign-in/email, /sign-in/social,
 * /callback/authentik, /sign-out, /get-session…), précédées de :
 *  - l'IP client calculée selon AUTH_TRUSTED_PROXY_HOPS (en-tête interne,
 *    toute valeur venue de l'extérieur est écrasée) ;
 *  - sur /sign-in/email : limite par IP (toutes tentatives comptées), PUIS
 *    délai progressif par couple (e-mail, IP) — voir src/lib/auth/throttle.ts.
 */

/** Identifiant interne de l'utilisateur connecté par la réponse de Better Auth (`{ user: { id } }`), jamais l'e-mail. */
async function signedInUser(response: Response): Promise<string | null> {
  try {
    const data = (await response.clone().json()) as { user?: { id?: unknown } };
    return typeof data?.user?.id === "string" ? data.user.id : null;
  } catch {
    return null;
  }
}

function tooMany(code: string, message: string, wait: number): Response {
  return Response.json(
    { code, message, retryAfter: wait },
    { status: 429, headers: { "Retry-After": String(wait), "Cache-Control": "no-store" } },
  );
}
async function handle(request: Request, method: "GET" | "POST"): Promise<Response> {
  const config = readAuthConfig();
  const headers = new Headers(request.headers);
  const ip = clientIpFromForwarded(headers.get("x-forwarded-for"), config.trustedProxyHops) ?? UNKNOWN_IP;
  headers.set(CLIENT_IP_HEADER, ip);

  const body = method === "POST" ? await request.text() : undefined;
  const forward = new Request(request.url, { method, headers, body });
  const handler = toNextJsHandler(getAuth());

  const pathname = new URL(request.url).pathname;
  // Changement de mot de passe : journalisé (docs/SECURITE.md P5), réussite comme échec, avec le compte de la session.
  if (method === "POST" && pathname.replace(/\/+$/, "").endsWith("/change-password")) {
    const session = await getAuth().api.getSession({ headers }).catch(() => null);
    const response = await handler.POST(forward);
    recordEvent({
      action: "auth:change-password",
      type: "compte",
      user: session?.user.id ?? null,
      result: response.ok ? "ok" : "refus",
      label: response.ok ? "Mot de passe changé" : "Changement de mot de passe refusé",
      reason: response.ok ? null : `HTTP ${response.status}`,
    });
    return response;
  }
  if (method !== "POST" || !pathname.endsWith("/sign-in/email")) {
    return handler[method](forward);
  }

  // 1. Limite par IP, avant tout : chaque tentative compte, refus compris.
  const ipWait = ipAttempt(ip);
  if (ipWait > 0) {
    return tooMany("IP_RATE_LIMITED", `Trop de tentatives depuis cette adresse : réessaie dans ${ipWait} s.`, ipWait);
  }

  let email: string | null = null;
  try {
    const parsed = JSON.parse(body ?? "{}") as { email?: unknown };
    email = typeof parsed.email === "string" ? parsed.email.trim().toLowerCase() : null;
  } catch {
    email = null;
  }
  // 2. Délai progressif propre à ce compte DEPUIS cette IP.
  if (email) {
    const wait = waitSeconds(email, ip);
    if (wait > 0) {
      return tooMany("ACCOUNT_THROTTLED", `Trop d'échecs pour ce compte : réessaie dans ${wait} s.`, wait);
    }
  }

  const response = await handler.POST(forward);
  if (email) {
    if (response.status === 401) recordFailure(email, ip);
    else if (response.ok) recordSuccess(email, ip);
  }
  // Journal (P5) : connexion réussie (compte interne) ou échec (anonyme, débit borné) ; ni l'e-mail tenté ni l'IP.
  if (response.ok) recordEvent({ action: "auth:sign-in", type: "compte", user: await signedInUser(response), result: "ok", label: "Connexion (mot de passe)" });
  else if (response.status === 401) recordEvent({ action: "auth:sign-in", type: "compte", user: null, result: "refus", label: "Connexion refusée (mot de passe)", reason: "identifiants invalides" });
  return response;
}

export function GET(request: Request) {
  return handle(request, "GET");
}

export function POST(request: Request) {
  return handle(request, "POST");
}
