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

import { readFileSync } from "node:fs";
import path from "node:path";

import { routing } from "./i18n/routing";
import { isAdminRequest } from "./lib/auth/guard";
import { NOT_FOUND_SLUG, publishedSlugExists, redirectedSlug } from "./lib/pages-index";

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
/** Cookie indicateur du bouton « Modifier cette page » (src/components/EditThisPage.tsx). */
const ADMIN_HINT_COOKIE = "portfolio-admin";
/** Cookie du draft mode de Next. */
const DRAFT_COOKIE = "__prerender_bypass";

/**
 * Identifiant du draft mode du build (valeur attendue du cookie). Lu dans
 * .next/prerender-manifest.json en production ; absent en développement
 * (généré en mémoire) : la session admin, vérifiée en base, suffit alors.
 */
let previewModeId: string | null | undefined;
function expectedDraftCookie(): string | null {
  if (previewModeId === undefined) {
    // En dev, .next/prerender-manifest.json peut venir d'un ancien build :
    // l'identifiant du serveur dev est ailleurs (en mémoire).
    if (process.env.NODE_ENV !== "production") return (previewModeId = null);
    try {
      const manifest = JSON.parse(readFileSync(path.join(process.cwd(), ".next/prerender-manifest.json"), "utf8"));
      previewModeId = typeof manifest?.preview?.previewModeId === "string" ? manifest.preview.previewModeId : null;
    } catch {
      previewModeId = null;
    }
  }
  return previewModeId ?? null;
}

/**
 * Aperçu des pages non publiées : cookie de draft mode valide ET session admin
 * vérifiée en base (des cookies factices ne suffisent pas). Appelé seulement
 * pour un slug non publié qui existe : le trafic public n'interroge jamais la
 * session.
 */
async function canPreviewDrafts(request: NextRequest): Promise<boolean> {
  const draft = request.cookies.get(DRAFT_COOKIE)?.value;
  if (!draft || !getSessionCookie(request)) return false;
  const expected = expectedDraftCookie();
  if (expected && draft !== expected) return false;
  return isAdminRequest(request.headers);
}

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
  // Indicateur (pas une preuve) pour le bouton « Modifier cette page » du site :
  // seuls les navigateurs qui l'ont vérifient leur session (route dédiée).
  if (pathname !== ADMIN_LOGIN && !request.cookies.has(ADMIN_HINT_COOKIE)) {
    response.cookies.set(ADMIN_HINT_COOKIE, "1", { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30, secure: process.env.NODE_ENV === "production" });
  }
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
  if (slug === null || slug === NOT_FOUND_SLUG) return notFoundResponse(request, locale);
  if (!publishedSlugExists(locale, slug)) {
    // Page non publiée : seulement pour un aperçu admin vérifié ; sinon un vrai
    // 404, identique à celui d'une adresse qui n'existe pas.
    // Ancienne adresse gardée en redirection (lot 51) : lien déjà partagé, renvoyé vers l'adresse actuelle.
    const moved = redirectedSlug(locale, slug);
    if (moved) return NextResponse.redirect(new URL(`/${locale}/${encodeURIComponent(moved)}${request.nextUrl.search}`, request.url), 308);
    const draftExists = publishedSlugExists(locale, slug, { includeDrafts: true });
    if (!draftExists || !(await canPreviewDrafts(request))) return notFoundResponse(request, locale);
  }
  return intl(request);
}

export const config = {
  // Toutes les routes sauf l'API, les médias, les fichiers statiques Next
  // et les assets.
  // /admin/api (envoi de fichiers) est exclu : le proxy met le corps de la
  // requête en mémoire et le tronque à 10 Mo ; la route se garde elle-même
  // (assertAdmin + même origine) et lit le corps en flux.
  matcher: ["/((?!api|admin/api|media|_next|_vercel|.*\\..*).*)"],
};
