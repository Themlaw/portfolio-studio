/**
 * Occupation du stockage des médias (originaux + variantes, d'après la base)
 * et quota facultatif MEDIA_MAX_TOTAL_GB.
 */
import { getDb, schema } from "@/lib/db";
import { parseVariants } from "@/lib/images/variants";

export type StorageUsage = { usedBytes: number; quotaBytes: number | null };

export function storageUsage(): StorageUsage {
  let used = 0;
  for (const m of getDb().select({ size: schema.media.size, variants: schema.media.variants }).from(schema.media).all()) {
    used += m.size;
    for (const f of parseVariants(m.variants)?.files ?? []) used += f.size;
  }
  const gb = Number(process.env.MEDIA_MAX_TOTAL_GB || 0);
  return { usedBytes: used, quotaBytes: Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1024 ** 3) : null };
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
