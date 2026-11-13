/**
 * Sessions de l'admin (audit de sécurité, P3) : durée maximale, liste lisible, déconnexion des autres sessions.
 *
 * Durées :
 *  - inactivité : une session non utilisée pendant SESSION_IDLE_S expire (Better Auth : `session.expiresIn`, prolongée au plus
 *    une fois par SESSION_UPDATE_AGE_S quand elle sert) ;
 *  - absolue : SESSION_MAX_MS après la connexion, la session est refusée et supprimée, même utilisée tous les jours
 *    (`sessionTooOld`, vérifié par la garde de l'admin). Un cookie volé ne vaut donc jamais plus de 7 jours.
 */
import { and, desc, eq, ne } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/** Inactivité : 3 jours. */
export const SESSION_IDLE_S = 3 * 24 * 3600;
/** Prolongation d'une session utilisée : au plus une écriture par heure. */
export const SESSION_UPDATE_AGE_S = 3600;
/** Durée absolue : 7 jours après la connexion. */
export const SESSION_MAX_MS = 7 * 24 * 3_600_000;

export const sessionTooOld = (createdAt: Date | number | string, now = Date.now()) => {
  const t = new Date(createdAt).getTime();
  return !Number.isFinite(t) || now - t > SESSION_MAX_MS;
};

/** « Firefox sur Linux », « Safari sur iPhone »… (lisible, jamais l'en-tête brut en entier). */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Navigateur inconnu";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl|wget|node|undici|python|Go-http/i.test(ua)
              ? "Programme (pas un navigateur)"
              : "Navigateur inconnu";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : null;
  return os ? `${browser} sur ${os}` : browser;
}

export type SessionRow = { id: string; createdAt: number; lastSeenAt: number; expiresAt: number; ip: string | null; browser: string; current: boolean };

/** Sessions encore valables d'un utilisateur, la plus récemment utilisée d'abord. */
export function listUserSessions(userId: string, currentId: string, now = Date.now()): SessionRow[] {
  return getDb()
    .select()
    .from(schema.session)
    .where(eq(schema.session.userId, userId))
    .orderBy(desc(schema.session.updatedAt))
    .all()
    .filter((s) => s.expiresAt.getTime() > now && !sessionTooOld(s.createdAt, now))
    .map((s) => ({ id: s.id, createdAt: s.createdAt.getTime(), lastSeenAt: s.updatedAt.getTime(), expiresAt: Math.min(s.expiresAt.getTime(), s.createdAt.getTime() + SESSION_MAX_MS), ip: s.ipAddress, browser: describeUserAgent(s.userAgent), current: s.id === currentId }));
}

/** Supprime toutes les sessions de l'utilisateur sauf celle-ci ; rend le nombre de sessions coupées. */
export function revokeOtherUserSessions(userId: string, keepId: string): number {
  return getDb().delete(schema.session).where(and(eq(schema.session.userId, userId), ne(schema.session.id, keepId))).run().changes;
}
