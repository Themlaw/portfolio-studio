/**
 * Proxy (Next 16, runtime Node.js) : garde de l'admin, i18n (next-intl) et
 * pages inconnues.
 *
 * Admin : tout /admin/* sans cookie de session est redirigé vers
 * /admin/connexion. Test rapide (présence du cookie) : la session elle-même est
 * vérifiée en base par le layout de l'admin et par assertAdmin().
 *
 * Un slug inconnu ne passe pas par notFound() : dans ce projet (layout racine
 * sous [locale], rendu ISR), Next répond alors une coquille d'erreur que seul
 * le client remplit, mise en cache un an. À la place, le proxy vérifie le slug
 * en base sur l'URL BRUTE (un seul décodage : /fr/%25 et /fr/%2570… → 404) et,
 * s'il est inconnu, sert la page réservée /<langue>/<NOT_FOUND_SLUG> — rendue
 * normalement (thème, en-tête, pied, en cache ISR) — avec le statut 404 et
 * `Cache-Control: no-store`.
 */
import { getSessionCookie } from "better-auth/cookies";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "./i18n/routing";
import { NOT_FOUND_SLUG, publishedSlugExists } from "./lib/pages-index";

const intl = createMiddleware(routing);

/** Marque les requêtes internes du proxy (secret propre au processus). */
const INTERNAL_HEADER = "x-portfolio-internal";
const INTERNAL_SECRET = crypto.randomUUID();

const LOCALE_PATH = new RegExp(`^/(${routing.locales.join("|")})(?:/(.*))?$`);

async function notFoundResponse(request: NextRequest, locale: string): Promise<Response> {
  const port = process.env.PORT || request.nextUrl.port || "3000";
  const headers = new Headers(request.headers);
  headers.set(INTERNAL_HEADER, INTERNAL_SECRET);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  const upstream = await fetch(`http://127.0.0.1:${port}/${locale}/${NOT_FOUND_SLUG}`, { headers, redirect: "manual" });
  const out = new Headers();
  for (const name of ["content-type", "vary", "link"]) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  out.set("Cache-Control", "no-store, must-revalidate");
  out.set("X-Robots-Tag", "noindex");
  return new NextResponse(upstream.body, { status: 404, headers: out });
}

const ADMIN_LOGIN = "/admin/connexion";

/**
 * CSP complète de l'admin, avec nonce par requête : Next l'applique à ses
 * propres scripts (il lit le nonce dans l'en-tête CSP de la requête). Pas
 * d'unsafe-eval en production ; en développement, Turbopack et le HMR en ont
 * besoin (eval, WebSocket).
 */
function adminCsp(nonce: string): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

function adminGate(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname !== ADMIN_LOGIN && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL(ADMIN_LOGIN, request.url));
  }
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const csp = adminCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return adminGate(request);
  if (request.headers.get(INTERNAL_HEADER) === INTERNAL_SECRET) return intl(request);

  const match = LOCALE_PATH.exec(request.nextUrl.pathname);
  if (!match) return intl(request); // « / », langue absente : next-intl redirige

  const [, locale, rest = ""] = match;
  let slug: string | null;
  try {
    slug = decodeURIComponent(rest.replace(/\/+$/, ""));
  } catch {
    slug = null; // encodage invalide (/fr/%E0…)
  }
  if (slug === null || slug === NOT_FOUND_SLUG || !publishedSlugExists(locale, slug)) {
    return notFoundResponse(request, locale);
  }
  return intl(request);
}

export const config = {
  // Toutes les routes sauf l'API, les médias, les fichiers statiques Next
  // et les assets.
  matcher: ["/((?!api|media|_next|_vercel|.*\\..*).*)"],
};
