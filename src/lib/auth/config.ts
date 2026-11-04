/**
 * Configuration de l'authentification, lue dans l'environnement.
 *
 * Règles (docs/ARCHITECTURE.md, « Auth admin ») :
 *  - OIDC Authentik actif seulement si AUTH_OIDC_ISSUER, _CLIENT_ID et
 *    _CLIENT_SECRET sont TOUS présents ;
 *  - AUTH_PASSWORD_DISABLED=true coupe le mot de passe SEULEMENT si l'OIDC est
 *    actif, sinon il est ignoré (avertissement) : on ne s'enferme jamais dehors ;
 *  - BETTER_AUTH_SECRET obligatoire (≥ 32 caractères) en production ;
 *  - autorisation Authentik : groupe (AUTH_ADMIN_GROUP) et/ou `sub` explicites
 *    (AUTH_ADMIN_SUBS) ; ADMIN_EMAILS seulement si email_verified === true
 *    (mode le plus faible, voir README).
 */

export const OIDC_PROVIDER_ID = "authentik";
/** Longueur minimale d'un NOUVEAU mot de passe (Better Auth, amorçage du premier admin) ; jamais vérifiée à la connexion. */
export const MIN_PASSWORD_LENGTH = 12;
const DEV_SECRET = "secret-de-dev-supprime";
const DEFAULT_PUBLIC_URL = "https://portfolio.example.org";

export type AuthConfig = {
  baseURL: string;
  trustedOrigins: string[];
  secret: string;
  secretError: string | null;
  oidc: { issuer: string; discoveryUrl: string; clientId: string; clientSecret: string } | null;
  passwordEnabled: boolean;
  adminEmails: string[];
  adminGroup: string | null;
  adminSubs: string[];
  /** Nombre de proxys de confiance devant l'app (IP client = XFF depuis la droite). */
  trustedProxyHops: number;
  warnings: string[];
};

/** Identité OIDC retenue à la connexion (claims utiles à l'autorisation). */
export type OidcIdentity = { sub: string; email: string | null; emailVerified: boolean; groups: string[] };

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function readAuthConfig(): AuthConfig {
  const isProd = process.env.NODE_ENV === "production";
  const warnings: string[] = [];

  const baseURL = (env("PUBLIC_BASE_URL") ?? (isProd ? DEFAULT_PUBLIC_URL : "http://localhost:3001")).replace(/\/+$/, "");
  if (isProd && baseURL.startsWith("http://")) {
    warnings.push(
      `PUBLIC_BASE_URL est en http (${baseURL}) en production : les cookies de session sont « Secure » et ne seront pas renvoyés par le navigateur ; les connexions échoueront hors https.`,
    );
  }
  const trustedOrigins = [new URL(baseURL).origin];
  if (!isProd) trustedOrigins.push("http://localhost:3001", "http://127.0.0.1:3001", "http://192.0.2.10:3001");

  const rawSecret = env("BETTER_AUTH_SECRET");
  let secretError: string | null = null;
  if (!rawSecret) secretError = "BETTER_AUTH_SECRET est absent";
  else if (rawSecret.length < 32) secretError = `BETTER_AUTH_SECRET est trop court (${rawSecret.length} caractères, 32 minimum)`;
  if (secretError && !isProd) warnings.push(`${secretError} : secret de développement utilisé (interdit en production).`);

  const issuer = env("AUTH_OIDC_ISSUER");
  const clientId = env("AUTH_OIDC_CLIENT_ID");
  const clientSecret = env("AUTH_OIDC_CLIENT_SECRET");
  const oidcVars = [issuer, clientId, clientSecret].filter(Boolean).length;
  const oidc =
    issuer && clientId && clientSecret
      ? {
          issuer: issuer.replace(/\/+$/, ""),
          discoveryUrl: `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
          clientId,
          clientSecret,
        }
      : null;
  if (oidcVars > 0 && !oidc) {
    warnings.push(
      "OIDC incomplet : AUTH_OIDC_ISSUER, AUTH_OIDC_CLIENT_ID et AUTH_OIDC_CLIENT_SECRET doivent être tous définis. Connexion Authentik désactivée.",
    );
  }

  let passwordEnabled = true;
  if (env("AUTH_PASSWORD_DISABLED") === "true") {
    if (oidc) passwordEnabled = false;
    else
      warnings.push(
        "AUTH_PASSWORD_DISABLED=true ignoré : l'OIDC n'est pas configuré, le mot de passe reste actif pour ne pas bloquer l'accès à l'admin.",
      );
  }

  const adminEmails = (env("ADMIN_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const adminGroup = env("AUTH_ADMIN_GROUP") ?? null;
  const adminSubs = (env("AUTH_ADMIN_SUBS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (oidc && adminEmails.length === 0 && !adminGroup && adminSubs.length === 0) {
    warnings.push(
      "OIDC actif mais ni AUTH_ADMIN_GROUP, ni AUTH_ADMIN_SUBS, ni ADMIN_EMAILS : aucune connexion Authentik ne sera acceptée.",
    );
  }

  const hops = Number.parseInt(env("AUTH_TRUSTED_PROXY_HOPS") ?? "1", 10);
  const trustedProxyHops = Number.isInteger(hops) && hops >= 0 && hops <= 10 ? hops : 1;

  return {
    baseURL,
    trustedOrigins,
    secret: rawSecret && !secretError ? rawSecret : DEV_SECRET,
    secretError: isProd ? secretError : null,
    oidc,
    passwordEnabled,
    adminEmails,
    adminGroup,
    adminSubs,
    trustedProxyHops,
    warnings,
  };
}

/** Extrait l'identité utile d'un profil OIDC brut (id_token ou userinfo). */
export function identityFromProfile(profile: Record<string, unknown> | undefined): OidcIdentity | null {
  const sub = profile?.sub;
  if (typeof sub !== "string" && typeof sub !== "number") return null;
  const raw = profile?.groups;
  const groups = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/[\s,]+/).filter(Boolean) : [];
  const email = typeof profile?.email === "string" ? profile.email.toLowerCase() : null;
  return { sub: String(sub), email, emailVerified: profile?.email_verified === true, groups };
}

/**
 * Une identité OIDC est-elle autorisée à administrer le site ?
 * Par ordre de solidité : `sub` explicite, groupe Authentik, puis e-mail — ce
 * dernier SEULEMENT s'il est vérifié par le fournisseur.
 */
export function isOidcIdentityAllowed(
  identity: OidcIdentity,
  config: Pick<AuthConfig, "adminEmails" | "adminGroup" | "adminSubs">,
): boolean {
  if (config.adminSubs.includes(identity.sub)) return true;
  if (config.adminGroup && identity.groups.includes(config.adminGroup)) return true;
  if (identity.email && identity.emailVerified && config.adminEmails.includes(identity.email)) return true;
  return false;
}
