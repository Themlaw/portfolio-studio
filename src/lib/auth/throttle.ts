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
 * 3. Par compte, toutes IP confondues (docs/SECURITE.md §2.4) : au-delà de
 *    ACCOUNT_FREE_FAILURES échecs en 15 min, délai progressif BORNÉ à
 *    ACCOUNT_MAX_DELAY_S depuis le dernier échec : un botnet qui change d'IP
 *    à chaque essai est freiné, et l'artiste n'attend jamais plus que cette
 *    borne. Une IP (groupe /64 en IPv6) qui a réussi à se connecter sur ce
 *    compte depuis moins de 30 jours n'y est pas soumise.
 *
 * « IP » = la clé `ipBucket` (src/lib/auth/client-ip.ts) : l'IPv6 est comptée
 * par /64. En plus, alerte dans les journaux au-delà de ACCOUNT_ALERT_PER_HOUR
 * échecs par heure sur un même compte, toutes IP. Compteurs par IP et par
 * compte en mémoire (une seule instance), BORNÉS (plus ancien évincé en
 * premier) ; délais par couple en base.
 */
import { eq, lt } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { maskEmail } from "./mask";

const IP_WINDOW_MS = 60 * 1000;
export const IP_MAX = 5;
const PAIR_WINDOW_MS = 15 * 60 * 1000;
const FREE_FAILURES = 5;
const MAX_DELAY_S = 60;
const ACCOUNT_ALERT_PER_HOUR = 20;
const MAX_TRACKED_IPS = 50_000;

/**
 * Point d'entrée Better Auth d'un chemin, NORMALISÉ (encodage résolu, barres doublées et finales retirées, minuscules) :
 * « /api/auth/sign-in/email/ », « /api/auth//sign-in/%65mail » → « /sign-in/email ». Hors de /api/auth : null.
 */
export function authEndpoint(pathname: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  path = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "").toLowerCase();
  return path.startsWith("/api/auth/") ? path.slice("/api/auth".length) : null;
}

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

/* ------------------------------------------- 3. par compte, toutes IP -- */

const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_FREE_FAILURES = 10;
export const ACCOUNT_MAX_DELAY_S = 30;
const KNOWN_IP_MS = 30 * 24 * 3600_000;
/** Bornes de la mémoire (N13) : un attaquant qui fait varier e-mails et IP ne la fait plus grossir sans fin. */
export const MAX_TRACKED_ACCOUNTS = 10_000;
const MAX_FAILURES_KEPT = 64;
const MAX_KNOWN_IPS = 8;

type AccountState = {
  /** Instants des derniers échecs (MAX_FAILURES_KEPT au plus, fenêtre de 15 min). */
  failures: number[];
  /** IP (clés ipBucket) qui ont réussi sur ce compte → instant de la réussite. */
  known: Map<string, number>;
  /** Alerte : échecs comptés depuis `alertFrom` (fenêtre d'une heure). */
  alertFrom: number;
  alertCount: number;
};
const accounts = new Map<string, AccountState>();

/** État d'un compte, remis en tête (ordre d'insertion = ordre d'usage) ; le plus ancien est évincé au-delà de la borne. */
function accountState(email: string, now: number): AccountState {
  const state = accounts.get(email) ?? { failures: [], known: new Map(), alertFrom: now, alertCount: 0 };
  accounts.delete(email);
  accounts.set(email, state);
  if (accounts.size > MAX_TRACKED_ACCOUNTS) {
    const oldest = accounts.keys().next().value;
    if (oldest !== undefined) accounts.delete(oldest);
  }
  return state;
}

export function accountDelaySeconds(failures: number): number {
  if (failures < ACCOUNT_FREE_FAILURES) return 0;
  return Math.min(2 ** (failures - ACCOUNT_FREE_FAILURES + 1), ACCOUNT_MAX_DELAY_S);
}

/** Secondes à attendre avant un nouvel essai sur ce compte, toutes IP confondues (0 pour une IP qui a déjà réussi). */
export function accountWaitSeconds(email: string, ip: string, now = Date.now()): number {
  const state = accounts.get(email);
  if (!state) return 0;
  const known = state.known.get(ip);
  if (known !== undefined && now - known < KNOWN_IP_MS) return 0;
  const recent = state.failures.filter((t) => t > now - ACCOUNT_WINDOW_MS);
  if (recent.length === 0) return 0;
  const until = recent[recent.length - 1] + accountDelaySeconds(recent.length) * 1000;
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

/** Échec sur ce compte (toutes IP) : délai du compte et alerte dans les journaux. */
export function noteAccountFailure(email: string, now = Date.now()): void {
  const state = accountState(email, now);
  state.failures = state.failures.filter((t) => t > now - ACCOUNT_WINDOW_MS);
  state.failures.push(now);
  if (state.failures.length > MAX_FAILURES_KEPT) state.failures.splice(0, state.failures.length - MAX_FAILURES_KEPT);
  alertTick(state, email, now);
}

/**
 * Essai refusé par un délai (429 ACCOUNT_THROTTLED) : il ne prolonge pas le délai, mais compte pour l'ALERTE. Sans cela,
 * une fois le délai du compte enclenché (10 échecs), presque tous les essais suivants étaient freinés sans être comptés,
 * et l'alerte « 20 échecs en une heure » n'arrivait qu'au bout de plusieurs minutes d'attaque.
 */
export function noteThrottledAttempt(email: string, now = Date.now()): void {
  alertTick(accountState(email, now), email, now);
}

function alertTick(state: AccountState, email: string, now: number): void {
  if (now - state.alertFrom > 3600_000) {
    state.alertFrom = now;
    state.alertCount = 0;
  }
  state.alertCount++;
  const n = state.alertCount;
  if (n === ACCOUNT_ALERT_PER_HOUR || (n > ACCOUNT_ALERT_PER_HOUR && n % 100 === 0)) {
    console.warn(`[auth] ALERTE : ${n} échecs de connexion en une heure sur le compte ${maskEmail(email)} (toutes IP)`);
  }
}

/** Réussite depuis cette IP : elle n'est plus soumise au délai du compte (30 jours). */
export function noteAccountSuccess(email: string, ip: string, now = Date.now()): void {
  const state = accountState(email, now);
  state.known.delete(ip);
  state.known.set(ip, now);
  if (state.known.size > MAX_KNOWN_IPS) {
    const oldest = state.known.keys().next().value;
    if (oldest !== undefined) state.known.delete(oldest);
  }
}

/** Nombre de comptes suivis en mémoire (tests de la borne). */
export function trackedAccounts(): number {
  return accounts.size;
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
  noteAccountFailure(email, now);
}

export function recordSuccess(email: string, ip: string, now = Date.now()): void {
  getDb().delete(schema.authThrottle).where(eq(schema.authThrottle.email, pairKey(email, ip))).run();
  noteAccountSuccess(email, ip, now);
}
