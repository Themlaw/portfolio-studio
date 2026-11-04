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
 *    délai progressif par couple (e-mail, IP) — voir src/lib/auth/throttle.ts ;
 *  - un corps lu en flux et borné (MAX_BODY), APRÈS la limite par IP : un corps
 *    géant n'est jamais mis en mémoire en entier (docs/SECURITE.md N1).
 */

/** Plus grand corps accepté : les requêtes de Better Auth (e-mail, mot de passe, fournisseur) tiennent en quelques centaines d'octets. */
const MAX_BODY = 16 * 1024;

/** Corps en texte, lu en flux et abandonné dès qu'il dépasse `max` octets (null = trop gros). */
async function readBoundedText(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
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

  const signIn = method === "POST" && new URL(request.url).pathname.endsWith("/sign-in/email");

  // 1. Limite par IP, avant tout (même avant de lire le corps) : chaque tentative compte, refus compris.
  if (signIn) {
    const ipWait = ipAttempt(ip);
    if (ipWait > 0) {
      return tooMany("IP_RATE_LIMITED", `Trop de tentatives depuis cette adresse : réessaie dans ${ipWait} s.`, ipWait);
    }
  }

  let body: string | undefined;
  if (method === "POST") {
    const text = await readBoundedText(request, MAX_BODY);
    if (text === null) {
      return Response.json({ code: "BODY_TOO_LARGE", message: "Requête trop volumineuse." }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    body = text;
  }
  const forward = new Request(request.url, { method, headers, body });
  const handler = toNextJsHandler(getAuth());

  if (!signIn) return handler[method](forward);

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
