/**
 * Téléchargement d'une sauvegarde : confirmation récente exigée (audit de sécurité, P2). Un cookie de session volé ne suffit
 * plus à emporter la base : il faut soit une connexion de moins de 10 minutes, soit avoir retapé le mot de passe dans les
 * 10 dernières minutes (`unlockBackupDownloadAction`), qui pose un cookie de déverrouillage.
 *
 * Le cookie vaut `<expiration ms>.<HMAC-SHA256(secret, identifiant de session | expiration)>` : lié à CETTE session (inutile
 * avec une autre), signé par BETTER_AUTH_SECRET (absent de la base), limité au chemin des téléchargements. Module pur (crypto).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const UNLOCK_COOKIE = "pf-backup-unlock";
export const UNLOCK_PATH = "/api/admin/sauvegardes";
/** Durée du déverrouillage après la saisie du mot de passe. */
export const UNLOCK_TTL_MS = 10 * 60_000;
/** Une connexion plus récente que ça vaut confirmation (seul moyen quand l'admin se connecte par Authentik). */
export const FRESH_SESSION_MS = 10 * 60_000;

const sign = (secret: string, sessionId: string, exp: number) => createHmac("sha256", secret).update(`backup-unlock|${sessionId}|${exp}`).digest("base64url");

export function unlockValue(secret: string, sessionId: string, now = Date.now()): string {
  const exp = now + UNLOCK_TTL_MS;
  return `${exp}.${sign(secret, sessionId, exp)}`;
}

export function isUnlocked(secret: string, sessionId: string, value: string | null | undefined, now = Date.now()): boolean {
  if (!value || value.length > 128) return false;
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!(exp > now) || exp > now + UNLOCK_TTL_MS) return false;
  const want = Buffer.from(sign(secret, sessionId, exp));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** La session a-t-elle été ouverte il y a moins de FRESH_SESSION_MS ? */
export const isFreshSession = (createdAt: Date | number | string, now = Date.now()) => {
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now - t >= 0 && now - t < FRESH_SESSION_MS;
};

/** Valeur d'un cookie dans un en-tête Cookie brut (route : hors de next/headers). */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
