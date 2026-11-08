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

import { wallpaperIdsOf } from "@/themes/wallpaper";

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
  // Partage et référencement (lot 52, 83) : icône de l'onglet, image de partage du site, image de partage d'une page (publiée ou
  // brouillon). Sans eux, l'artiste pouvait supprimer « une image inutilisée » et la purge laissait l'icône servie à vie.
  for (const [mediaId, usages] of shareUsages()) index.set(mediaId, [...(index.get(mediaId) ?? []), ...usages]);
  return index;
}

/** Libellés des usages « partage » (affichés comme le type d'une rubrique dans « Utilisée dans… »). */
export const FAVICON_USAGE_TYPE = "Icône de l'onglet";
export const SHARE_USAGE_TYPE = "Image de partage du site";
export const PAGE_SHARE_USAGE_TYPE = "Image de partage de la page";

function shareUsages(): Map<number, Usage[]> {
  const db = getDb();
  const out = new Map<number, Usage[]>();
  const add = (mediaId: unknown, pageId: number | undefined, type: string) => {
    if (typeof mediaId !== "number" || !Number.isInteger(mediaId) || pageId === undefined) return;
    const list = out.get(mediaId) ?? [];
    if (!list.some((u) => u.kind === "block" && u.pageId === pageId && u.type === type)) out.set(mediaId, [...list, { kind: "block", blockId: -1, pageId, type, path: "media" }]);
  };
  // Réglages du site : rattachés à l'accueil, comme le logo.
  const home = db.select({ id: schema.pages.id }).from(schema.pages).orderBy(schema.pages.id).get()?.id;
  const seo = parseJson(db.select().from(schema.settings).where(inArray(schema.settings.key, ["seo"])).get()?.value) as { favicon?: { mediaId?: unknown } | null; shareImage?: unknown } | null;
  add(seo?.favicon?.mediaId, home, FAVICON_USAGE_TYPE);
  add(seo?.shareImage, home, SHARE_USAGE_TYPE);
  // Image de partage d'une page : publiée (`pages.meta.image`) et brouillon (`draft.meta.image`), pages à la corbeille comprises.
  for (const p of db.select({ id: schema.pages.id, meta: schema.pages.meta, draft: schema.pages.draft }).from(schema.pages).all()) {
    add((p.meta as { image?: unknown } | null)?.image, p.id, PAGE_SHARE_USAGE_TYPE);
    add((p.draft as { meta?: { image?: unknown } } | null)?.meta?.image, p.id, PAGE_SHARE_USAGE_TYPE);
  }
  return out;
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
    // Brouillon du site commun à toutes les pages (lot 96) : l'usage est rattaché à l'accueil dans les deux cas.
    const pageId = home;
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

/* ---- Papiers peints (lot 35) ---------------------------------------------------------------------------------- */

/** Où un motif sert : fond ou papier de carte d'un composant (publié ou brouillon), papier d'une page, papier des cartes du site. */
export type WallpaperUse = { kind: "block"; pageId: number; type: string } | { kind: "page"; pageId: number } | { kind: "cards" };

/**
 * UNE seule source pour « où chaque motif est utilisé » (écran Papiers peints, avertissement avant suppression, tests). Même règle
 * que les médias : un composant compte une fois par page et par type, publié ou en brouillon. Les pages à la corbeille comptent
 * (restaurées, elles retrouvent leur motif) mais sont signalées par l'écran.
 */
export function wallpaperUsages(): Map<number, WallpaperUse[]> {
  const out = new Map<number, WallpaperUse[]>();
  const seen = new Set<string>();
  const push = (id: number, use: WallpaperUse) => {
    const key = `${id}:${use.kind}:${"pageId" in use ? use.pageId : ""}:${"type" in use ? use.type : ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.set(id, [...(out.get(id) ?? []), use]);
  };
  for (const b of allBlocks()) for (const id of wallpaperIdsOf({ type: b.type, props: b.props })) push(id, { kind: "block", pageId: b.pageId, type: b.type });
  const db = getDb();
  for (const p of db.select({ id: schema.pages.id, overrides: schema.pages.themeOverrides, draft: schema.pages.draft }).from(schema.pages).all()) {
    const published = (p.overrides as { wallpaper?: { wallpaper?: unknown } } | null)?.wallpaper?.wallpaper;
    const drafted = (p.draft as { wallpaper?: { wallpaper?: unknown } | null } | null)?.wallpaper?.wallpaper;
    for (const id of [published, drafted]) if (Number.isInteger(id)) push(id as number, { kind: "page", pageId: p.id });
  }
  const card = parseJson(db.select().from(schema.settings).where(inArray(schema.settings.key, ["cardWallpaper"])).get()?.value) as { wallpaper?: unknown } | null;
  if (Number.isInteger(card?.wallpaper)) push(card!.wallpaper as number, { kind: "cards" });
  return out;
}

export function findWallpaperUsages(id: number): WallpaperUse[] {
  return wallpaperUsages().get(id) ?? [];
}
