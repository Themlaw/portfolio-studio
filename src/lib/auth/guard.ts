/**
 * Garde de l'admin. Défense en profondeur :
 *  1. src/proxy.ts redirige tout /admin/* sans session valide (vérifiée en base par isAdminRequest) ;
 *  2. le layout de l'admin ET chaque page appellent requireAdmin() (session vérifiée en base ; une navigation RSC
 *     ne rend que les segments qui changent : la garde du layout seule ne suffit pas, docs/SECURITE.md §2.2) ;
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

/** Session de ces en-têtes, vérifiée en base ; une session dont l'accès a été retiré est RÉVOQUÉE (supprimée) et vaut null. */
async function verifiedSession(requestHeaders: Headers) {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const verdict = checkUserAccess(session.user.id);
  if (!verdict.allowed) {
    getDb().delete(schema.session).where(eq(schema.session.token, session.session.token)).run();
    console.warn(`[auth] session révoquée pour ${session.user.email} : ${verdict.reason}`);
    return null;
  }
  return session;
}

export const getAdminSession = cache(async () => verifiedSession(await headers()));

export type AdminSession = NonNullable<Awaited<ReturnType<typeof getAdminSession>>>;

/**
 * Session admin valide pour des en-têtes donnés (proxy : hors du contexte de
 * rendu, sans next/headers). Vérifiée en base, accès revérifié ; sans effet de
 * bord (la révocation reste dans getAdminSession).
 */
export async function isAdminRequest(requestHeaders: Headers): Promise<boolean> {
  return (await adminUserId(requestHeaders)) !== null;
}

/** Identifiant interne de l'admin de ces en-têtes (session vérifiée en base, accès revérifié), ou null. */
export async function adminUserId(requestHeaders: Headers): Promise<string | null> {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  return session && checkUserAccess(session.user.id).allowed ? session.user.id : null;
}

/**
 * Garde de l'admin dans le proxy (docs/SECURITE.md §2.2) : session vérifiée en base, accès revérifié, et, comme pour
 * getAdminSession, révocation d'une session dont l'accès a été retiré (le layout n'est plus atteint pour le faire).
 */
export async function adminGateAllows(requestHeaders: Headers): Promise<boolean> {
  return (await verifiedSession(requestHeaders)) !== null;
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
