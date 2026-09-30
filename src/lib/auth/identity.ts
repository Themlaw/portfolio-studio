/**
 * Identités Authentik autorisées (table oidc_identity) et revérification de
 * l'accès d'un utilisateur contre la configuration COURANTE.
 */
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";

import { isOidcIdentityAllowed, OIDC_PROVIDER_ID, readAuthConfig, type OidcIdentity } from "./config";

/** Mémorise les claims retenus à une connexion Authentik autorisée. */
export function rememberIdentity(identity: OidcIdentity): void {
  const values = {
    sub: identity.sub,
    providerId: OIDC_PROVIDER_ID,
    email: identity.email,
    emailVerified: identity.emailVerified,
    groups: JSON.stringify(identity.groups),
    updatedAt: new Date(),
  };
  getDb()
    .insert(schema.oidcIdentity)
    .values(values)
    .onConflictDoUpdate({ target: schema.oidcIdentity.sub, set: values })
    .run();
}

/**
 * Identité Authentik désormais refusée (ex. retirée du groupe DANS Authentik) :
 * on oublie ses claims et on coupe toutes les sessions des utilisateurs liés
 * à ce `sub`. Renvoie le nombre de sessions révoquées.
 */
export function forgetIdentity(sub: string): number {
  const db = getDb();
  const users = db
    .select({ userId: schema.account.userId })
    .from(schema.account)
    .where(and(eq(schema.account.providerId, OIDC_PROVIDER_ID), eq(schema.account.accountId, sub)))
    .all()
    .map((r) => r.userId);
  let revoked = 0;
  if (users.length > 0) {
    revoked = db.delete(schema.session).where(inArray(schema.session.userId, users)).run().changes;
  }
  db.delete(schema.oidcIdentity).where(eq(schema.oidcIdentity.sub, sub)).run();
  return revoked;
}

function storedIdentity(sub: string): OidcIdentity | null {
  const row = getDb().select().from(schema.oidcIdentity).where(eq(schema.oidcIdentity.sub, sub)).get();
  if (!row) return null;
  const groups = parseJson(row.groups);
  return {
    sub: row.sub,
    email: row.email,
    emailVerified: row.emailVerified,
    groups: Array.isArray(groups) ? groups.map(String) : [],
  };
}

export type AccessVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * Cet utilisateur a-t-il ENCORE le droit d'administrer ?
 *  - compte mot de passe : oui tant que le mot de passe est actif ;
 *  - compte Authentik : oui si l'OIDC est configuré et que l'identité retenue
 *    à la connexion reste autorisée par la configuration courante.
 */
export function checkUserAccess(userId: string): AccessVerdict {
  const config = readAuthConfig();
  const accounts = getDb()
    .select({ providerId: schema.account.providerId, accountId: schema.account.accountId })
    .from(schema.account)
    .where(eq(schema.account.userId, userId))
    .all();

  if (accounts.some((a) => a.providerId === "credential") && config.passwordEnabled) return { allowed: true };
  for (const a of accounts) {
    if (a.providerId !== OIDC_PROVIDER_ID || !config.oidc) continue;
    const identity = storedIdentity(a.accountId);
    if (identity && isOidcIdentityAllowed(identity, config)) return { allowed: true };
  }
  if (accounts.some((a) => a.providerId === "credential") && !config.passwordEnabled) {
    return { allowed: false, reason: "connexion par mot de passe désactivée" };
  }
  return { allowed: false, reason: "identité Authentik plus autorisée par la configuration" };
}
