/**
 * Proxy (Next 16, runtime Node.js) : garde de l'admin, i18n (next-intl) et
 * pages inconnues.
 *
 * Admin : tout /admin/* sans session VALIDE (vérifiée en base, `adminGateAllows`) est redirigé vers /admin/connexion. La seule
 * présence d'un cookie ne suffit pas : avec un cookie inventé et `RSC: 1`, Next rendait la charge RSC des pages sans repasser
 * par le layout qui portait la garde (docs/SECURITE.md §2.2, §5.1). Le layout, chaque page (requireAdmin) et assertAdmin()
 * revérifient ensuite.
 *
 * Un slug inconnu ne passe pas par notFound() : dans ce projet (layout racine
 * sous [locale], rendu ISR), Next répond alors une coquille d'erreur que seul
 * le client remplit, mise en cache un an. À la place, le proxy vérifie le slug
 * en base sur l'URL BRUTE (un seul décodage : /fr/%25 et /fr/%2570… → 404) et,
 * s'il est inconnu, sert la page réservée /<langue>/<NOT_FOUND_SLUG> — rendue
 * normalement (thème, en-tête, pied, en cache ISR) — avec le statut 404 et
 * `Cache-Control: no-store`.
 *
 * Ancien domaine (lot 88) : si REDIRECT_FROM est défini, une requête dont l'hôte y figure est renvoyée vers PUBLIC_BASE_URL
 * (même chemin, même requête) AVANT tout le reste, quelle que soit la route. Pour que /api, /media et les fichiers à extension
 * (favicon, sitemap…) passent aussi par le proxy, le `matcher` ne les exclut plus ; ils ressortent aussitôt (`LEGACY_SKIP`)
 * quand l'hôte n'est pas redirigé : leur traitement est celui d'avant. /admin/api reste hors du proxy (corps tronqué à 10 Mo).
 */
import { getSessionCookie } from "better-auth/cookies";
import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";

import { readFileSync } from "node:fs";
import path from "node:path";

import { routing } from "./i18n/routing";
import { adminGateAllows, isAdminRequest } from "./lib/auth/guard";
import { readRedirectConfig, redirectionFor } from "./lib/domain";
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
 * Vignettes de l'écran Thèmes (lot 60) : la page d'accueil RÉELLE rendue avec un thème ou une version de Mon thème, dans un cadre réduit
 * (`/fr?vignette=<thème>` ou `<thème>@<n>`). Plusieurs cadres montrent chacun un thème différent : l'aperçu habituel (cookie) est
 * unique par navigateur, il ne convient pas. Le proxy ajoute donc, SEULEMENT à CETTE requête et pour une session admin vérifiée en
 * base, les cookies d'aperçu (draft mode + thème) ; rien n'est posé dans le navigateur, le trafic public n'est pas concerné.
 */
/** Développement : l'identifiant du draft mode du serveur dev est écrit dans .next/dev/prerender-manifest.json (le cookie doit le porter). */
function devDraftCookie(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  try {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), ".next/dev/prerender-manifest.json"), "utf8"));
    return typeof manifest?.preview?.previewModeId === "string" ? manifest.preview.previewModeId : null;
  } catch {
    return null;
  }
}
const VIGNETTE = /^[a-z0-9-]{1,80}(?:@\d{1,6})?$/;
const PREVIEW_COOKIES = /^(__prerender_bypass|theme-preview|theme-preview-banner)=/;
async function vignetteRequest(request: NextRequest): Promise<NextRequest | null> {
  const ref = request.nextUrl.searchParams.get("vignette");
  if (ref === null || !VIGNETTE.test(ref) || !getSessionCookie(request)) return null;
  const draft = expectedDraftCookie() ?? devDraftCookie();
  if (!draft || !(await isAdminRequest(request.headers))) return null;
  const kept = (request.headers.get("cookie") ?? "").split(/;\s*/).filter((c) => c && !PREVIEW_COOKIES.test(c));
  const headers = new Headers(request.headers);
  headers.set("cookie", [...kept, `__prerender_bypass=${draft}`, `theme-preview=${ref}`].join("; "));
  return new NextRequest(request, { headers });
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

async function adminGate(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  // Cookie absent : redirection sans requête en base ; cookie présent : session vérifiée en base (un cookie inventé ne suffit pas).
  if (pathname !== ADMIN_LOGIN && (!getSessionCookie(request) || !(await adminGateAllows(request.headers)))) {
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

/**
 * Routes que le `matcher` d'avant le lot 88 excluait : api, médias, polices, icône, fichiers de `public/` et fichiers à la racine.
 * Liste FERMÉE (docs/SECURITE.md N5) : l'ancienne règle « tout chemin qui contient un point » laissait sortir /fr/a.b (rendu en
 * 200 et gardé un an dans le cache ISR) et, testée avant /admin, tout futur /admin/….x de la garde de l'admin.
 */
const LEGACY_SKIP = /^\/(?:(?:api|media|fonts|site-icon|kit|themes|_next|_vercel)(?:\/|$)|(?:favicon\.ico|robots\.txt|sitemap\.xml|manifest\.webmanifest)$)/;

/** Redirection de l'ancien domaine (REDIRECT_FROM), ou null : la requête est servie normalement. */
function domainRedirect(request: NextRequest): NextResponse | null {
  const config = readRedirectConfig();
  if (config.hosts.length === 0) return null;
  const target = redirectionFor(config, {
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    method: request.method,
    pathAndQuery: request.nextUrl.pathname + request.nextUrl.search,
  });
  if (!target) return null;
  // Un an de cache pour un 301 muet : impossible de revenir en arrière. Une heure laisse le retour possible.
  return new NextResponse(null, { status: target.status, headers: { Location: target.location, "Cache-Control": "public, max-age=3600" } });
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const moved = domainRedirect(request);
  if (moved) return moved;
  // /admin AVANT LEGACY_SKIP : aucun chemin de l'admin (même avec un point) n'échappe à sa garde.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return adminGate(request);
  if (LEGACY_SKIP.test(pathname)) return NextResponse.next();
  if (request.headers.get(INTERNAL_HEADER) === INTERNAL_SECRET) return intl(request);

  const match = LOCALE_PATH.exec(request.nextUrl.pathname);
  if (!match) return intl(request); // « / », langue absente : next-intl redirige

  const [, locale, rest = ""] = match;
  if (rest === "" && request.nextUrl.searchParams.has("vignette")) {
    const framed = await vignetteRequest(request);
    if (framed) {
      const response = intl(framed);
      // Cadre de l'écran Thèmes (même origine) : les en-têtes « cadre » de next.config se décident sur le cookie d'aperçu du NAVIGATEUR,
      // que cette requête n'a pas ; on les pose ici, pour cette réponse seulement. Jamais en cache.
      response.headers.set("X-Frame-Options", "SAMEORIGIN");
      response.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
  }
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
  // Toutes les routes sauf les fichiers statiques Next. L'API, les médias et les
  // fichiers à extension ne sont lus ici que pour la redirection de l'ancien
  // domaine (lot 88) : voir LEGACY_SKIP.
  // /admin/api (envoi de fichiers) est exclu : le proxy met le corps de la
  // requête en mémoire et le tronque à 10 Mo ; la route se garde elle-même
  // (assertAdmin + même origine) et lit le corps en flux.
  matcher: ["/((?!admin/api|_next|_vercel).*)"],
};
