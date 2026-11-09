/**
 * Occupation du stockage des médias (originaux + variantes, d'après la base),
 * quota facultatif MEDIA_MAX_TOTAL_GB, et garde d'espace libre sur le disque
 * des données (`diskProblem`, statfs) : même sans quota, un envoi ne remplit
 * jamais /data au point de faire tomber la base, les sauvegardes et le journal.
 */
import { statfs } from "node:fs/promises";

import { dataDir, getDb, schema } from "@/lib/db";
import { parseVariants } from "@/lib/images/variants";

export type StorageUsage = { usedBytes: number; quotaBytes: number | null };

export function storageUsage(): StorageUsage {
  let used = 0;
  const rows = getDb()
    .select({ size: schema.media.size, variants: schema.media.variants, kind: schema.media.kind, status: schema.media.status, duration: schema.media.duration, width: schema.media.width, height: schema.media.height })
    .from(schema.media)
    .all();
  for (const m of rows) {
    const v = parseVariants(m.variants) as (ReturnType<typeof parseVariants> & { originalRemoved?: boolean }) | null;
    if (!v?.originalRemoved) used += m.size; // original vidéo supprimé après conversion : non compté
    for (const f of v?.files ?? []) used += f.size;
    // Vidéo en conversion : sorties à venir réservées (estimation par débit).
    if (m.kind === "video" && m.status === "processing") used += estimateVideoOutputs(m.duration, m.width, m.height);
  }
  // Envois par morceaux en cours : leur taille annoncée est réservée.
  for (const u of getDb().select({ size: schema.uploads.size }).from(schema.uploads).all()) used += u.size;
  const gb = Number(process.env.MEDIA_MAX_TOTAL_GB || 0);
  return { usedBytes: used, quotaBytes: Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1024 ** 3) : null };
}

/**
 * Estimation du poids des sorties d'une conversion : ~8 Mbit/s si une sortie
 * 1080 est produite (1080 + 720), ~2,5 Mbit/s sinon, plus une marge.
 */
export function estimateVideoOutputs(duration: number | null, width: number | null, height: number | null): number {
  const hd = Math.min(width ?? 0, height ?? 0) >= 1080;
  const bitsPerSecond = hd ? 8_000_000 : 2_500_000;
  return Math.ceil(((duration ?? 0) * bitsPerSecond) / 8) + 1024 * 1024;
}

export function formatGb(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (bytes < 1024 ** 2) return `${Math.ceil(bytes / 1024)} Ko`;
  if (gb < 1) return `${(bytes / 1024 ** 2).toFixed(1)} Mo`.replace(".", ",");
  return `${gb < 10 ? gb.toFixed(2) : gb.toFixed(1)} Go`.replace(".", ",");
}

/** Message de refus si `extra` octets de plus dépasseraient le quota, sinon null. */
export function quotaProblem(extra = 0): string | null {
  const { usedBytes, quotaBytes } = storageUsage();
  if (quotaBytes === null || usedBytes + extra <= quotaBytes) return null;
  return `Ton espace de stockage est plein (${formatGb(usedBytes)} utilisés sur ${formatGb(quotaBytes)}). Supprime des images inutilisées dans la médiathèque pour en envoyer de nouvelles.`;
}

/** Espace laissé libre sur le disque des données, en octets (UPLOAD_MIN_FREE_MB, défaut 512 Mo ; 0 = aucune garde). */
export function minFreeBytes(): number {
  const raw = process.env.UPLOAD_MIN_FREE_MB;
  const mb = raw === undefined || raw === "" ? 512 : Number(raw);
  return Number.isFinite(mb) && mb >= 0 ? Math.round(mb * 1024 ** 2) : 512 * 1024 ** 2;
}

/** Octets disponibles sur le disque des données (statfs), null si illisible (aucune garde plutôt qu'un refus à tort). */
export async function freeDiskBytes(): Promise<number | null> {
  try {
    const s = await statfs(dataDir());
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/**
 * Message de refus si écrire `need` octets de plus laisserait moins de `minFreeBytes()` libres sur le disque des données, sinon null.
 * `pending` : ce que les envois déjà ouverts doivent encore écrire (réservé, comme pour le quota).
 */
export async function diskProblem(need: number, pending = 0): Promise<string | null> {
  const min = minFreeBytes();
  if (min === 0) return null;
  const free = await freeDiskBytes();
  if (free === null || free - pending - need >= min) return null;
  return `Le disque du serveur est presque plein (${formatGb(Math.max(0, free))} libres) : cet envoi est refusé pour ne pas mettre le site en panne. Supprime des médias inutilisés, ou demande plus de place.`;
}

/**
 * Envois DIRECTS (/admin/api/upload) en cours : leur taille annoncée est réservée le temps de la réception, comme celle des envois
 * par morceaux (table uploads). Sans cela, N envois simultanés passaient tous la vérification du quota avant qu'aucun n'ait écrit.
 * Mémoire du processus (le site est un seul processus) ; vérification et réservation sont synchrones : rien ne s'intercale.
 */
let directReserved = 0;

/** Réserve `bytes` pour un envoi direct : { release } si la place existe, { problem } sinon. `release` est idempotent. */
export function reserveDirectUpload(bytes: number): { problem: string } | { release: () => void } {
  const need = Math.max(0, Math.round(bytes));
  const full = quotaProblem(directReserved + need);
  if (full) return { problem: full };
  directReserved += need;
  let done = false;
  return {
    release: () => {
      if (done) return;
      done = true;
      directReserved = Math.max(0, directReserved - need);
    },
  };
}

/** Octets réservés par les envois directs en cours (pour la garde du disque). */
export function directReservedBytes(): number {
  return directReserved;
}
