/**
 * Aperçu de thème piloté depuis l'admin (routes POST /admin/apercu et
 * /admin/apercu/quitter). Contrôles communs : même origine (CSRF, en plus du
 * cookie de session SameSite=Lax) et chemin de retour local.
 */
import { readAuthConfig } from "@/lib/auth/config";

/** La requête vient-elle bien du site lui-même ? (Origin, sinon Sec-Fetch-Site) */
export function isSameOrigin(request: Request): boolean {
  const expected = new URL(readAuthConfig().baseURL).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expected || origin === new URL(request.url).origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/**
 * Un chemin qui commence par « // » (ou « /\ ») est une adresse SANS schéma : `Location: //autre-site` envoie le navigateur
 * ailleurs. Le parseur URL en fabrique un à partir de « /.//autre-site » (docs/SECURITE.md N17) : on le refuse en sortie.
 */
export function sameSitePath(path: string, fallback: string): string {
  return /^\/[/\\]/.test(path) ? fallback : path;
}

/**
 * Chemin de retour de /api/theme-preview, strictement sur l'origine `origin` : le parseur URL normalise (`/\evil`, tabulations,
 * CRLF…), on compare les origines, puis on refuse un résultat sans schéma (« //autre-site ») ; sinon "/".
 */
export function sameOriginPath(candidate: string | null | undefined, origin: string): string {
  if (!candidate) return "/";
  try {
    const url = new URL(candidate, origin);
    if (url.origin !== origin) return "/";
    return sameSitePath(url.pathname + url.search, "/");
  } catch {
    return "/";
  }
}

/** Chemin local de retour (jamais vers un autre site). */
export function localPath(candidate: string | null | undefined, fallback: string): string {
  if (!candidate) return fallback;
  try {
    const base = "http://local.invalid";
    const url = new URL(candidate, base);
    // Un Referer absolu du site garde son chemin ; tout autre hôte est ignoré.
    if (url.origin !== base && url.origin !== new URL(readAuthConfig().baseURL).origin) return fallback;
    return sameSitePath(url.pathname + url.search, fallback);
  } catch {
    return fallback;
  }
}

/**
 * Écran de l'admin d'où l'aperçu a été ouvert (cookie posé par POST
 * /admin/apercu) : « Quitter l'aperçu » y ramène (v0.13.1), sinon Thèmes.
 */
export const PREVIEW_FROM_COOKIE = "preview-from";
export const PREVIEW_FALLBACK = "/admin/themes";

/** Chemin d'un écran de l'admin (jamais la page de connexion ni une route d'API), ou null. */
export function adminScreen(candidate: string | null | undefined): string | null {
  const path = localPath(candidate, "");
  if (!/^\/admin(\/|$|\?)/.test(path)) return null;
  if (/^\/admin\/(connexion|api|apercu)(\/|$|\?)/.test(path)) return null;
  return path.slice(0, 300);
}
