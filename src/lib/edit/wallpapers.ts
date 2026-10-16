/**
 * Écritures des papiers peints (lot 35, admin) : importer un motif (le fichier est déjà un média, envoyé par /admin/api/upload),
 * le renommer, régler sa taille / son opacité, le mettre à la corbeille (restaurable 30 jours, comme un média), le supprimer pour de
 * bon, et choisir le papier peint par défaut des cartes du site.
 *
 * Supprimer un motif UTILISÉ est permis (contrairement à un média) : l'écran avertit avec la liste des endroits, puis le motif quitte
 * le rendu sans rien casser (les identifiants restent dans les JSON, lus avec tolérance). Restauré, il revient partout.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { findMediaUsages } from "@/lib/references";
import { CardWallpaperSchema, WALLPAPER_OPACITY_MIN, WALLPAPER_SIZE_MAX, WALLPAPER_SIZE_MIN } from "@/themes/schema";
import { defaultWallpaperSize } from "@/themes/wallpaper";

import { done, fail, zodFieldErrors, type ActionResult } from "./result";

/** Formats qui portent de la transparence ET que l'envoi accepte (le JPEG n'en a pas, le GIF est animé, le SVG est refusé à l'envoi). */
export const WALLPAPER_MIMES = ["image/png", "image/webp", "image/avif"] as const;
export const WALLPAPER_FORMAT_HELP = "PNG ou WebP, de préférence sur fond transparent.";

const Name = z.string().trim().min(1, "Donne un nom au motif.").max(60, "Nom trop long (60 caractères au plus).");
const Paint = z.strictObject({
  size: z.number().int().min(WALLPAPER_SIZE_MIN).max(WALLPAPER_SIZE_MAX),
  opacity: z.number().min(WALLPAPER_OPACITY_MIN).max(1),
});

/** Nom proposé d'après le fichier : sans extension ni séparateurs, 60 caractères au plus. */
export function nameFromFile(original: string | null | undefined, fallback: string): string {
  const base = (original ?? "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return base || fallback;
}

/**
 * Ajoute à la bibliothèque le média envoyé. Même fichier déjà présent : le motif existant (restauré s'il était à la corbeille) —
 * `reused`. Refus lisibles : pas une image, mauvais format, traitement échoué.
 */
export function createWallpaper(mediaId: unknown): ActionResult<{ id: number; name: string; reused: boolean }> {
  const parsed = z.number().int().positive().safeParse(mediaId);
  if (!parsed.success) return fail("Image inconnue.");
  const db = getDb();
  return db.transaction((tx) => {
    const media = tx.select().from(schema.media).where(eq(schema.media.id, parsed.data)).get();
    if (!media || media.deletedAt) return fail("Cette image n'existe plus : renvoie le fichier.");
    if (media.kind !== "image" || !(WALLPAPER_MIMES as readonly string[]).includes(media.mime)) {
      return fail(`Un papier peint doit être un fichier ${WALLPAPER_FORMAT_HELP} Ce fichier n'est pas utilisable (JPEG, GIF et vidéos n'ont pas de transparence).`);
    }
    if (media.status === "failed") return fail("Le traitement de ce fichier a échoué : essaie de l'exporter de nouveau, puis renvoie-le.");
    const known = tx.select().from(schema.wallpapers).where(eq(schema.wallpapers.mediaId, media.id)).get();
    if (known) {
      if (known.deletedAt) tx.update(schema.wallpapers).set({ deletedAt: null }).where(eq(schema.wallpapers.id, known.id)).run();
      return done({ id: known.id, name: known.name, reused: true });
    }
    const name = nameFromFile(media.originalName, `Motif ${new Date().toLocaleDateString("fr-FR")}`);
    const row = tx
      .insert(schema.wallpapers)
      .values({ name, mediaId: media.id, size: defaultWallpaperSize(media.width), opacity: 1 })
      .returning({ id: schema.wallpapers.id })
      .get();
    return done({ id: row.id, name, reused: false });
  });
}

export function renameWallpaper(id: number, name: unknown): ActionResult<null> {
  const parsed = Name.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Nom invalide.", zodFieldErrors(parsed.error.issues, "name"));
  const r = getDb().update(schema.wallpapers).set({ name: parsed.data }).where(eq(schema.wallpapers.id, id)).run();
  return r.changes ? done(null) : fail("Ce motif n'existe plus.");
}

/** Taille d'une tuile (px) et opacité par défaut du motif : les endroits qui n'ont pas de réglage propre les suivent. */
export function saveWallpaperPaint(id: number, input: unknown): ActionResult<null> {
  const parsed = Paint.safeParse(input);
  if (!parsed.success) return fail("Taille ou opacité hors limites.", zodFieldErrors(parsed.error.issues));
  const r = getDb()
    .update(schema.wallpapers)
    .set({ size: parsed.data.size, opacity: Math.round(parsed.data.opacity * 100) / 100 })
    .where(eq(schema.wallpapers.id, id))
    .run();
  return r.changes ? done(null) : fail("Ce motif n'existe plus.");
}

/** À la corbeille (restaurable 30 jours). Un motif utilisé quitte le rendu tout de suite ; restauré, il revient. */
export function trashWallpaper(id: number): ActionResult<{ name: string }> {
  const db = getDb();
  const row = db.select().from(schema.wallpapers).where(eq(schema.wallpapers.id, id)).get();
  if (!row || row.deletedAt) return fail("Ce motif n'existe plus.");
  db.update(schema.wallpapers).set({ deletedAt: new Date() }).where(eq(schema.wallpapers.id, id)).run();
  return done({ name: row.name });
}

export function restoreWallpaper(id: number): ActionResult<{ name: string }> {
  const db = getDb();
  const row = db.select().from(schema.wallpapers).where(eq(schema.wallpapers.id, id)).get();
  if (!row || !row.deletedAt) return fail("Ce motif n'est pas dans la corbeille.");
  db.update(schema.wallpapers).set({ deletedAt: null }).where(eq(schema.wallpapers.id, id)).run();
  return done({ name: row.name });
}

/**
 * Suppression définitive (purge de la corbeille) : la ligne part, et son fichier passe à la corbeille des médias avec la date de la
 * mise à la corbeille du motif (la même purge le supprime) — sauf si un bloc ou une planche utilise ce média par ailleurs. Les
 * références au motif restent dans les JSON : elles ne trouvent plus rien et sont ignorées au rendu.
 */
export function purgeWallpaper(id: number): boolean {
  const db = getDb();
  const row = db.select().from(schema.wallpapers).where(eq(schema.wallpapers.id, id)).get();
  if (!row?.deletedAt) return false;
  db.transaction((tx) => {
    tx.delete(schema.wallpapers).where(eq(schema.wallpapers.id, id)).run();
    const other = tx.select({ id: schema.wallpapers.id }).from(schema.wallpapers).where(eq(schema.wallpapers.mediaId, row.mediaId)).get();
    if (!other && !findMediaUsages(row.mediaId).length) {
      tx.update(schema.media).set({ deletedAt: row.deletedAt }).where(and(eq(schema.media.id, row.mediaId), isNull(schema.media.deletedAt))).run();
    }
  });
  return true;
}

/** Papier peint par défaut des cartes du site (null = aucun : les cartes gardent le papier du kit, comme avant). */
export function saveCardWallpaper(input: unknown): ActionResult<null> {
  const db = getDb();
  if (input === null) {
    db.delete(schema.settings).where(eq(schema.settings.key, "cardWallpaper")).run();
    return done(null);
  }
  const parsed = CardWallpaperSchema.safeParse(input);
  if (!parsed.success) return fail("Réglage invalide.", zodFieldErrors(parsed.error.issues));
  const wp = db.select({ id: schema.wallpapers.id }).from(schema.wallpapers).where(and(eq(schema.wallpapers.id, parsed.data.wallpaper), isNull(schema.wallpapers.deletedAt))).get();
  if (!wp) return fail("Ce motif n'est plus dans la bibliothèque.");
  const value = JSON.stringify(parsed.data);
  db.insert(schema.settings).values({ key: "cardWallpaper", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
  return done(null);
}
