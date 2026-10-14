import { getTranslations } from "next-intl/server";
import { z } from "zod";

import CollectionTiles, { type Tile } from "@/components/CollectionTiles";
import Eyebrow from "@/components/Eyebrow";
import { countCollection, getCollectionCover } from "@/lib/gallery";
import { RATIO_VALUES } from "@/lib/images/formats";
import { cropSources } from "@/lib/images/crop";
import { parseRatio, scaleSizes } from "@/lib/images/sizes";
import { signCrop } from "@/lib/images/crop-cache";
import { cropVars } from "@/lib/look";
import { mediaUrl } from "@/lib/media";
import { getNav, getPageBlocks, getPageIndex, hrefForPage } from "@/lib/pages";
import { getSiteView } from "@/lib/settings";

import { autoEntries, manualEntries, MAX_TILES, orderCollectionPages, tilesMode, TILE_GEOMETRY, tileSize, type CollectionPage, type TileItem } from "./collection-pages";
import { collection, inline, localized, pageRef, tr, type BlockContext, localizedText } from "./types";

const itemSchema = z.object({ collection, pageId: pageRef, eyebrow: localized, title: localized, intro: localizedText });

export const collectionTilesSchema = z.object({
  eyebrow: localized,
  title: localized,
  /**
   * Entrées (lot 22) : « auto » = une tuile par page de collection (ordre du menu), textes de l'en-tête de la
   * page sauf ceux modifiés sur la tuile (`edits`) ; « manual » = la liste `items` de l'artiste. Absent = manuel
   * (bloc d'avant la v0.19, migration 0022 : le passage en automatique n'est écrit que si la liste y correspond).
   */
  mode: z.enum(["auto", "manual"]).optional(),
  /** Taille des images : colonne image et plafond de hauteur (lot 22). Absent = moyenne. */
  size: z.enum(["small", "medium", "large"]).optional(),
  /** Format imposé des images (elles sont alors cadrées : « Cadrer » sur la toile). Auto : leur format. */
  ratio: z.enum(RATIO_VALUES).optional(),
  /** Mode manuel : la liste des entrées. */
  items: z.array(itemSchema).max(MAX_TILES).optional(),
  /** Mode automatique : textes modifiés sur la tuile, attachés à la page (clé : identifiant de page). */
  edits: z
    .array(z.object({ pageId: pageRef, eyebrow: localized.optional(), title: localized.optional(), intro: localizedText.optional() }))
    .max(MAX_TILES * 2)
    .optional(),
});

/** Pages de collection publiées, dans l'ordre du menu (lues dans le cache : l'accueil hérite de leurs étiquettes). */
async function findCollectionPages(ctx: BlockContext): Promise<{ found: CollectionPage[]; published: Set<number> }> {
  const [index, view] = await Promise.all([getPageIndex(), getSiteView(ctx.locale, ctx.pageId)]);
  const menu = (await getNav(ctx.locale, view.nav)).flatMap((n) => (n.pageId !== undefined ? [n.pageId] : []));
  const pages = await Promise.all(index.map(async (p) => ({ id: p.id, title: p.title, collection: p.collection, blocks: (await getPageBlocks(p.id)).filter((b) => !b.corrupt) })));
  return { found: orderCollectionPages(pages, menu), published: new Set(index.map((p) => p.id)) };
}

export default async function CollectionTilesBlock({
  props,
  ctx,
}: {
  props: z.infer<typeof collectionTilesSchema>;
  ctx: BlockContext;
}) {
  const t = await getTranslations("home.collections");
  const tg = await getTranslations("gallery");
  const size = tileSize(props.size);
  const geo = TILE_GEOMETRY[size];

  const { found, published } = await findCollectionPages(ctx);
  type Row = { key: string; pageId: number; collection: TileItem["collection"]; eyebrow: { fr: string; en: string }; title: { fr: string; en: string }; intro: { fr: string; en: string }; broken?: true; index?: number };
  let rows: Row[];
  if (tilesMode(props) === "auto") {
    rows = autoEntries(found, props.edits).map((e) => ({ key: String(e.pageId), pageId: e.pageId, collection: e.collection, eyebrow: e.eyebrow, title: e.title, intro: e.intro }));
  } else {
    rows = manualEntries(props.items ?? [], published).map((it, i) => ({ index: i, key: `${i}-${it.pageId}`, pageId: it.pageId, collection: it.collection, eyebrow: it.eyebrow, title: it.title, intro: it.intro, ...(it.broken ? { broken: true as const } : {}) }));
  }

  const fixed = props.ratio && props.ratio !== "auto" ? props.ratio : undefined;
  const tiles: Tile[] = [];
  for (const row of rows) {
    // Page supprimée ou dépubliée (liste manuelle) : masquée en ligne, signalée sur la toile.
    if (row.broken) {
      if (ctx.edit) tiles.push({ key: row.key, broken: true, itemIndex: row.index, href: "#", eyebrow: "", title: tr(row.title, ctx.locale), intro: "", count: "", image: "", imageAlt: "", width: 1, height: 1, shownRatio: 1 });
      continue;
    }
    const cover = await getCollectionCover(row.collection, ctx.locale);
    if (!cover) continue;
    const crop = ctx.look?.tileCrop?.[row.collection];
    // Recadrage libre (lot 17d) : variante extraite de l'ORIGINAL de la couverture ; la tuile prend le rapport du rectangle.
    const free = crop?.rect && cover.mediaId && cover.sources && !cover.video ? cropSources({ id: cover.mediaId, width: cover.width, height: cover.height }, crop.rect, signCrop, mediaUrl, cover.sources.color) : null;
    const width = free ? free.width : cover.width;
    const height = free ? free.height : cover.height;
    tiles.push({
      key: row.collection,
      ...(row.index !== undefined ? { itemIndex: row.index } : {}),
      ...(crop && !crop.rect ? { cropStyle: cropVars(crop) } : {}),
      ...(free ? { free: true } : {}),
      ...(free && crop?.rect && cover.sources
        ? { fallback: { src: cover.image, sources: cover.sources, width: cover.width, height: cover.height, sizes: scaleSizes(geo.sizes, 1 / crop.rect.w), rect: crop.rect } }
        : {}),
      ...(ctx.edit && cover.mediaId && cover.sources && !cover.video ? { full: { src: cover.image, ratio: cover.width / Math.max(1, cover.height), w: cover.width, h: cover.height } } : {}),
      href: await hrefForPage(row.pageId, ctx.locale),
      eyebrow: tr(row.eyebrow, ctx.locale),
      title: tr(row.title, ctx.locale),
      intro: tr(row.intro, ctx.locale),
      count: tg("count", { count: await countCollection(row.collection) }),
      image: cover.image,
      sources: free ? free.sources : cover.sources,
      imageAlt: cover.alt,
      width,
      height,
      // Rapport de ce qui est affiché (la zone gardée, sinon le format imposé, sinon l'image) : borne la largeur de la tuile.
      shownRatio: free ? width / Math.max(1, height) : (parseRatio(fixed) ?? width / Math.max(1, height)),
    });
  }

  return (
    <section className="shell pt-[var(--section-gap)]">
      <header className="title-head mb-[var(--t-space-l)] max-w-2xl">
        <Eyebrow {...inline(ctx, "eyebrow")}>{tr(props.eyebrow, ctx.locale)}</Eyebrow>
        <h2 className="mt-4 font-display text-[clamp(2.25rem,6vw,4.5rem)] text-ink" {...inline(ctx, "title")}>
          {tr(props.title, ctx.locale)}
        </h2>
      </header>
      <CollectionTiles
        tiles={tiles}
        cta={t("view")}
        ratio={props.ratio}
        size={size}
        edit={ctx.edit}
        manual={tilesMode(props) === "manual"}
        itemCount={props.items?.length ?? 0}
        candidates={found.filter((p) => !(props.items ?? []).some((it) => it.pageId === p.pageId)).map((p) => ({ pageId: p.pageId, title: tr(p.title, ctx.locale) || `Page ${p.pageId}` }))}
      />
    </section>
  );
}
