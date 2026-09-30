/**
 * Proxy (Next 16, runtime Node.js) : i18n (next-intl) + pages inconnues.
 *
 * Un slug inconnu ne passe pas par notFound() : dans ce projet (layout racine
 * sous [locale], rendu ISR), Next répond alors une coquille d'erreur que seul
 * le client remplit, mise en cache un an. À la place, le proxy vérifie le slug
 * en base sur l'URL BRUTE (un seul décodage : /fr/%25 et /fr/%2570… → 404) et,
 * s'il est inconnu, sert la page réservée /<langue>/<NOT_FOUND_SLUG> — rendue
 * normalement (thème, en-tête, pied, en cache ISR) — avec le statut 404 et
 * `Cache-Control: no-store`.
 */
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

export default async function proxy(request: NextRequest) {
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
