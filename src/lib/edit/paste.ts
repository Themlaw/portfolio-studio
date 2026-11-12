/**
 * Collage de blocs et de style (lot 133), côté serveur : le presse-papiers du navigateur n'est jamais cru, tout repasse par le registre
 * (src/lib/edit/clipboard.ts) et par l'existence des médias, pages et projets en base. Ne modifie rien : renvoie les blocs prêts à insérer
 * (nouveaux uid) que l'éditeur pose dans son brouillon par son historique (annuler / rétablir) ; l'enregistrement, lui, revalide tout (savePage).
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { isSpecialPage } from "@/lib/special-pages";

import { readClip, type ClipBlock } from "./clip";
import { adaptStyle, sanitizeBlocks, type Existence } from "./clipboard";
import { done, fail, type ActionResult } from "./result";

const Where = z.object({
  /** Conteneur visé (null = la page) : son type, et les niveaux de conteneurs jusqu'à lui compris. */
  parentType: z.string().max(60).nullable(),
  depth: z.number().int().min(0).max(4),
  /** Blocs déjà dans la liste visée. */
  count: z.number().int().min(0).max(400),
  /** Types des blocs de toute la page (types uniques). */
  pageTypes: z.array(z.string().max(60)).max(400),
});

function existence(pageId: number): Existence {
  const db = getDb();
  return {
    media: (id) => {
      const row = db.select({ d: schema.media.deletedAt }).from(schema.media).where(eq(schema.media.id, id)).get();
      return Boolean(row) && !row?.d;
    },
    page: (id) => {
      const row = db.select({ d: schema.pages.deletedAt }).from(schema.pages).where(eq(schema.pages.id, id)).get();
      return Boolean(row) && !row?.d;
    },
    project: (slug) => {
      const row = db.select({ page: schema.projects.draftPageId, deletedAt: schema.projects.deletedAt }).from(schema.projects).where(eq(schema.projects.slug, slug)).get();
      if (!row || row.deletedAt) return "missing";
      return row.page === null || row.page === pageId ? "ok" : "elsewhere";
    },
  };
}

let seq = 0;
const serverUid = () => `p${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 32);

/** Blocs collés sur la page `pageId`, revalidés : nouveaux uid, références vérifiées. */
export function pasteBlocks(pageId: number, clip: unknown, where: unknown): ActionResult<{ blocks: ClipBlock[] }> {
  const page = getDb().select().from(schema.pages).where(eq(schema.pages.id, pageId)).get();
  if (!page || page.deletedAt) return fail("Cette page n'existe plus. Recharge la liste des pages.");
  const parsed = readClip(clip);
  if (!parsed || parsed.kind !== "blocks") return fail("Le presse-papiers ne contient pas de bloc à coller.");
  const w = Where.safeParse(where);
  if (!w.success) return fail("Emplacement du collage illisible.");
  const res = sanitizeBlocks(parsed.blocks, {
    parentType: w.data.parentType,
    depth: w.data.depth,
    count: w.data.count,
    pageBlocks: w.data.pageTypes.map((type) => ({ type })),
    special: isSpecialPage(page),
    exists: existence(pageId),
    newUid: serverUid,
  });
  return res.ok ? done({ blocks: res.blocks }) : fail(res.message);
}

const Target = z.object({ type: z.string().max(60), top: z.boolean() });

/** Style collé sur un bloc de type `target.type` : ce que ses schémas acceptent, rien d'autre. */
export function pasteStyle(clip: unknown, target: unknown): ActionResult<{ style: Record<string, unknown> }> {
  const parsed = readClip(clip);
  if (!parsed || parsed.kind !== "style") return fail("Le presse-papiers ne contient pas de style à coller.");
  const t = Target.safeParse(target);
  if (!t.success) return fail("Bloc visé illisible.");
  return done({ style: adaptStyle(parsed.style, t.data) });
}
