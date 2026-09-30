import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";
import { CLIENT_IP_HEADER, clientIpFromForwarded, UNKNOWN_IP } from "@/lib/auth/client-ip";
import { readAuthConfig } from "@/lib/auth/config";
import { ipAttempt, recordFailure, recordSuccess, waitSeconds } from "@/lib/auth/throttle";

export const dynamic = "force-dynamic";

/**
 * Toutes les routes Better Auth (/api/auth/sign-in/email, /sign-in/social,
 * /callback/authentik, /sign-out, /get-session…), précédées de :
 *  - l'IP client calculée selon AUTH_TRUSTED_PROXY_HOPS (en-tête interne,
 *    toute valeur venue de l'extérieur est écrasée) ;
 *  - sur /sign-in/email : limite par IP (toutes tentatives comptées), PUIS
 *    délai progressif par couple (e-mail, IP) — voir src/lib/auth/throttle.ts.
 */

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

  if (method !== "POST" || !new URL(request.url).pathname.endsWith("/sign-in/email")) {
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
  return response;
}

export function GET(request: Request) {
  return handle(request, "GET");
}

export function POST(request: Request) {
  return handle(request, "POST");
}
