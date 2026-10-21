/**
 * Avertissements NON bloquants à la publication d'une page (lot 52) : images sans description (texte alternatif) et
 * textes sans traduction anglaise. Calculés sur la page telle qu'elle vient d'être publiée ; jamais un refus.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";

import { layoutMediaIds, readLayout } from "@/blocks/board-layout";
import { extractRefs } from "@/blocks/refs";
import { getPageForEdit } from "@/lib/admin";
import { getDb, schema } from "@/lib/db";
import { untranslatedCount } from "@/lib/translation-gaps";

import { displayedProjects, parsedTree } from "./drafts";

export type PublishWarnings = {
  /** Images de la page sans description : de quoi les lister et mener à la médiathèque. */
  missingAlt: { id: number; name: string }[];
  /** Nombre de textes sans traduction anglaise (titre compris). */
  untranslated: number;
};

const MAX_LISTED = 40;

/** Médias qu'une page affiche : ses composants, les planches de ses projets (emplacements et contenu de planche). */
function pageMediaIds(blocks: { type: string; props: unknown }[]): number[] {
  const db = getDb();
  const ids = new Set<number>();
  const tree = parsedTree(blocks);
  const walk = (list: { type: string; props: Record<string, unknown> }[]) => {
    for (const b of list) {
      for (const id of extractRefs(b.type, { ...b.props, children: undefined }).media) ids.add(id);
      if (Array.isArray(b.props.children)) walk(b.props.children as { type: string; props: Record<string, unknown> }[]);
    }
  };
  walk(tree);
  const projects = displayedProjects(blocks);
  if (projects.length) {
    for (const s of db.select({ mediaId: schema.slots.mediaId }).from(schema.slots).where(inArray(schema.slots.projectId, projects)).all()) if (s.mediaId) ids.add(s.mediaId);
    for (const p of db.select({ layout: schema.projects.layout }).from(schema.projects).where(inArray(schema.projects.id, projects)).all()) {
      if (p.layout) for (const id of layoutMediaIds(readLayout(p.layout))) ids.add(id);
    }
  }
  return [...ids];
}

export function publishWarnings(pageId: number): PublishWarnings {
  const page = getPageForEdit(pageId);
  if (!page) return { missingAlt: [], untranslated: 0 };
  const ids = pageMediaIds(page.blocks);
  const rows = ids.length
    ? getDb()
        .select({ id: schema.media.id, name: schema.media.originalName, key: schema.media.key, alt: schema.media.alt })
        .from(schema.media)
        .where(and(inArray(schema.media.id, ids), eq(schema.media.kind, "image"), eq(schema.media.status, "ready"), isNull(schema.media.deletedAt)))
        .all()
    : [];
  const missing = rows.filter((m) => !m.alt?.fr?.trim()).sort((a, b) => a.id - b.id);
  return {
    missingAlt: missing.slice(0, MAX_LISTED).map((m) => ({ id: m.id, name: m.name ?? m.key })),
    untranslated: untranslatedCount(page.title, page.blocks),
  };
}
