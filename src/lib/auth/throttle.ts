/**
 * Limitation des connexions par mot de passe, en deux étages, appliqués par
 * le gestionnaire /api/auth AVANT Better Auth (qui garde sa propre limite) :
 *
 * 1. Par IP : au plus IP_MAX tentatives par minute glissante. TOUTES les
 *    tentatives comptent, refus compris : marteler ne fait que prolonger son
 *    propre blocage.
 * 2. Par couple (e-mail, IP) : délai progressif après des échecs (à partir de
 *    5 échecs en 15 min, 2^(n-4) s depuis le dernier, plafond 60 s). Un
 *    attaquant ne ralentit que SES tentatives sur ce compte, jamais celles
 *    d'une autre IP : il ne peut pas enfermer l'administrateur dehors.
 *
 * En plus, alerte dans les journaux (non bloquante) au-delà de
 * ACCOUNT_ALERT_PER_HOUR échecs par heure sur un même compte, toutes IP.
 * Compteurs par IP en mémoire (une seule instance) ; délais en base.
 */
import { eq, lt } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

const IP_WINDOW_MS = 60 * 1000;
export const IP_MAX = 5;
const PAIR_WINDOW_MS = 15 * 60 * 1000;
const FREE_FAILURES = 5;
const MAX_DELAY_S = 60;
const ACCOUNT_ALERT_PER_HOUR = 20;
const MAX_TRACKED_IPS = 50_000;

/* ---------------------------------------------------------- 1. par IP -- */

const ipAttempts = new Map<string, number[]>();

/** Enregistre une tentative ; renvoie les secondes à attendre (0 = autorisée). */
export function ipAttempt(ip: string, now = Date.now()): number {
  const recent = (ipAttempts.get(ip) ?? []).filter((t) => t > now - IP_WINDOW_MS);
  recent.push(now);
  ipAttempts.delete(ip); // réinsertion : ordre d'insertion = ordre d'usage
  ipAttempts.set(ip, recent);
  if (ipAttempts.size > MAX_TRACKED_IPS) {
    const oldest = ipAttempts.keys().next().value;
    if (oldest !== undefined) ipAttempts.delete(oldest);
  }
  if (recent.length <= IP_MAX) return 0;
  // Bloqué tant que IP_MAX tentatives au moins restent dans la fenêtre.
  const unblockAt = recent[recent.length - IP_MAX] + IP_WINDOW_MS;
  return Math.max(1, Math.ceil((unblockAt - now) / 1000));
}

/* ------------------------------------------------ 2. par (e-mail, IP) -- */

const pairKey = (email: string, ip: string) => `${email}|${ip}`;

export function requiredDelaySeconds(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  return Math.min(2 ** (failures - FREE_FAILURES + 1), MAX_DELAY_S);
}

/** Secondes à attendre avant un nouvel essai de ce compte depuis cette IP. */
export function waitSeconds(email: string, ip: string, now = Date.now()): number {
  const row = getDb().select().from(schema.authThrottle).where(eq(schema.authThrottle.email, pairKey(email, ip))).get();
  if (!row || now - row.firstAt > PAIR_WINDOW_MS) return 0;
  const until = row.lastAt + requiredDelaySeconds(row.failures) * 1000;
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

const accountFailures = new Map<string, number[]>();

function alertOnAccount(email: string, now: number) {
  const hour = (accountFailures.get(email) ?? []).filter((t) => t > now - 3600_000);
  hour.push(now);
  accountFailures.set(email, hour);
  if (hour.length === ACCOUNT_ALERT_PER_HOUR || (hour.length > ACCOUNT_ALERT_PER_HOUR && hour.length % 100 === 0)) {
    console.warn(`[auth] ALERTE : ${hour.length} échecs de connexion en une heure sur le compte ${email} (toutes IP)`);
  }
}

export function recordFailure(email: string, ip: string, now = Date.now()): void {
  const db = getDb();
  const key = pairKey(email, ip);
  db.delete(schema.authThrottle).where(lt(schema.authThrottle.lastAt, now - PAIR_WINDOW_MS)).run();
  const row = db.select().from(schema.authThrottle).where(eq(schema.authThrottle.email, key)).get();
  if (!row || now - row.firstAt > PAIR_WINDOW_MS) {
    db.insert(schema.authThrottle)
      .values({ email: key, failures: 1, firstAt: now, lastAt: now })
      .onConflictDoUpdate({ target: schema.authThrottle.email, set: { failures: 1, firstAt: now, lastAt: now } })
      .run();
  } else {
    db.update(schema.authThrottle).set({ failures: row.failures + 1, lastAt: now }).where(eq(schema.authThrottle.email, key)).run();
  }
  alertOnAccount(email, now);
}

export function recordSuccess(email: string, ip: string): void {
  getDb().delete(schema.authThrottle).where(eq(schema.authThrottle.email, pairKey(email, ip))).run();
}
