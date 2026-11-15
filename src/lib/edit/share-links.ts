/**
 * Liens partageables (admin) : CRUD et validation.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { done, fail, zodFieldErrors, type ActionResult } from "./result";

export type ShareLinkRow = {
  id: number;
  slug: string;
  title: { fr: string; en: string } | null;
  mediaId: number;
  allowDownload: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

const slugRegex = /^[a-z0-9-]{1,60}$/;

const localizedTitle = z
  .object({ fr: z.string().trim().max(80), en: z.string().trim().max(80) })
  .transform((t) => (t.fr === "" && t.en === "" ? null : { fr: t.fr, en: t.en }))
  .nullable()
  .optional();

export const ShareLinkSchema = z.object({
  slug: z.string().trim().regex(slugRegex, "Slug invalide."),
  title: localizedTitle,
  mediaId: z.number().int().positive(),
  allowDownload: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

function toRow(r: typeof schema.shareLinks.$inferSelect): ShareLinkRow {
  return {
    id: r.id,
    slug: r.slug,
    title: (r.title as { fr: string; en: string } | null) ?? null,
    mediaId: r.mediaId,
    allowDownload: r.allowDownload,
    enabled: r.enabled,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

export function listShareLinks(): ShareLinkRow[] {
  return getDb().select().from(schema.shareLinks).orderBy(schema.shareLinks.slug).all().map(toRow);
}

export function getShareLink(id: number): ShareLinkRow | null {
  const r = getDb().select().from(schema.shareLinks).where(eq(schema.shareLinks.id, id)).get();
  return r ? toRow(r) : null;
}

export function getShareLinkBySlug(slug: string): ShareLinkRow | null {
  const r = getDb().select().from(schema.shareLinks).where(eq(schema.shareLinks.slug, slug)).get();
  return r ? toRow(r) : null;
}

function validateMedia(mediaId: number, errors: Record<string, string>) {
  const row = getDb().select().from(schema.media).where(eq(schema.media.id, mediaId)).get();
  if (!row || row.deletedAt || !["image", "video", "pdf"].includes(row.kind)) {
    errors.mediaId = "Ce média n'existe pas ou n'est pas utilisable.";
  }
}

function validateSlug(slug: string, exceptId: number | null, errors: Record<string, string>) {
  const others = getDb().select({ id: schema.shareLinks.id }).from(schema.shareLinks).all();
  // uniqueness
  const taken = getDb().select({ id: schema.shareLinks.id }).from(schema.shareLinks).where(eq(schema.shareLinks.slug, slug)).get();
  if (taken && taken.id !== exceptId) {
    errors.slug = "Ce nom court est déjà pris.";
  }
  void others;
}

export function createShareLink(input: unknown): ActionResult<{ id: number }> {
  const parsed = ShareLinkSchema.safeParse(input);
  if (!parsed.success) return fail("Corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  const data = parsed.data;
  const errors: Record<string, string> = {};
  validateMedia(data.mediaId, errors);
  validateSlug(data.slug, null, errors);
  if (Object.keys(errors).length) return fail("Ce lien ne convient pas : corrige-le.", errors);
  const row = getDb()
    .insert(schema.shareLinks)
    .values({
      slug: data.slug,
      title: data.title ?? null,
      mediaId: data.mediaId,
      allowDownload: data.allowDownload,
      enabled: data.enabled,
    })
    .returning({ id: schema.shareLinks.id })
    .get();
  return done({ id: row.id });
}

export function updateShareLink(id: number, input: unknown): ActionResult<null> {
  const db = getDb();
  const existing = db.select().from(schema.shareLinks).where(eq(schema.shareLinks.id, id)).get();
  if (!existing) return fail("Ce lien n'existe plus. Recharge la liste.");
  const parsed = ShareLinkSchema.safeParse(input);
  if (!parsed.success) return fail("Corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  const data = parsed.data;
  const errors: Record<string, string> = {};
  validateMedia(data.mediaId, errors);
  validateSlug(data.slug, id, errors);
  if (Object.keys(errors).length) return fail("Ce lien ne convient pas : corrige-le.", errors);
  db.update(schema.shareLinks)
    .set({
      slug: data.slug,
      title: data.title ?? null,
      mediaId: data.mediaId,
      allowDownload: data.allowDownload,
      enabled: data.enabled,
      updatedAt: new Date(),
    })
    .where(eq(schema.shareLinks.id, id))
    .run();
  return done(null);
}

export function deleteShareLink(id: number): ActionResult<null> {
  const db = getDb();
  const existing = db.select().from(schema.shareLinks).where(eq(schema.shareLinks.id, id)).get();
  if (!existing) return fail("Ce lien n'existe plus. Recharge la liste.");
  db.delete(schema.shareLinks).where(eq(schema.shareLinks.id, id)).run();
  return done(null);
}

/** Lecture publique (pas de cache) : null si absent. */
export function readShareLink(slug: string): ShareLinkRow | null {
  return getShareLinkBySlug(slug);
}