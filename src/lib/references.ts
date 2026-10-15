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
import { inArray } from "drizzle-orm";

import { layoutMediaIds, readLayout } from "@/blocks/board-layout";
import { mediaUsageIndex, pageReferences, projectReferences, type BlockRow, type Usage } from "@/blocks/refs";

import { getDb, schema } from "./db";
import { parseJson } from "./json";

export type { Usage };

/** Tous les blocs (publiés et brouillons de pages) : la matière de toutes les règles de référence. */
export function allBlocks(): BlockRow[] {
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
        ? blocks.filter((b) => typeof b?.type === "string").map((b, i) => ({ id: -(p.pageId * 1000 + i + 1), pageId: p.pageId, type: b.type as string, props: b.props, draft: true }))
        : [];
    });
  return [...published, ...drafts];
}

/** Index « média → ses utilisations » : la source unique du compteur, du détail et du blocage (lot 23). */
export function mediaUsagesByMedia(): Map<number, Usage[]> {
  const rows = getDb()
    .select({ id: schema.slots.id, projectId: schema.slots.projectId, slug: schema.slots.slug, mediaId: schema.slots.mediaId, draftMediaId: schema.slots.draftMediaId, draftPageId: schema.slots.draftPageId, draftState: schema.slots.draftState })
    .from(schema.slots)
    .all();
  // Un emplacement compte pour son média publié ET pour celui de son brouillon (la page qui le porte est nommée).
  const slots = rows.flatMap(({ draftMediaId, draftPageId, draftState, ...s }) => {
    // « added » : emplacement créé dans un brouillon, son média n'existe que par ce brouillon.
    const published = draftState === "added" && draftPageId ? { ...s, draftPageId } : s;
    return draftMediaId !== null && draftMediaId !== s.mediaId ? [published, { ...s, mediaId: draftMediaId, draftPageId }] : [published];
  });
  // Contenu des planches (lot 31) : images et vidéos des grilles, images et vidéos de la suite d'un projet, publiée ou en brouillon.
  const layouts = getDb()
    .select({ projectId: schema.projects.id, slug: schema.projects.slug, layout: schema.projects.layout, draft: schema.projects.draftLayout, page: schema.projects.draftLayoutPageId })
    .from(schema.projects)
    .all()
    .map((p) => ({
      projectId: p.projectId,
      slug: p.slug,
      published: layoutMediaIds(readLayout(p.layout)),
      draft: p.draft ? layoutMediaIds(readLayout(p.draft)) : [],
      draftPageId: p.page,
    }));
  const index = mediaUsageIndex({ slots, blocks: allBlocks(), layouts });
  // Logo du site (lot 26) : une image de la médiathèque hors de toute rubrique. Elle compte comme un usage, sur la page
  // d'accueil (logo publié) ou sur la page qui tient le brouillon du site : sans cela, la corbeille et le compteur
  // de la médiathèque la diraient libre.
  for (const [mediaId, usage] of logoUsages()) index.set(mediaId, [...(index.get(mediaId) ?? []), usage]);
  return index;
}

/** Libellé de l'usage « logo » (affiché comme le type d'une rubrique dans « Utilisée dans… »). */
export const LOGO_USAGE_TYPE = "Logo du site";

function logoUsages(): Map<number, Usage> {
  const db = getDb();
  const out = new Map<number, Usage>();
  const home = db.select({ id: schema.pages.id }).from(schema.pages).orderBy(schema.pages.id).get()?.id;
  for (const r of db.select().from(schema.settings).where(inArray(schema.settings.key, ["styles", "siteDraft"])).all()) {
    const v = parseJson(r.value) as { logo?: { mediaId?: unknown }; pageId?: unknown; snap?: { styles?: { logo?: { mediaId?: unknown } } } } | null;
    const mediaId = r.key === "styles" ? v?.logo?.mediaId : v?.snap?.styles?.logo?.mediaId;
    const pageId = r.key === "styles" ? home : typeof v?.pageId === "number" ? v.pageId : home;
    if (typeof mediaId === "number" && pageId !== undefined && !out.has(mediaId)) {
      out.set(mediaId, { kind: "block", blockId: -1, pageId, type: LOGO_USAGE_TYPE, path: "media" });
    }
  }
  return out;
}

export function findMediaUsages(mediaId: number): Usage[] {
  return mediaUsagesByMedia().get(mediaId) ?? [];
}

export function findPageReferences(pageId: number): Usage[] {
  return pageReferences(pageId, allBlocks());
}

export function findProjectReferences(slug: string): Usage[] {
  return projectReferences(slug, allBlocks());
}
