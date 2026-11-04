/**
 * Redirection automatique de l'ancien domaine vers le nouveau (lot 88).
 *
 * `REDIRECT_FROM` = liste d'hôtes (séparés par des virgules, sans schéma ni chemin). Une requête dont l'hôte figure dans la liste
 * est renvoyée vers `PUBLIC_BASE_URL` + même chemin + même requête : 301 pour GET et HEAD, 308 (corps conservé) pour les autres
 * méthodes. Variable absente ou vide : rien ne change (aucune redirection, aucun journal).
 *
 * Garde-fous : `PUBLIC_BASE_URL` doit être défini et valide (sinon rien n'est redirigé) ; une entrée qui a le même hôte que
 * `PUBLIC_BASE_URL` est ignorée (jamais de boucle) ; tout autre hôte (domaine principal, localhost, IP, contrôles de santé)
 * est servi normalement. Module sans dépendance : testable seul, utilisable par le proxy comme par l'écran Diagnostic.
 */

export type RedirectConfig = {
  /** Valeur brute de REDIRECT_FROM (vide : fonction désactivée). */
  raw: string;
  /** Hôtes réellement redirigés (minuscules, sans port). */
  hosts: string[];
  /** PUBLIC_BASE_URL normalisée (sans barre finale), ou null si absente / invalide. */
  base: string | null;
  baseHost: string | null;
  /** Entrées corrigées automatiquement (schéma, barre finale, port retirés). */
  warnings: string[];
  /** Entrées ignorées (invalides, ou identiques au domaine principal) et autres erreurs de configuration. */
  errors: string[];
};

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Plus long nom d'hôte DNS (RFC 1035) : au-delà, l'en-tête est ignoré sans être analysé. */
const MAX_HOST = 253;

/**
 * Retire les points finaux par une boucle : la regex `/\.+$/` était quadratique sur un en-tête fait de milliers de points
 * (212 ms par requête avec 16 000 points, docs/SECURITE.md N12).
 */
function trimDots(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 46) end--;
  return value.slice(0, end);
}

/** « Portfolio.Example.FR. » → « portfolio.example.fr » ; null si ce n'est pas un nom d'hôte. */
function cleanHost(value: string): string | null {
  const host = trimDots(value.toLowerCase());
  return HOSTNAME.test(host) ? host : null;
}

/** Hôte d'une requête (en-tête Host ou X-Forwarded-Host) : premier de la liste, sans port, en minuscules. */
export function hostOfHeader(value: string | null | undefined): string | null {
  if (!value) return null;
  let host = value.split(",")[0].trim().toLowerCase();
  // Nom d'hôte + port au plus : un en-tête plus long n'est pas un hôte (et n'est pas analysé).
  if (!host || host.length > MAX_HOST + 6) return null;
  if (host.startsWith("[")) host = host.slice(0, host.indexOf("]") + 1); // IPv6 : [::1]:3000
  else host = host.replace(/:\d*$/, "");
  host = trimDots(host);
  return host && host.length <= MAX_HOST ? host : null;
}

export function parseRedirectFrom(rawValue: string | undefined | null, publicBaseUrl: string | undefined | null): RedirectConfig {
  const raw = (rawValue ?? "").trim();
  const config: RedirectConfig = { raw, hosts: [], base: null, baseHost: null, warnings: [], errors: [] };
  if (!raw) return config;

  const baseInput = (publicBaseUrl ?? "").trim();
  try {
    const url = new URL(baseInput);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("schéma");
    config.base = url.toString().replace(/\/+$/, "");
    config.baseHost = trimDots(url.hostname.toLowerCase());
  } catch {
    config.errors.push(
      baseInput
        ? `PUBLIC_BASE_URL (« ${baseInput} ») n'est pas une adresse http(s) valide : REDIRECT_FROM est ignoré, aucune redirection.`
        : "PUBLIC_BASE_URL n'est pas défini : REDIRECT_FROM est ignoré, aucune redirection (définis le NOUVEAU domaine dans PUBLIC_BASE_URL).",
    );
    return config;
  }

  for (const part of raw.split(",")) {
    const original = part.trim();
    if (!original) continue;
    let entry = original.toLowerCase();
    const fixes: string[] = [];
    const scheme = /^[a-z][a-z0-9+.-]*:\/\//.exec(entry);
    if (scheme) {
      entry = entry.slice(scheme[0].length);
      fixes.push("schéma retiré");
    }
    const cut = entry.search(/[/?#]/);
    if (cut >= 0) {
      fixes.push(entry.slice(cut) === "/" ? "barre finale retirée" : "chemin retiré");
      entry = entry.slice(0, cut);
    }
    if (/:\d+$/.test(entry)) {
      entry = entry.replace(/:\d+$/, "");
      fixes.push("port retiré");
    }
    const host = cleanHost(entry);
    if (!host) {
      config.errors.push(`REDIRECT_FROM : « ${original} » n'est pas un nom de domaine valide, entrée ignorée.`);
      continue;
    }
    if (host === config.baseHost) {
      config.errors.push(`REDIRECT_FROM : « ${original} » est le domaine principal (PUBLIC_BASE_URL), entrée ignorée pour ne jamais créer de boucle.`);
      continue;
    }
    if (fixes.length) config.warnings.push(`REDIRECT_FROM : « ${original} » corrigé en « ${host} » (${fixes.join(", ")}). Écris seulement le nom de domaine.`);
    if (!config.hosts.includes(host)) config.hosts.push(host);
  }
  return config;
}

type Memory = { key: string; config: RedirectConfig };
const globalForDomain = globalThis as unknown as { __portfolioRedirect?: Memory };

/**
 * Configuration courante, lue dans l'environnement (jamais pendant le build : les variables sont celles du conteneur).
 * Mémorisée tant que les deux variables ne changent pas ; les avertissements et erreurs sont journalisés une seule fois.
 */
export function readRedirectConfig(env: Record<string, string | undefined> = process.env): RedirectConfig {
  const key = `${env.REDIRECT_FROM ?? ""}\u0000${env.PUBLIC_BASE_URL ?? ""}`;
  const memory = globalForDomain.__portfolioRedirect;
  if (memory && memory.key === key && env === process.env) return memory.config;
  const config = parseRedirectFrom(env.REDIRECT_FROM, env.PUBLIC_BASE_URL);
  if (env === process.env) {
    globalForDomain.__portfolioRedirect = { key, config };
    for (const w of config.warnings) console.warn(`[domaine] ${w}`);
    for (const e of config.errors) console.error(`[domaine] ${e}`);
    if (config.hosts.length) console.log(`[domaine] redirection de ${config.hosts.join(", ")} vers ${config.base}`);
  }
  return config;
}

export type Redirection = { status: 301 | 308; location: string };

/**
 * Où renvoyer cette requête ? null = la servir normalement.
 * `forwardedHost` (X-Forwarded-Host, posé par Pangolin/Traefik) l'emporte sur `host` s'il est présent.
 * `pathAndQuery` : chemin et chaîne de requête tels que reçus (commence par « / »).
 */
export function redirectionFor(
  config: RedirectConfig,
  request: { host: string | null | undefined; forwardedHost?: string | null; method: string; pathAndQuery: string },
): Redirection | null {
  if (!config.base || config.hosts.length === 0) return null;
  const host = hostOfHeader(request.forwardedHost) ?? hostOfHeader(request.host);
  if (!host || !config.hosts.includes(host)) return null;
  const method = request.method.toUpperCase();
  return { status: method === "GET" || method === "HEAD" ? 301 : 308, location: config.base + request.pathAndQuery };
}
