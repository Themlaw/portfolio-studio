"use server";

/**
 * Server actions des papiers peints (lot 35) : importer un motif, le renommer, régler sa taille et son opacité, le supprimer
 * (corbeille, restaurable 30 jours), choisir le papier peint des cartes du site. Chacune : `await assertAdmin()`, identifiants et
 * charges validés par zod, étiquettes de cache invalidées.
 */
import { z } from "zod";

import { getWallpaperUses, type WallpaperUseRow } from "@/lib/admin";
import { assertAdmin } from "@/lib/auth/guard";
import { createWallpaper, renameWallpaper, restoreWallpaper, saveCardWallpaper, saveWallpaperPaint, trashWallpaper } from "@/lib/edit/wallpapers";
import { fail, type ActionResult } from "@/lib/edit/result";
import { revalidateWallpapers } from "@/lib/revalidate";
import { listWallpapersForAdmin, type AdminWallpaper } from "@/lib/wallpapers";

const Id = z.number().int().positive();

/** Ajoute à la bibliothèque le fichier qui vient d'être envoyé (média créé par /admin/api/upload). */
export async function createWallpaperAction(mediaId: unknown): Promise<ActionResult<{ id: number; name: string; reused: boolean }>> {
  await assertAdmin();
  const result = createWallpaper(mediaId);
  if (result.ok) revalidateWallpapers();
  return result;
}

export async function renameWallpaperAction(id: unknown, name: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Motif inconnu.");
  const result = renameWallpaper(parsed.data, name);
  if (result.ok) revalidateWallpapers();
  return result;
}

/** Taille d'une tuile (px) et opacité par défaut du motif. */
export async function saveWallpaperPaintAction(id: unknown, paint: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Motif inconnu.");
  const result = saveWallpaperPaint(parsed.data, paint);
  if (result.ok) revalidateWallpapers();
  return result;
}

/** Où le motif sert (avertissement avant de le supprimer). */
export async function wallpaperUsesAction(id: unknown): Promise<ActionResult<WallpaperUseRow[]>> {
  await assertAdmin();
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Motif inconnu.");
  return { ok: true, data: getWallpaperUses(parsed.data) };
}

/** Supprimer = mettre à la corbeille (restaurable 30 jours) ; un motif utilisé quitte le rendu sans rien casser. */
export async function trashWallpaperAction(id: unknown): Promise<ActionResult<{ name: string }>> {
  await assertAdmin();
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Motif inconnu.");
  const result = trashWallpaper(parsed.data);
  if (result.ok) revalidateWallpapers();
  return result;
}

export async function restoreWallpaperAction(id: unknown): Promise<ActionResult<{ name: string }>> {
  await assertAdmin();
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Motif inconnu.");
  const result = restoreWallpaper(parsed.data);
  if (result.ok) revalidateWallpapers();
  return result;
}

/** Papier peint par défaut des cartes du site (null = aucun). */
export async function saveCardWallpaperAction(input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const result = saveCardWallpaper(input);
  if (result.ok) revalidateWallpapers();
  return result;
}

/** État de la bibliothèque (suivi du traitement d'un fichier qui vient d'être envoyé). */
export async function listWallpapersAction(): Promise<ActionResult<AdminWallpaper[]>> {
  await assertAdmin();
  return { ok: true, data: listWallpapersForAdmin() };
}
