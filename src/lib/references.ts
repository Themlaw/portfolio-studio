/**
 * « Utilisé dans… » : références vers un média ou une page, qu'elles passent
 * par une clé étrangère (slots.media_id) ou par les props JSON des blocs
 * (déclarées par type dans src/blocks/refs.ts). L'admin (phase 4) s'en sert
 * pour afficher les usages et bloquer une suppression qui casserait le site.
 * Lecture directe, sans cache : appelée au moment d'une action d'admin.
 * Les brouillons de l'éditeur visuel comptent aussi (blocs d'un brouillon,
 * média d'un emplacement en brouillon) : supprimer ce qu'un brouillon non
 * publié utilise casserait sa publication.
 */
import { mediaUsages, pageReferences, projectReferences, type BlockRow, type Usage } from "@/blocks/refs";

import { getDb, schema } from "./db";
import { parseJson } from "./json";

export type { Usage };

function allBlocks(): BlockRow[] {
  const db = getDb();
  const published = db
    .select({ id: schema.blocks.id, pageId: schema.blocks.pageId, type: schema.blocks.type, props: schema.blocks.props })
    .from(schema.blocks)
    .all()
    .map((b) => ({ ...b, props: parseJson(b.props) }));
  // Blocs des brouillons : identifiants négatifs (aucune ligne en base).
  const drafts = db
    .select({ pageId: schema.pages.id, draft: schema.pages.draft })
    .from(schema.pages)
    .all()
    .flatMap((p) => {
      const blocks = (p.draft as { blocks?: { type?: unknown; props?: unknown }[] } | null)?.blocks;
      return Array.isArray(blocks)
        ? blocks.filter((b) => typeof b?.type === "string").map((b, i) => ({ id: -(p.pageId * 1000 + i + 1), pageId: p.pageId, type: b.type as string, props: b.props }))
        : [];
    });
  return [...published, ...drafts];
}

export function findMediaUsages(mediaId: number): Usage[] {
  const rows = getDb()
    .select({ id: schema.slots.id, projectId: schema.slots.projectId, slug: schema.slots.slug, mediaId: schema.slots.mediaId, draftMediaId: schema.slots.draftMediaId })
    .from(schema.slots)
    .all();
  // Un emplacement compte pour son média publié ET pour celui de son brouillon.
  const slots = rows.flatMap(({ draftMediaId, ...s }) => (draftMediaId !== null && draftMediaId !== s.mediaId ? [s, { ...s, mediaId: draftMediaId }] : [s]));
  return mediaUsages(mediaId, { slots, blocks: allBlocks() });
}

export function findPageReferences(pageId: number): Usage[] {
  return pageReferences(pageId, allBlocks());
}

export function findProjectReferences(slug: string): Usage[] {
  return projectReferences(slug, allBlocks());
}
