/**
 * Instance Better Auth (serveur). Créée à la première utilisation : la
 * configuration est lue à l'exécution, jamais pendant `next build`.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins";

import { getDb, schema } from "@/lib/db";

import { CLIENT_IP_HEADER } from "./client-ip";
import { identityFromProfile, isOidcIdentityAllowed, OIDC_PROVIDER_ID, readAuthConfig } from "./config";
import { forgetIdentity, rememberIdentity } from "./identity";
import { SESSION_IDLE_S, SESSION_UPDATE_AGE_S } from "./sessions";

export const ADMIN_NOT_ALLOWED = "admin_not_allowed";

/** Endpoints qui créent ou changent un mot de passe : fermés si le mot de passe est désactivé. */
const PASSWORD_PATHS = new Set(["/change-password", "/set-password", "/reset-password", "/request-password-reset"]);

function createAuth() {
  const config = readAuthConfig();
  const isProd = process.env.NODE_ENV === "production";

  return betterAuth({
    appName: "Portfolio — admin",
    baseURL: config.baseURL,
    basePath: "/api/auth",
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: {
      enabled: config.passwordEnabled,
      // Pas d'inscription publique : le premier admin est amorcé au démarrage.
      disableSignUp: true,
      minPasswordLength: 8,
    },
    user: {
      /**
       * Garde des connexions Authentik : création de compte, liaison ET chaque
       * connexion suivante, sur le profil BRUT du fournisseur. Autorisé : `sub`
       * explicite, groupe, ou e-mail vérifié de la liste. Refus = aucun compte
       * créé, retour sur la connexion avec ?error=admin_not_allowed. Une
       * identité autorisée est mémorisée (oidc_identity) pour être revérifiée
       * à chaque requête (src/lib/auth/guard.ts).
       */
      validateUserInfo: async ({ source }) => {
        if (source.method !== "oauth") return;
        const identity = identityFromProfile(source.oauth?.profile);
        if (identity && isOidcIdentityAllowed(identity, config)) {
          rememberIdentity(identity);
          return;
        }
        // Un `sub` déjà connu qui n'est plus autorisé (retiré du groupe dans
        // Authentik…) perd ses sessions en cours, pas seulement la suivante.
        const revoked = identity ? forgetIdentity(identity.sub) : 0;
        console.warn(
          `[auth] connexion Authentik refusée (sub « ${identity?.sub ?? "?"} », e-mail ${identity?.emailVerified ? "vérifié" : "non vérifié"})` +
            (revoked ? ` : ${revoked} session(s) révoquée(s)` : ""),
        );
        return {
          error: ADMIN_NOT_ALLOWED,
          errorDescription: "Ce compte Authentik n'est pas autorisé à administrer le site.",
        };
      },
    },
    session: {
      // Audit de sécurité P3 : durées explicites. Expiration après 3 jours sans utilisation (prolongée au plus une fois par
      // heure quand la session sert) ; la durée ABSOLUE (7 jours après la connexion) est vérifiée par la garde (guard.ts).
      expiresIn: SESSION_IDLE_S,
      updateAge: SESSION_UPDATE_AGE_S,
    },
    account: {
      // Aucune liaison automatique par e-mail : une identité Authentik qui
      // porte l'e-mail d'un compte existant est refusée (account_not_linked),
      // jamais fusionnée en silence avec lui.
      accountLinking: { disableImplicitLinking: true },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        // Filet de sécurité seulement : la vraie limite de /sign-in/email est
        // appliquée AVANT Better Auth (src/lib/auth/throttle.ts : 5/min par IP,
        // fenêtre glissante, puis délai par couple e-mail/IP). Celle de Better
        // Auth ne se remet à zéro qu'après 60 s SANS requête : un admin qui se
        // connecte toutes les 12 s serait bloqué au 6e essai.
        "/sign-in/email": { window: 60, max: 30 },
        "/sign-in/social": { window: 60, max: 10 },
      },
    },
    advanced: {
      // IP calculée par le gestionnaire /api/auth selon AUTH_TRUSTED_PROXY_HOPS.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      useSecureCookies: isProd,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: isProd },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!config.passwordEnabled && PASSWORD_PATHS.has(ctx.path)) {
          throw new APIError("FORBIDDEN", {
            code: "PASSWORD_DISABLED",
            message: "La connexion par mot de passe est désactivée sur ce site.",
          });
        }
        // Audit de sécurité P3 : changer le mot de passe déconnecte TOUJOURS les autres sessions, quoi que demande le client
        // (un cookie volé ne survit pas au changement de mot de passe, même fait par un appel direct à l'API).
        if (ctx.path === "/change-password" && ctx.body && typeof ctx.body === "object") {
          return { context: { body: { ...(ctx.body as Record<string, unknown>), revokeOtherSessions: true } } };
        }
      }),
    },
    plugins: [
      ...(config.oidc
        ? [
            genericOAuth({
              config: [
                {
                  providerId: OIDC_PROVIDER_ID,
                  name: "Authentik",
                  discoveryUrl: config.oidc.discoveryUrl,
                  clientId: config.oidc.clientId,
                  clientSecret: config.oidc.clientSecret,
                  scopes: ["openid", "profile", "email"],
                  pkce: true,
                },
              ],
            }),
          ]
        : []),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __portfolioAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__portfolioAuth ??= createAuth();
  return globalForAuth.__portfolioAuth;
}
