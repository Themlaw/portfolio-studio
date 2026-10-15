/**
 * Papiers peints (lot 35), lectures : la bibliothèque telle que le rendu public et la toile la lisent (`getWallpapers`, en cache,
 * étiquette `wallpapers`), et telle que l'écran Admin → Thèmes → Papiers peints l'affiche (`listWallpapersForAdmin`, directe).
 * Écritures : src/lib/edit/wallpapers.ts. Stockage : une ligne `wallpapers` par motif + un média ordinaire pour le fichier
 * (docs/ARCHITECTURE.md, lot 35).
 */
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";

import { cached, TAGS } from "./cache";
import { getDb, schema } from "./db";
import { parseVariants } from "./images/variants";
import { mediaUrl } from "./media";
import type { WallpaperEntry } from "@/themes/wallpaper";

/** Motifs utilisables par le rendu : dans la bibliothèque (pas à la corbeille), fichier prêt. Sérialisable (cache). */
export async function getWallpaperList(): Promise<WallpaperEntry[]> {
  return cached(["wallpapers"], [TAGS.wallpapers, TAGS.media], () => {
    const rows = getDb()
      .select({ w: schema.wallpapers, m: schema.media })
      .from(schema.wallpapers)
      .innerJoin(schema.media, eq(schema.media.id, schema.wallpapers.mediaId))
      .where(and(isNull(schema.wallpapers.deletedAt), isNull(schema.media.deletedAt), eq(schema.media.status, "ready")))
      .orderBy(schema.wallpapers.id)
      .all();
    return rows.flatMap(({ w, m }) => entryOf(w, m) ?? []);
  });
}

type WallpaperRow = typeof schema.wallpapers.$inferSelect;
type MediaRow = typeof schema.media.$inferSelect;

/** Entrée de rendu d'un motif (variantes WebP du média), ou null si le fichier n'a pas encore de variante. */
export function entryOf(w: WallpaperRow, m: MediaRow): WallpaperEntry | null {
  const files = (parseVariants(m.variants)?.files ?? []).filter((f) => f.format === "webp").sort((a, b) => a.w - b.w).map((f) => ({ w: f.w, url: mediaUrl(f.key) }));
  if (!files.length || !m.width || !m.height) return null;
  return { id: w.id, name: w.name, w: m.width, h: m.height, size: w.size, opacity: w.opacity, files };
}

/** La bibliothèque, indexée par identifiant (une lecture par page rendue). */
export async function getWallpapers(): Promise<Map<number, WallpaperEntry>> {
  return new Map((await getWallpaperList()).map((e) => [e.id, e]));
}

export type AdminWallpaper = {
  id: number;
  name: string;
  mediaId: number;
  size: number;
  opacity: number;
  /** processing = fichier en cours de traitement ; failed = traitement échoué. */
  status: "processing" | "ready" | "failed";
  /** Vignette (variante WebP la plus étroite), ou null tant que le fichier n'est pas prêt. */
  thumb: string | null;
  width: number | null;
  height: number | null;
  /** Le fichier n'a aucune transparence : le motif cachera ce qu'il y a dessous (avertissement, pas un refus). */
  opaque: boolean;
  deletedAt: number | null;
};

function toAdmin(w: WallpaperRow, m: MediaRow): AdminWallpaper {
  const files = (parseVariants(m.variants)?.files ?? []).filter((f) => f.format === "webp").sort((a, b) => a.w - b.w);
  const thumb = m.status === "ready" ? (files.find((f) => f.w >= 240) ?? files.at(-1))?.key : undefined;
  return {
    id: w.id,
    name: w.name,
    mediaId: w.mediaId,
    size: w.size,
    opacity: w.opacity,
    status: m.status,
    thumb: thumb ? mediaUrl(thumb) : null,
    width: m.width,
    height: m.height,
    // Pas de couleur dominante = image avec de la transparence (src/lib/images/process.ts).
    opaque: m.status === "ready" && m.dominantColor !== null,
    deletedAt: w.deletedAt ? w.deletedAt.getTime() : null,
  };
}

/** Bibliothèque de l'admin (hors corbeille, le plus récent d'abord) ou sa corbeille. Lecture directe, sans cache. */
export function listWallpapersForAdmin(trashed = false): AdminWallpaper[] {
  return getDb()
    .select({ w: schema.wallpapers, m: schema.media })
    .from(schema.wallpapers)
    .innerJoin(schema.media, eq(schema.media.id, schema.wallpapers.mediaId))
    .where(trashed ? isNotNull(schema.wallpapers.deletedAt) : isNull(schema.wallpapers.deletedAt))
    .orderBy(desc(trashed ? schema.wallpapers.deletedAt : schema.wallpapers.id))
    .all()
    .map(({ w, m }) => toAdmin(w, m));
}

/** Motifs proposés à l'éditeur (fond d'un composant, papier d'une page ou d'une carte) : prêts, hors corbeille. Léger. */
export function listWallpaperChoices(): { id: number; name: string; thumb: string | null; size: number; opacity: number }[] {
  return listWallpapersForAdmin().filter((w) => w.status === "ready").map((w) => ({ id: w.id, name: w.name, thumb: w.thumb, size: w.size, opacity: w.opacity }));
}
