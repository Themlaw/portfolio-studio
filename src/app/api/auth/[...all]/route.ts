import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";
import { CLIENT_IP_HEADER, clientIpFromForwarded, ipBucket, UNKNOWN_IP } from "@/lib/auth/client-ip";
import { readAuthConfig } from "@/lib/auth/config";
import { accountWaitSeconds, authEndpoint, ipAttempt, noteThrottledAttempt, recordFailure, recordSuccess, waitSeconds } from "@/lib/auth/throttle";
import { recordEvent } from "@/lib/journal/audit";

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

  const endpoint = method === "POST" ? authEndpoint(new URL(request.url).pathname) : null;
  const guarded = endpoint === "/sign-in/email" || endpoint === "/change-password";
  const bucket = ipBucket(ip);

  // 1. Limite par IP, avant tout (même avant de lire le corps) : chaque tentative compte, refus compris.
  if (guarded) {
    const ipWait = ipAttempt(bucket);
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

  if (!guarded) return handler[method](forward);

  let email: string | null = null;
  let sessionUser: string | null = null;
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
    sessionUser = session?.user.id ?? null;
  }
  if (email) {
    // 2. Délai progressif propre à ce compte DEPUIS cette IP.
    const wait = waitSeconds(email, bucket);
    if (wait > 0) {
      noteThrottledAttempt(email);
      return tooMany("ACCOUNT_THROTTLED", `Trop d'échecs pour ce compte : réessaie dans ${wait} s.`, wait);
    }
    // 3. Délai du compte, toutes IP confondues (borné ; une IP qui a déjà réussi n'y est pas soumise).
    const accountWait = accountWaitSeconds(email, bucket);
    if (accountWait > 0) {
      noteThrottledAttempt(email);
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
  if (endpoint === "/change-password") {
    // Changement de mot de passe : journalisé (docs/SECURITE.md P5), réussite comme échec, avec le compte de la session.
    recordEvent({
      action: "auth:change-password",
      type: "compte",
      user: sessionUser,
      result: response.ok ? "ok" : "refus",
      label: response.ok ? "Mot de passe changé" : "Changement de mot de passe refusé",
      reason: response.ok ? null : `HTTP ${response.status}`,
    });
  } else if (response.ok) {
    // Journal (P5) : connexion réussie (compte interne) ou échec (anonyme, débit borné) ; ni l'e-mail tenté ni l'IP.
    recordEvent({ action: "auth:sign-in", type: "compte", user: await signedInUser(response), result: "ok", label: "Connexion (mot de passe)" });
  } else if (response.status === 401) {
    recordEvent({ action: "auth:sign-in", type: "compte", user: null, result: "refus", label: "Connexion refusée (mot de passe)", reason: "identifiants invalides" });
  }
  return response;
}

export function GET(request: Request) {
  return handle(request, "GET");
}

export function POST(request: Request) {
  return handle(request, "POST");
}
