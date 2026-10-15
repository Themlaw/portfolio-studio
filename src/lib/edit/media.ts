/**
 * Écritures des médias (admin) : texte alternatif, corbeille. Un média utilisé (bloc, planche, brouillon)
 * ne se supprime pas ; supprimé, il reste 30 jours à la corbeille, puis original et variantes sont
 * supprimés du stockage (job de purge).
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getMediaUses } from "@/lib/admin";
import { getDb, schema } from "@/lib/db";
import { purgeCrops } from "@/lib/images/crop-cache";
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

/** Endroits où un média sert (blocs de pages, emplacements de planches), pour le refus de le supprimer. */
export type MediaUseRef = { kind: "block"; pageId: number; pageTitle: string; blockType: string } | { kind: "slot"; projectId: number; projectTitle: string; slotTitle: string; draftPage?: string };

/**
 * Supprimer un média = le mettre à la corbeille (lot 23), restaurable 30 jours puis purgé par un job
 * (`purgeMedia`). Un média UTILISÉ (bloc, planche, brouillon) ne se supprime pas : l'écran le montre avant
 * (bouton désactivé, liste des endroits), ce refus n'est que le garde-fou serveur. Vérification des usages
 * et mise à la corbeille dans la MÊME transaction : un bloc ajouté entre-temps ne peut pas pointer vers
 * un média supprimé.
 */
export async function deleteMedia(id: number): Promise<ActionResult<{ name: string }> | { ok: false; message: string; references: MediaUseRef[] }> {
  const db = getDb();
  const outcome = db.transaction((tx) => {
    const media = tx.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!media || media.deletedAt) return { kind: "missing" as const };
    if (media.status === "processing") return { kind: "processing" as const };
    const usages = getMediaUses(id);
    if (usages.length) return { kind: "blocked" as const, usages };
    tx.update(schema.media).set({ deletedAt: new Date() }).where(eq(schema.media.id, id)).run();
    return { kind: "trashed" as const, name: media.originalName ?? media.key };
  });
  if (outcome.kind === "missing") return fail("Cette image n'existe plus.");
  if (outcome.kind === "processing") return fail("Cette image est en cours de traitement : attends qu'elle soit prête pour la supprimer.");
  if (outcome.kind === "blocked") {
    return {
      ok: false,
      message: `Ce média est utilisé à ${outcome.usages.length} endroit${outcome.usages.length > 1 ? "s" : ""} : remplace-le ou retire-le de ces endroits avant de le supprimer.`,
      references: outcome.usages.map((u) =>
        u.kind === "block"
          ? { kind: "block" as const, pageId: u.pageId, pageTitle: u.pageTitle, blockType: u.blockType }
          : { kind: "slot" as const, projectId: u.projectId, projectTitle: u.projectTitle, slotTitle: u.slotTitle, ...(u.draftPage ? { draftPage: u.draftPage } : {}) },
      ),
    };
  }
  // Recadrages gardés sur disque : un cache, refait à la demande si le média revient (Restaurer).
  await purgeCrops(id);
  return done({ name: outcome.name });
}

/** Restaure un média de la corbeille. */
export function restoreMedia(id: number): ActionResult<{ name: string }> {
  const db = getDb();
  const media = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
  if (!media || !media.deletedAt) return fail("Ce média n'est pas dans la corbeille.");
  db.update(schema.media).set({ deletedAt: null }).where(eq(schema.media.id, id)).run();
  return done({ name: media.originalName ?? media.key });
}
