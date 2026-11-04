/**
 * Œuvres que le bloc « Une œuvre au hasard » (lot 89) peut montrer : la lecture PUBLIÉE du portfolio, jamais la vue brouillon.
 *
 * Une œuvre est montrable quand TOUT ceci est vrai : son emplacement existe en version publiée (pas un emplacement « added » d'un
 * brouillon), son projet est publié (ni créé dans un brouillon de page, ni à la corbeille), son média est prêt et pas à la corbeille, et une
 * page publiée (hors corbeille, hors page spéciale) la présente — le lien du bloc mène à cette page : un projet qu'aucune page n'affiche
 * est « masqué » (il n'est pas sur le site), l'œuvre n'est donc pas tirée. La page est celle qui montre le projet (bloc Projet, Titre lié…),
 * à défaut la page de la collection de l'œuvre.
 *
 * Lecture étiquetée (projets, médias, menu, chaque page et chaque projet publié) : la 404 qui les montre se rafraîchit quand l'une d'elles
 * change — y compris quand une œuvre est retirée d'un projet ou change d'image (étiquette `project:<id>` seule, docs/SECURITE.md N16).
 */
import { and, asc, eq, isNull } from "drizzle-orm";

import { extractProjectRefs } from "@/blocks/refs";

import { cached, TAGS } from "./cache";
import { getDb, schema } from "./db";
import type { PictureSources } from "./images/variants";
import { parseJson } from "./json";
import { mediaSources, mediaUrl } from "./media";
import { isSpecialPage } from "./special-pages";

type L = { fr: string; en: string };
export type Collection = "characters" | "backgrounds" | "animation";

/** Œuvre prête à être tirée (textes dans les deux langues, chemin de sa page par langue). */
export type PoolWork = {
  slug: string;
  collection: Collection;
  title: L;
  alt: L | null;
  /** Variantes responsives ; null pour une image du seed (SVG), servie telle quelle. */
  sources: PictureSources | null;
  url: string;
  width: number;
  height: number;
  /** Chemin (sans langue) de la page qui présente l'œuvre, par langue. */
  path: L;
};

/** Pages publiées d'ordinaire (hors corbeille, hors pages spéciales), dans l'ordre de leur identifiant. */
function livePages() {
  return getDb()
    .select({ id: schema.pages.id, slug: schema.pages.slug, collection: schema.pages.collection })
    .from(schema.pages)
    .where(and(eq(schema.pages.published, true), isNull(schema.pages.deletedAt)))
    .orderBy(asc(schema.pages.id))
    .all()
    .filter((p) => !isSpecialPage({ slug: p.slug }));
}

/** Lecture directe (sans cache) : les œuvres montrables maintenant. Exportée pour les tests sur une vraie base. */
export function readPoolWorks(): PoolWork[] {
  const pages = livePages();
  {
    const db = getDb();
    const pathOf = (p: { slug: L }): L => ({ fr: p.slug.fr ? `/${p.slug.fr}` : "/", en: p.slug.en ? `/${p.slug.en}` : "/" });
    // Projet -> première page publiée qui le montre.
    const pageOfProject = new Map<string, (typeof pages)[number]>();
    const blocks = db.select({ pageId: schema.blocks.pageId, type: schema.blocks.type, props: schema.blocks.props }).from(schema.blocks).orderBy(asc(schema.blocks.pageId), asc(schema.blocks.position)).all();
    const byId = new Map(pages.map((p) => [p.id, p]));
    for (const b of blocks) {
      const page = byId.get(b.pageId);
      if (!page) continue;
      for (const slug of extractProjectRefs(b.type, parseJson(b.props))) if (!pageOfProject.has(slug)) pageOfProject.set(slug, page);
    }
    const pageOfCollection = new Map<string, (typeof pages)[number]>();
    for (const p of pages) if (p.collection && !pageOfCollection.has(p.collection)) pageOfCollection.set(p.collection, p);

    const projects = new Map(
      db
        .select({ id: schema.projects.id, slug: schema.projects.slug })
        .from(schema.projects)
        .where(and(isNull(schema.projects.draftPageId), isNull(schema.projects.deletedAt)))
        .all()
        .map((p) => [p.id, p.slug]),
    );
    const out: PoolWork[] = [];
    const rows = db
      .select({ slot: schema.slots, media: schema.media })
      .from(schema.slots)
      .innerJoin(schema.media, eq(schema.slots.mediaId, schema.media.id))
      .where(and(eq(schema.media.status, "ready"), isNull(schema.media.deletedAt)))
      .orderBy(asc(schema.slots.id))
      .all();
    for (const { slot, media } of rows) {
      if (slot.draftState === "added") continue;
      const projectSlug = projects.get(slot.projectId);
      if (!projectSlug) continue;
      const sources = mediaSources(media);
      // Vidéo ou PDF sans image à montrer : pas tirés. Image du seed (sans variantes) : servie telle quelle.
      if (!sources && media.kind !== "image") continue;
      const page = pageOfProject.get(projectSlug) ?? pageOfCollection.get(slot.collection);
      if (!page) continue;
      out.push({
        slug: slot.slug,
        collection: slot.collection,
        title: slot.title,
        alt: media.alt ?? null,
        sources,
        url: sources ? sources.largest.webp : mediaUrl(media.key),
        width: media.width ?? sources?.largest.w ?? 1200,
        height: media.height ?? sources?.largest.h ?? 900,
        path: pathOf(page),
      });
    }
    return out;
  }
}

/** Projets publiés (ni créés dans un brouillon de page, ni à la corbeille) : une étiquette `project:<id>` chacun. */
function liveProjectIds(): number[] {
  return getDb()
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(isNull(schema.projects.draftPageId), isNull(schema.projects.deletedAt)))
    .orderBy(asc(schema.projects.id))
    .all()
    .map((p) => p.id);
}

export async function getPoolWorks(): Promise<PoolWork[]> {
  const pages = livePages();
  const projects = liveProjectIds();
  return cached(
    ["random-works", pages.map((p) => p.id).join(","), projects.join(",")],
    [TAGS.projects, TAGS.media, TAGS.nav, ...pages.map((p) => TAGS.page(p.id)), ...projects.map(TAGS.project)],
    readPoolWorks,
  );
}

/** Source choisie dans le bloc : tout le portfolio, une catégorie (collection) ou une sélection d'œuvres (identifiants d'emplacement). */
export type WorkSource = { source: "all" } | { source: "collection"; collection: Collection } | { source: "manual"; works: string[] };

export function selectWorks(pool: PoolWork[], source: WorkSource): PoolWork[] {
  if (source.source === "collection") return pool.filter((w) => w.collection === source.collection);
  if (source.source === "manual") {
    const wanted = new Set(source.works);
    return pool.filter((w) => wanted.has(w.slug));
  }
  return pool;
}

/** Candidats envoyés au navigateur (il en tire un à chaque visite) : au plus `limit`, pris au hasard dans la source quand elle est plus grande. */
export function sampleWorks<T>(works: T[], limit: number): T[] {
  if (works.length <= limit) return works;
  const copy = [...works];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, limit);
}
