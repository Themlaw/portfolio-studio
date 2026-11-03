/**
 * Garde de l'admin. Défense en profondeur :
 *  1. src/proxy.ts redirige tout /admin/* sans cookie de session (test rapide) ;
 *  2. le layout de l'admin appelle requireAdmin() (session vérifiée en base) ;
 *  3. chaque server action / route mutante commence par `await assertAdmin()`
 *     (vérifié par scripts/test-admin-guard.mjs).
 *
 * À CHAQUE requête, l'accès est revérifié contre la configuration courante
 * (identité Authentik mémorisée, mot de passe actif) : une session dont
 * l'accès a été retiré est révoquée, même si le cookie est encore valide.
 */
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";

import { getDb, schema } from "@/lib/db";
import { noteAuditUser } from "@/lib/journal/context";

import { checkUserAccess } from "./identity";
import { getAuth } from "./index";

export const LOGIN_PATH = "/admin/connexion";

export const getAdminSession = cache(async () => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const verdict = checkUserAccess(session.user.id);
  if (!verdict.allowed) {
    getDb().delete(schema.session).where(eq(schema.session.token, session.session.token)).run();
    console.warn(`[auth] session révoquée pour ${session.user.email} : ${verdict.reason}`);
    return null;
  }
  return session;
});

export type AdminSession = NonNullable<Awaited<ReturnType<typeof getAdminSession>>>;

/**
 * Session admin valide pour des en-têtes donnés (proxy : hors du contexte de
 * rendu, sans next/headers). Vérifiée en base, accès revérifié ; sans effet de
 * bord (la révocation reste dans getAdminSession).
 */
export async function isAdminRequest(requestHeaders: Headers): Promise<boolean> {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  return Boolean(session && checkUserAccess(session.user.id).allowed);
}

/** Pages de l'admin : redirige vers la connexion sans session valide. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect(LOGIN_PATH);
  return session;
}

/** Server actions et routes mutantes : 403 sans session valide. */
export async function assertAdmin(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) forbidden();
  // Journal d'édition (lot 97) : l'écriture auditée en cours sait qui agit (identifiant interne, jamais l'e-mail).
  noteAuditUser(session.user.id);
  return session;
}
