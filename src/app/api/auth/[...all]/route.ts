import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";
import { CLIENT_IP_HEADER, clientIpFromForwarded, ipBucket, UNKNOWN_IP } from "@/lib/auth/client-ip";
import { readAuthConfig } from "@/lib/auth/config";
import { accountWaitSeconds, authEndpoint, ipAttempt, recordFailure, recordSuccess, waitSeconds } from "@/lib/auth/throttle";

export const dynamic = "force-dynamic";

/**
 * Toutes les routes Better Auth (/api/auth/sign-in/email, /sign-in/social,
 * /callback/authentik, /sign-out, /get-session…), précédées de :
 *  - l'IP client calculée selon AUTH_TRUSTED_PROXY_HOPS (en-tête interne,
 *    toute valeur venue de l'extérieur est écrasée) ;
 *  - sur /sign-in/email ET /change-password (qui vérifie le mot de passe
 *    actuel : même oracle, docs/SECURITE.md P4) : limite par IP (toutes
 *    tentatives comptées, IPv6 par /64), PUIS délai progressif par couple
 *    (e-mail, IP), PUIS délai borné par compte (toutes IP) — voir
 *    src/lib/auth/throttle.ts. Le chemin est normalisé avant le test
 *    (barres en trop, encodage) : aucune variante n'échappe au frein.
 */

function tooMany(code: string, message: string, wait: number): Response {
  return Response.json(
    { code, message, retryAfter: wait },
    { status: 429, headers: { "Retry-After": String(wait), "Cache-Control": "no-store" } },
  );
}

/** Code d'erreur Better Auth d'une réponse JSON (copie : le corps reste lisible par le client). */
async function errorCode(response: Response): Promise<string | null> {
  try {
    const data = (await response.clone().json()) as { code?: unknown };
    return typeof data?.code === "string" ? data.code : null;
  } catch {
    return null;
  }
}

async function handle(request: Request, method: "GET" | "POST"): Promise<Response> {
  const config = readAuthConfig();
  const headers = new Headers(request.headers);
  const ip = clientIpFromForwarded(headers.get("x-forwarded-for"), config.trustedProxyHops) ?? UNKNOWN_IP;
  headers.set(CLIENT_IP_HEADER, ip);

  const body = method === "POST" ? await request.text() : undefined;
  const forward = new Request(request.url, { method, headers, body });
  const handler = toNextJsHandler(getAuth());

  const endpoint = method === "POST" ? authEndpoint(new URL(request.url).pathname) : null;
  if (endpoint !== "/sign-in/email" && endpoint !== "/change-password") {
    return handler[method](forward);
  }
  const bucket = ipBucket(ip);

  // 1. Limite par IP, avant tout : chaque tentative compte, refus compris.
  const ipWait = ipAttempt(bucket);
  if (ipWait > 0) {
    return tooMany("IP_RATE_LIMITED", `Trop de tentatives depuis cette adresse : réessaie dans ${ipWait} s.`, ipWait);
  }

  let email: string | null = null;
  if (endpoint === "/sign-in/email") {
    try {
      const parsed = JSON.parse(body ?? "{}") as { email?: unknown };
      email = typeof parsed.email === "string" ? parsed.email.trim().toLowerCase() : null;
    } catch {
      email = null;
    }
  } else {
    // Changement de mot de passe : le compte est celui de la session (sans session, Better Auth répond 401).
    const session = await getAuth().api.getSession({ headers }).catch(() => null);
    email = session?.user.email.trim().toLowerCase() ?? null;
  }
  if (email) {
    // 2. Délai progressif propre à ce compte DEPUIS cette IP.
    const wait = waitSeconds(email, bucket);
    if (wait > 0) {
      return tooMany("ACCOUNT_THROTTLED", `Trop d'échecs pour ce compte : réessaie dans ${wait} s.`, wait);
    }
    // 3. Délai du compte, toutes IP confondues (borné ; une IP qui a déjà réussi n'y est pas soumise).
    const accountWait = accountWaitSeconds(email, bucket);
    if (accountWait > 0) {
      return tooMany("ACCOUNT_THROTTLED", `Trop d'échecs pour ce compte : réessaie dans ${accountWait} s.`, accountWait);
    }
  }

  const response = await handler.POST(forward);
  if (email) {
    const failed =
      endpoint === "/sign-in/email" ? response.status === 401 : response.status === 400 && (await errorCode(response)) === "INVALID_PASSWORD";
    if (failed) recordFailure(email, bucket);
    else if (response.ok) recordSuccess(email, bucket);
  }
  return response;
}

export function GET(request: Request) {
  return handle(request, "GET");
}

export function POST(request: Request) {
  return handle(request, "POST");
}
