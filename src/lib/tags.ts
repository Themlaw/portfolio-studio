/**
 * Tags de la bibliothèque (admin) : liste avec usages, création à la volée
 * (par clé normalisée), association aux médias, renommage, fusion, suppression.
 * Bornes : libellé de 1 à 40 caractères, 20 tags par média, 500 tags en tout.
 */
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { cleanTagLabel, MAX_TAGS, MAX_TAGS_PER_MEDIA, tagKey, tagLabelProblem } from "@/lib/tag-key";

import { done, fail, type ActionResult } from "./edit/result";

export type TagRow = { id: number; label: string; key: string; count: number };
export type MediaTag = { id: number; label: string };

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export class TagError extends Error {}

/**
 * Tags qui comptent dans le plafond de 500 : ceux posés sur au moins un média.
 * Un tag inutilisé ne bloque pas (il reste, voulu ou non ; « Supprimer les tags
 * inutilisés » les retire à la demande).
 */
function usedTagCount(tx: Pick<Tx, "select">): number {
  return tx.select({ n: sql<number>`count(distinct ${schema.mediaTags.tagId})` }).from(schema.mediaTags).get()?.n ?? 0;
}

/** Libellés reçus (non fiables) → libellés nettoyés, dédoublonnés par clé. */
export const TagLabels = z
  .array(z.string().max(200))
  .max(MAX_TAGS_PER_MEDIA * 2)
  .transform((list, ctx) => {
    const seen = new Map<string, string>();
    for (const raw of list) {
      const problem = tagLabelProblem(raw);
      if (problem) {
        ctx.addIssue({ code: "custom", message: problem });
        return z.NEVER;
      }
      const label = cleanTagLabel(raw);
      if (!seen.has(tagKey(label))) seen.set(tagKey(label), label);
    }
    if (seen.size > MAX_TAGS_PER_MEDIA) {
      ctx.addIssue({ code: "custom", message: `${MAX_TAGS_PER_MEDIA} tags au plus par fichier.` });
      return z.NEVER;
    }
    return [...seen.values()];
  });

/** Libellés validés, ou le message à afficher. */
export function parseTagLabels(input: unknown): { ok: true; labels: string[] } | { ok: false; message: string } {
  const parsed = TagLabels.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.code === "custom" ? issue.message : "Tags invalides." };
  }
  return { ok: true, labels: parsed.data };
}

export function listTags(): TagRow[] {
  const db = getDb();
  const uses = new Map(
    db
      .select({ tagId: schema.mediaTags.tagId, n: count() })
      .from(schema.mediaTags)
      .groupBy(schema.mediaTags.tagId)
      .all()
      .map((r) => [r.tagId, r.n]),
  );
  return db
    .select()
    .from(schema.tags)
    .orderBy(asc(schema.tags.key))
    .all()
    .map((t) => ({ id: t.id, label: t.label, key: t.key, count: uses.get(t.id) ?? 0 }));
}

/** Tags de chaque média (libellé), pour la liste de la médiathèque. */
export function tagsByMedia(): Map<number, MediaTag[]> {
  const rows = getDb()
    .select({ mediaId: schema.mediaTags.mediaId, id: schema.tags.id, label: schema.tags.label, key: schema.tags.key })
    .from(schema.mediaTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.mediaTags.tagId))
    .orderBy(asc(schema.tags.key))
    .all();
  const out = new Map<number, MediaTag[]>();
  for (const r of rows) {
    const list = out.get(r.mediaId) ?? [];
    list.push({ id: r.id, label: r.label });
    out.set(r.mediaId, list);
  }
  return out;
}

/** Identifiants des tags (créés si besoin) ; refus au-delà de 500 tags. */
export function ensureTags(tx: Tx, labels: string[]): number[] {
  if (!labels.length) return [];
  const keys = labels.map(tagKey);
  const existing = new Map(
    tx
      .select({ id: schema.tags.id, key: schema.tags.key })
      .from(schema.tags)
      .where(inArray(schema.tags.key, keys))
      .all()
      .map((t) => [t.key, t.id]),
  );
  const missing = labels.filter((l) => !existing.has(tagKey(l)));
  if (missing.length) {
    const total = usedTagCount(tx);
    if (total + missing.length > MAX_TAGS) {
      throw new TagError(`La bibliothèque compte déjà ${total} tags (${MAX_TAGS} au plus) : réutilise ou fusionne des tags existants.`);
    }
    for (const label of missing) {
      const row = tx.insert(schema.tags).values({ label, key: tagKey(label) }).returning({ id: schema.tags.id }).get();
      existing.set(tagKey(label), row.id);
    }
  }
  return keys.map((k) => existing.get(k)!);
}

/** Message si créer ces tags dépasserait 500 tags en tout, sinon null. */
export function tagCapacityProblem(labels: string[]): string | null {
  if (!labels.length) return null;
  const db = getDb();
  const known = db.select({ n: count() }).from(schema.tags).where(inArray(schema.tags.key, labels.map(tagKey))).get()?.n ?? 0;
  const total = usedTagCount(db);
  const missing = labels.length - known;
  return total + missing > MAX_TAGS ? `La bibliothèque compte déjà ${total} tags (${MAX_TAGS} au plus) : réutilise ou fusionne des tags existants.` : null;
}

/**
 * Tags demandés à l'envoi, attachés au média créé (ou retrouvé par son
 * contenu : les nouveaux tags s'ajoutent aux siens). Un refus (bornes) ne
 * fait pas échouer l'envoi : le message revient avec le média.
 */
export function attachUploadTags(mediaId: number, labels: string[]): string | null {
  try {
    attachTags([mediaId], labels);
    return null;
  } catch (error) {
    if (error instanceof TagError) return error.message;
    throw error;
  }
}

/** Ajoute des tags à des médias (les tags déjà présents sont ignorés). */
export function attachTags(mediaIds: number[], labels: string[]): void {
  if (!mediaIds.length || !labels.length) return;
  const db = getDb();
  db.transaction((tx) => {
    const tagIds = ensureTags(tx, labels);
    for (const mediaId of mediaIds) {
      const current = new Set(
        tx
          .select({ tagId: schema.mediaTags.tagId })
          .from(schema.mediaTags)
          .where(eq(schema.mediaTags.mediaId, mediaId))
          .all()
          .map((r) => r.tagId),
      );
      const added = tagIds.filter((id) => !current.has(id));
      if (current.size + added.length > MAX_TAGS_PER_MEDIA) {
        throw new TagError(`${MAX_TAGS_PER_MEDIA} tags au plus par fichier.`);
      }
      for (const tagId of added) tx.insert(schema.mediaTags).values({ mediaId, tagId }).onConflictDoNothing().run();
    }
  });
}

const run = (fn: () => void): ActionResult<null> => {
  try {
    fn();
    return done(null);
  } catch (error) {
    if (error instanceof TagError) return fail(error.message);
    throw error;
  }
};

function existingMedia(ids: number[]): boolean {
  const found = getDb().select({ id: schema.media.id }).from(schema.media).where(inArray(schema.media.id, ids)).all();
  return found.length === new Set(ids).size;
}

export function addTagsToMedia(mediaIds: number[], input: unknown): ActionResult<null> {
  const parsed = parseTagLabels(input);
  if (!parsed.ok) return fail(parsed.message);
  if (!existingMedia(mediaIds)) return fail("Un média n'existe plus : recharge la page.");
  return run(() => attachTags(mediaIds, parsed.labels));
}

/** Retire des tags (désignés par libellé : comparés par clé) de médias. */
export function removeTagsFromMedia(mediaIds: number[], input: unknown): ActionResult<null> {
  const parsed = parseTagLabels(input);
  if (!parsed.ok) return fail(parsed.message);
  if (!existingMedia(mediaIds)) return fail("Un média n'existe plus : recharge la page.");
  if (!parsed.labels.length) return done(null);
  const db = getDb();
  const tagIds = db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(inArray(schema.tags.key, parsed.labels.map(tagKey)))
    .all()
    .map((t) => t.id);
  if (tagIds.length) {
    db.delete(schema.mediaTags)
      .where(and(inArray(schema.mediaTags.mediaId, mediaIds), inArray(schema.mediaTags.tagId, tagIds)))
      .run();
  }
  return done(null);
}

/** Remplace les tags d'un média (panneau de détail). */
export function setMediaTags(mediaId: number, input: unknown): ActionResult<null> {
  const parsed = parseTagLabels(input);
  if (!parsed.ok) return fail(parsed.message);
  if (!existingMedia([mediaId])) return fail("Ce média n'existe plus.");
  return run(() =>
    getDb().transaction((tx) => {
      const tagIds = ensureTags(tx, parsed.labels);
      tx.delete(schema.mediaTags).where(eq(schema.mediaTags.mediaId, mediaId)).run();
      for (const tagId of tagIds) tx.insert(schema.mediaTags).values({ mediaId, tagId }).onConflictDoNothing().run();
    }),
  );
}

function tagRow(id: number) {
  return getDb().select().from(schema.tags).where(eq(schema.tags.id, id)).get();
}

export function renameTag(id: number, input: unknown): ActionResult<null> {
  const tag = tagRow(id);
  if (!tag) return fail("Ce tag n'existe plus.");
  if (typeof input !== "string") return fail("Libellé invalide.");
  const problem = tagLabelProblem(input);
  if (problem) return fail(problem);
  const label = cleanTagLabel(input);
  const key = tagKey(label);
  const clash = getDb().select().from(schema.tags).where(eq(schema.tags.key, key)).get();
  if (clash && clash.id !== id) return fail(`Le tag « ${clash.label} » existe déjà : fusionne les deux plutôt.`);
  getDb().update(schema.tags).set({ label, key }).where(eq(schema.tags.id, id)).run();
  return done(null);
}

/** Fusionne `fromId` dans `intoId` : les médias de A reçoivent B, puis A disparaît. */
export function mergeTags(fromId: number, intoId: number): ActionResult<{ moved: number }> {
  if (fromId === intoId) return fail("Choisis deux tags différents.");
  const from = tagRow(fromId);
  const into = tagRow(intoId);
  if (!from || !into) return fail("Un des tags n'existe plus : recharge la page.");
  const moved = getDb().transaction((tx) => {
    const media = tx.select({ mediaId: schema.mediaTags.mediaId }).from(schema.mediaTags).where(eq(schema.mediaTags.tagId, fromId)).all();
    for (const m of media) tx.insert(schema.mediaTags).values({ mediaId: m.mediaId, tagId: intoId }).onConflictDoNothing().run();
    tx.delete(schema.tags).where(eq(schema.tags.id, fromId)).run();
    return media.length;
  });
  return done({ moved });
}

/** Supprime les tags posés sur aucun média (à la demande, jamais automatiquement). */
export function deleteUnusedTags(): ActionResult<{ deleted: number }> {
  const result = getDb()
    .delete(schema.tags)
    .where(sql`${schema.tags.id} not in (select ${schema.mediaTags.tagId} from ${schema.mediaTags})`)
    .run();
  return done({ deleted: result.changes });
}

export function deleteTag(id: number): ActionResult<{ media: number }> {
  const tag = tagRow(id);
  if (!tag) return fail("Ce tag n'existe plus.");
  const db = getDb();
  const media = db.select({ n: count() }).from(schema.mediaTags).where(eq(schema.mediaTags.tagId, id)).get()?.n ?? 0;
  db.delete(schema.tags).where(eq(schema.tags.id, id)).run();
  return done({ media });
}
