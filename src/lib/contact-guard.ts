/**
 * Garde-fous du formulaire de contact public (docs/SECURITE.md §2.3, §2.12, N20). Module pur côté serveur, sans base :
 * - jeton d'envoi signé (HMAC, clé dérivée du secret par HKDF, étiquette `contact-token`) : délivré par
 *   GET /api/contact/token (no-store : les pages publiques restent en cache ISR), lié au formulaire, daté,
 *   valable `TOKEN_TTL_MS`, à usage unique (consommé seulement quand le message est enregistré) ;
 * - délai minimal (`MIN_DELAY_MS`) entre la délivrance du jeton (affichage du formulaire) et l'envoi ;
 * - empreinte d'IP par HMAC (étiquette `contact-ip`) : non réversible sans le secret (l'espace IPv4 est petit) ;
 * - préfixe réseau (/24 en IPv4, /64 en IPv6) pour un plafond par voisinage, compté en mémoire (perdu au
 *   redémarrage : c'est une limite de débit, pas un registre).
 * Aucun service tiers, aucun captcha : un visiteur au clavier ou avec un lecteur d'écran n'a rien de plus à faire.
 */
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/** Délai minimal entre l'affichage du formulaire (jeton délivré) et l'envoi. */
export const MIN_DELAY_MS = 3000;
/** Durée de vie d'un jeton (page restée ouverte : le formulaire en redemande un). */
export const TOKEN_TTL_MS = 2 * 3600_000;

// Hors production sans secret : valeur fixe (dev, tests). En production la connexion exige BETTER_AUTH_SECRET
// (src/lib/auth/config.ts) ; s'il manquait ici quand même, un secret aléatoire du processus évite toute clé devinable.
const DEV_SECRET = "secret-de-dev-supprime";
const PROCESS_SECRET = randomBytes(32).toString("hex");
const rootSecret = () => process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV === "production" ? PROCESS_SECRET : DEV_SECRET);

const keys = new Map<string, Buffer>();
/** Clé dérivée du secret (HKDF-SHA256), une par usage : jamais le secret brut. */
function derived(label: string): Buffer {
  const root = rootSecret();
  const id = `${label}\0${root}`;
  let key = keys.get(id);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", root, "portfolio", label, 32));
    if (keys.size > 8) keys.clear(); // secret changé (tests) : les anciennes clés ne servent plus
    keys.set(id, key);
  }
  return key;
}

const sign = (payload: string) => createHmac("sha256", derived("contact-token")).update(payload).digest("base64url").slice(0, 32);

/** Jeton d'envoi pour le formulaire `formId` : `<émis en ms, base 36>.<aléa>.<signature>`. */
export function issueContactToken(formId: string, now = Date.now()): string {
  const head = `${now.toString(36)}.${randomBytes(9).toString("base64url")}`;
  return `${head}.${sign(`${formId}.${head}`)}`;
}

export type TokenCheck = { ok: true; nonce: string } | { ok: false; reason: "invalid" | "expired" | "early"; waitMs?: number };

/** Vérifie un jeton (signature en temps constant, formulaire, âge, usage unique). Ne le consomme pas. */
export function checkContactToken(token: unknown, formId: string, now = Date.now()): TokenCheck {
  if (typeof token !== "string" || token.length > 80 || !/^[0-9a-z]{1,11}\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{32}$/.test(token)) return { ok: false, reason: "invalid" };
  const [at, nonce, sig] = token.split(".");
  const expected = Buffer.from(sign(`${formId}.${at}.${nonce}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };
  if (used.has(nonce)) return { ok: false, reason: "invalid" };
  const issued = parseInt(at, 36);
  if (!Number.isFinite(issued) || issued > now + 60_000 || now - issued > TOKEN_TTL_MS) return { ok: false, reason: "expired" };
  if (now - issued < MIN_DELAY_MS) return { ok: false, reason: "early", waitMs: MIN_DELAY_MS - (now - issued) };
  return { ok: true, nonce };
}

/** Jetons déjà utilisés (aléa → fin de validité), bornés : un jeton expiré n'a plus besoin d'y être. */
const used = new Map<string, number>();
const USED_MAX = 20_000;
export function consumeContactToken(nonce: string, now = Date.now()): void {
  if (used.size >= USED_MAX) {
    for (const [k, until] of used) if (until < now) used.delete(k);
    // Encore plein (rafale de vrais envois, improbable sous les plafonds) : les plus anciens partent.
    for (const k of used.keys()) {
      if (used.size < USED_MAX) break;
      used.delete(k);
    }
  }
  used.set(nonce, now + TOKEN_TTL_MS + 60_000);
}

/** Empreinte d'une IP (ou d'un préfixe) : HMAC avec une clé dérivée du secret, jamais un simple hachage. */
export function contactIpHash(value: string): string {
  return createHmac("sha256", derived("contact-ip")).update(value).digest("hex").slice(0, 32);
}

/** Préfixe réseau d'une IP : /24 en IPv4 (y compris IPv4 dans IPv6), /64 en IPv6 ; null si illisible. */
export function ipPrefix(ip: string): string | null {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (!ip.includes(":") || !/^[0-9a-f:]+$/i.test(ip)) return null;
  const halves = ip.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array(Math.max(0, fill)).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

/** Envois récents par préfixe (empreinte → instants), fenêtre glissante, en mémoire et borné. */
const byPrefix = new Map<string, number[]>();
const PREFIX_MAX_KEYS = 10_000;
/** Nombre d'envois de ce préfixe dans la fenêtre (sans compter celui en cours). */
export function prefixCount(key: string, windowMs: number, now = Date.now()): number {
  const list = byPrefix.get(key);
  if (!list) return 0;
  const kept = list.filter((t) => now - t < windowMs);
  if (kept.length) byPrefix.set(key, kept);
  else byPrefix.delete(key);
  return kept.length;
}
export function prefixRecord(key: string, now = Date.now()): void {
  if (!byPrefix.has(key) && byPrefix.size >= PREFIX_MAX_KEYS) {
    const oldest = byPrefix.keys().next().value;
    if (oldest !== undefined) byPrefix.delete(oldest);
  }
  const list = byPrefix.get(key) ?? [];
  list.push(now);
  byPrefix.delete(key);
  byPrefix.set(key, list.slice(-50));
}

/** Ménage des vieux messages au plus une fois par heure (instant du dernier, par processus) : vrai = à faire maintenant. */
const SWEEP_EVERY_MS = 3600_000;
let lastSweep = 0;
export function sweepDue(now = Date.now()): boolean {
  if (now - lastSweep < SWEEP_EVERY_MS) return false;
  lastSweep = now;
  return true;
}

/** Pour les tests : remet les compteurs en mémoire à zéro. */
export function resetContactGuard(): void {
  used.clear();
  byPrefix.clear();
  lastSweep = 0;
}
