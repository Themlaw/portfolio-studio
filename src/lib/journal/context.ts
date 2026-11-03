/**
 * Contexte d'une écriture auditée (lot 97). `audited()` / `auditedRoute()` (audit.ts) ouvrent un contexte par appel ;
 * `assertAdmin()` y inscrit l'identifiant interne de l'utilisateur (aucun e-mail), sans second accès à la session.
 * Module sans dépendance : importable par le garde de l'admin sans cycle.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type AuditCtx = { user: string | null };

export const auditStore = new AsyncLocalStorage<AuditCtx>();

/** Inscrit l'utilisateur de l'appel en cours (sans effet hors d'une écriture auditée). */
export function noteAuditUser(id: string): void {
  const ctx = auditStore.getStore();
  if (ctx) ctx.user = id;
}
