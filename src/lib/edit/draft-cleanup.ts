/**
 * Ménage au démarrage (src/lib/db/start.ts) : projets créés dans un
 * brouillon de page (éditeur visuel), plus cités par ce brouillon ni par la
 * page publiée, et vieux de plus de 24 h. Module léger (base + refs.ts) :
 * chargé au démarrage du serveur, avant tout rendu.
 */
import { eq } from "drizzle-orm";

import { extractProjectRefs } from "@/blocks/refs";
import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";

const DAY = 24 * 3600_000;

export function cleanupDraftProjects(now = Date.now()): number {
  const db = getDb();
  let removed = 0;
  for (const p of db.select().from(schema.projects).all()) {
    if (p.draftPageId === null || now - p.updatedAt.getTime() < DAY) continue;
    const page = db.select({ draft: schema.pages.draft }).from(schema.pages).where(eq(schema.pages.id, p.draftPageId)).get();
    const draftBlocks = ((page?.draft as { blocks?: unknown } | null)?.blocks ?? []) as { type?: unknown; props?: unknown }[];
    const published = db.select({ type: schema.blocks.type, props: schema.blocks.props }).from(schema.blocks).where(eq(schema.blocks.pageId, p.draftPageId)).all();
    const cited = new Set(
      [...(Array.isArray(draftBlocks) ? draftBlocks : []), ...published.map((b) => ({ type: b.type, props: parseJson(b.props) }))]
        .filter((b) => typeof b?.type === "string")
        .flatMap((b) => extractProjectRefs(b.type as string, b.props)),
    );
    if (cited.has(p.slug)) continue;
    db.delete(schema.projects).where(eq(schema.projects.id, p.id)).run();
    removed++;
  }
  return removed;
}
