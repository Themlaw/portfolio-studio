/**
 * « Utilisé dans… » : références vers un média ou une page, qu'elles passent
 * par une clé étrangère (slots.media_id) ou par les props JSON des blocs
 * (déclarées par type dans src/blocks/refs.ts). L'admin (phase 4) s'en sert
 * pour afficher les usages et bloquer une suppression qui casserait le site.
 * Lecture directe, sans cache : appelée au moment d'une action d'admin.
 */
import { mediaUsages, pageReferences, projectReferences, type BlockRow, type Usage } from "@/blocks/refs";

import { getDb, schema } from "./db";
import { parseJson } from "./json";

export type { Usage };

function allBlocks(): BlockRow[] {
  return getDb()
    .select({ id: schema.blocks.id, pageId: schema.blocks.pageId, type: schema.blocks.type, props: schema.blocks.props })
    .from(schema.blocks)
    .all()
    .map((b) => ({ ...b, props: parseJson(b.props) }));
}

export function findMediaUsages(mediaId: number): Usage[] {
  const slots = getDb()
    .select({ id: schema.slots.id, projectId: schema.slots.projectId, slug: schema.slots.slug, mediaId: schema.slots.mediaId })
    .from(schema.slots)
    .all();
  return mediaUsages(mediaId, { slots, blocks: allBlocks() });
}

export function findPageReferences(pageId: number): Usage[] {
  return pageReferences(pageId, allBlocks());
}

export function findProjectReferences(slug: string): Usage[] {
  return projectReferences(slug, allBlocks());
}
