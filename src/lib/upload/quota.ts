/**
 * Occupation du stockage des médias (originaux + variantes, d'après la base)
 * et quota facultatif MEDIA_MAX_TOTAL_GB.
 */
import { getDb, schema } from "@/lib/db";
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
