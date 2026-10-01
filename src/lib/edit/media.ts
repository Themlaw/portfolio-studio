/**
 * Écritures des médias (admin) : texte alternatif, suppression. Un média cité
 * par un bloc ne se supprime pas ; utilisé seulement par des emplacements, il
 * les laisse vides (ils gardent leur place). Original et variantes sont
 * supprimés du stockage.
 */
import { and, eq, isNotNull, isNull, like, or } from "drizzle-orm";
import { z } from "zod";

import { BLOCKS } from "@/blocks/registry";
import { getDb, schema } from "@/lib/db";
import { parseVariants } from "@/lib/images/variants";
import { own } from "@/lib/own";
import { findMediaUsages } from "@/lib/references";
import { getStorage } from "@/lib/storage";

import { done, fail, zodFieldErrors, type ActionResult } from "./result";

const Alt = z.strictObject({ fr: z.string().trim().max(300), en: z.string().trim().max(300) });

export function saveMediaAlt(id: number, input: unknown): ActionResult<null> {
  const parsed = Alt.safeParse(input);
  if (!parsed.success) return fail("Texte alternatif trop long (300 caractères au plus).", zodFieldErrors(parsed.error.issues, "alt"));
  const db = getDb();
  if (!db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.id, id)).get()) return fail("Cette image n'existe plus.");
  db.update(schema.media).set({ alt: parsed.data }).where(eq(schema.media.id, id)).run();
  return done(null);
}

/** Relance le traitement d'un média en échec (l'original doit être encore là). */
export async function retryMedia(id: number): Promise<ActionResult<null>> {
  const db = getDb();
  const media = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
  if (!media) return fail("Ce média n'existe plus.");
  if (media.status !== "failed") return fail("Ce média n'est pas en échec.");
  if (!(await getStorage().stat(media.key))) return fail("Le fichier d'origine n'est plus disponible : supprime ce média et renvoie le fichier.");
  db.transaction((tx) => {
    tx.update(schema.media).set({ status: "processing", error: null }).where(eq(schema.media.id, id)).run();
    tx.delete(schema.jobs).where(eq(schema.jobs.mediaId, id)).run();
    tx.insert(schema.jobs).values({ kind: media.kind, mediaId: id }).run();
  });
  return done(null);
}

export type MediaBlockUse = { pageId: number; pageTitle: string; blockType: string };

export async function deleteMedia(
  id: number,
): Promise<ActionResult<{ emptiedSlots: number; projectIds: number[] }> | { ok: false; message: string; references: MediaBlockUse[] }> {
  const db = getDb();
  // Vérification des usages et suppression dans la MÊME transaction : un bloc
  // ajouté entre-temps ne peut pas se retrouver pointant vers une image effacée.
  const outcome = db.transaction((tx) => {
    const media = tx.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!media) return { kind: "missing" as const };
    if (media.status === "processing") return { kind: "processing" as const };
    const usages = findMediaUsages(id);
    const blocks = usages.flatMap((u) => (u.kind === "block" ? [u] : []));
    // Planches en brouillon (éditeur visuel) : image de remplacement, ou
    // emplacement ajouté. Supprimer casserait la publication : bloqué.
    const drafts = tx
      .select({ id: schema.slots.id, pageId: schema.slots.draftPageId })
      .from(schema.slots)
      .where(and(isNotNull(schema.slots.draftPageId), or(eq(schema.slots.draftMediaId, id), and(eq(schema.slots.draftState, "added"), eq(schema.slots.mediaId, id)))))
      .all()
      .map((s) => ({ kind: "block" as const, blockId: -s.id, pageId: s.pageId as number, type: "project-board", path: "media" as const }));
    if (blocks.length || drafts.length) return { kind: "blocked" as const, blocks: [...blocks, ...drafts] };
    const slots = usages.flatMap((u) => (u.kind === "slot" ? [u] : []));
    // Les emplacements vidés gardent la largeur de l'image.
    if (media.width && media.height) {
      tx.update(schema.slots).set({ aspect: media.width / media.height }).where(and(eq(schema.slots.mediaId, id), isNull(schema.slots.aspect))).run();
    }
    tx.delete(schema.media).where(eq(schema.media.id, id)).run(); // slots.media_id → null (clé étrangère)
    // Fichiers à effacer : seulement ceux qu'aucune autre ligne ne référence.
    const hash16 = media.sha256?.slice(0, 16);
    const sharedOriginal = tx.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.key, media.key)).get();
    const sharedVariants = hash16 ? tx.select({ id: schema.media.id }).from(schema.media).where(like(schema.media.sha256, `${hash16}%`)).get() : undefined;
    const keys = [
      ...(sharedOriginal ? [] : [media.key]),
      ...(sharedVariants ? [] : (parseVariants(media.variants)?.files.map((f) => f.key) ?? [])),
    ];
    return { kind: "deleted" as const, slots, keys };
  });

  if (outcome.kind === "missing") return fail("Cette image n'existe plus.");
  if (outcome.kind === "processing") return fail("Cette image est en cours de traitement : attends qu'elle soit prête pour la supprimer.");
  if (outcome.kind === "blocked") {
    const titles = new Map(db.select({ id: schema.pages.id, title: schema.pages.title }).from(schema.pages).all().map((p) => [p.id, p.title.fr]));
    return {
      ok: false,
      message: `Cette image est utilisée par ${outcome.blocks.length} bloc${outcome.blocks.length > 1 ? "s" : ""} : remplace-la dans ces blocs avant de la supprimer.`,
      references: outcome.blocks.map((b) => ({ pageId: b.pageId, pageTitle: titles.get(b.pageId) ?? `page ${b.pageId}`, blockType: own(BLOCKS, b.type)?.label ?? b.type })),
    };
  }
  const storage = getStorage();
  for (const key of outcome.keys) {
    await storage.delete(key).catch((e) => console.error(`[media] suppression de ${key} impossible`, e));
  }
  return done({ emptiedSlots: outcome.slots.length, projectIds: [...new Set(outcome.slots.map((s) => s.projectId))] });
}
