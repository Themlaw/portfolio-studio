/* --------------------------------------------------------------------------
 * Façade du contenu « galerie » (projets, œuvres), lue en base.
 * Les composants n'importent jamais Drizzle : ils passent par ces fonctions.
 *
 * Deux niveaux : l'œuvre (un slot de planche) et le projet (le groupe qui lui
 * donne son sens). Une œuvre appartient à UN seul projet ; son champ
 * `collection` dit par quel métier elle entre dans le site. L'ordre global
 * des œuvres (collections, couverture, demoreel) est l'ordre des slots (id).
 * Un slot sans média (image retirée) est masqué côté public.
 * ----------------------------------------------------------------------- */
import { asc, eq, inArray } from "drizzle-orm";

import type { AppLocale } from "@/i18n/routing";

import { cached, TAGS } from "./cache";
import { draftViewPage, isDraftView } from "./draft-view";
import { getDb, schema } from "./db";
import type { PictureSources } from "./images/variants";
import { mediaSources, mediaUrl, videoView, type VideoView } from "./media";

export type Collection = "characters" | "backgrounds" | "animation";

type L = { fr: string; en: string };

/** Œuvre prête à l'affichage : textes déjà résolus dans la langue courante. */
export type LocalizedArtwork = {
  id: string;
  slug: string;
  collection: Collection;
  title: string;
  description: string;
  image: string;
  /** Texte alternatif de l'image (à défaut, le titre de l'œuvre). */
  alt: string;
  /** Variantes AVIF/WebP d'une image téléversée (absent : SVG du seed). */
  sources?: PictureSources;
  /** Vidéo hébergée (MP4 convertis, poster, durée ; boucle si muette et courte). */
  video?: VideoView;
  width: number;
  height: number;
  year: number;
  featured: boolean;
  duration?: string;
  videoId?: string;
  reel?: boolean;
};

/** Projet prêt à l'affichage, ses œuvres déjà résolues et localisées. */
export type LocalizedProject = {
  slug: string;
  year: string;
  featured: boolean;
  title: string;
  context: string;
  description: string;
  artworks: LocalizedArtwork[];
};

type RawProject = {
  id: number;
  slug: string;
  year: string;
  featured: boolean;
  title: L;
  context: L;
  description: L;
};

type RawArtwork = {
  id: number;
  projectId: number;
  position: number;
  slug: string;
  collection: Collection;
  title: L;
  description: L;
  year: number;
  featured: boolean;
  duration: string | null;
  videoId: string | null;
  reel: boolean;
  key: string;
  sources: PictureSources | null;
  video: VideoView | null;
  alt: L | null;
  width: number;
  height: number;
};

type Snapshot = { projects: RawProject[]; artworks: RawArtwork[] };

async function projectIds(): Promise<number[]> {
  return cached(["project-ids"], [TAGS.projects], () =>
    getDb()
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .orderBy(asc(schema.projects.position))
      .all()
      .map((r) => r.id),
  );
}

type SlotRow = typeof schema.slots.$inferSelect;
type MediaRow = typeof schema.media.$inferSelect;

function readProjects(ids: number[]): RawProject[] {
  if (!ids.length) return [];
  return getDb()
    .select({
      id: schema.projects.id,
      slug: schema.projects.slug,
      year: schema.projects.year,
      featured: schema.projects.featured,
      title: schema.projects.title,
      context: schema.projects.context,
      description: schema.projects.description,
    })
    .from(schema.projects)
    .where(inArray(schema.projects.id, ids))
    .orderBy(asc(schema.projects.position))
    .all();
}

function toArtworks(rows: { slot: SlotRow; media: MediaRow | null }[]): RawArtwork[] {
  return rows
    .filter((r) => r.media && r.media.status === "ready")
    .map(({ slot, media }) => ({
      id: slot.id,
      projectId: slot.projectId,
      position: slot.position,
      slug: slot.slug,
      collection: slot.collection,
      title: slot.title,
      description: slot.description,
      year: slot.year,
      featured: slot.featured,
      duration: slot.duration,
      videoId: slot.videoId,
      reel: slot.reel,
      key: media!.key,
      sources: mediaSources(media!),
      video: videoView(media!),
      alt: media!.alt ?? null,
      width: media!.width ?? 1,
      height: media!.height ?? 1,
    }));
}

/**
 * Tout le contenu galerie en une lecture (petit volume), étiqueté par projet.
 * Version PUBLIÉE : les colonnes de brouillon des emplacements ne sont jamais
 * lues, un emplacement créé dans un brouillon (« added ») n'existe pas.
 * En vue brouillon de l'admin (src/lib/draft-view.ts) : surcouche appliquée,
 * lecture directe sans cache.
 */
async function snapshot(): Promise<Snapshot> {
  if (await isDraftView()) return draftSnapshot();
  const ids = await projectIds();
  return cached(
    ["gallery", ids.join(",")],
    [TAGS.projects, TAGS.media, ...ids.map(TAGS.project)],
    () => {
      const rows = getDb()
        .select({ slot: schema.slots, media: schema.media })
        .from(schema.slots)
        .leftJoin(schema.media, eq(schema.slots.mediaId, schema.media.id))
        .orderBy(asc(schema.slots.id))
        .all()
        .filter((r) => r.slot.draftState !== "added");
      return { projects: readProjects(ids), artworks: toArtworks(rows) };
    },
  );
}

/**
 * Vue brouillon : la surcouche portée par le brouillon de la page rendue
 * (ordre, média, état) ; celle d'une autre page est ignorée (version publiée).
 */
function draftSnapshot(): Snapshot {
  const pageId = draftViewPage();
  const db = getDb();
  const ids = db.select({ id: schema.projects.id }).from(schema.projects).orderBy(asc(schema.projects.position)).all().map((r) => r.id);
  const media = new Map(db.select().from(schema.media).all().map((m) => [m.id, m]));
  const rows = db
    .select()
    .from(schema.slots)
    .orderBy(asc(schema.slots.id))
    .all()
    .filter((slot) => slot.draftState !== "added" || slot.draftPageId === pageId)
    .map((slot) => {
      if (slot.draftPageId !== pageId) return { slot, media: slot.mediaId ? (media.get(slot.mediaId) ?? null) : null };
      const mediaId = slot.draftState === "removed" ? null : (slot.draftMediaId ?? slot.mediaId);
      return { slot: { ...slot, position: slot.draftPosition ?? slot.position }, media: mediaId ? (media.get(mediaId) ?? null) : null };
    });
  return { projects: readProjects(ids), artworks: toArtworks(rows) };
}

function localize(a: RawArtwork, locale: AppLocale): LocalizedArtwork {
  const out: LocalizedArtwork = {
    id: `slot-${a.id}`,
    slug: a.slug,
    collection: a.collection,
    title: a.title[locale] ?? a.title.fr,
    description: a.description[locale] ?? a.description.fr,
    alt: a.alt?.[locale] || a.title[locale] || a.title.fr,
    image: a.sources ? a.sources.largest.webp : mediaUrl(a.key),
    width: a.width,
    height: a.height,
    year: a.year,
    featured: a.featured,
  };
  if (a.sources) out.sources = a.sources;
  if (a.video) out.video = a.video;
  if (a.duration) out.duration = a.duration;
  if (a.videoId) out.videoId = a.videoId;
  if (a.reel) out.reel = true;
  return out;
}

function localizeProject(
  project: RawProject,
  artworks: RawArtwork[],
  locale: AppLocale,
  filter?: (a: RawArtwork) => boolean,
): LocalizedProject {
  const own = artworks
    .filter((a) => a.projectId === project.id)
    .filter((a) => (filter ? filter(a) : true))
    .sort((x, y) => x.position - y.position);
  return {
    slug: project.slug,
    year: project.year,
    featured: project.featured,
    title: project.title[locale] ?? project.title.fr,
    context: project.context[locale] ?? project.context.fr,
    description: project.description[locale] ?? project.description.fr,
    artworks: own.map((a) => localize(a, locale)),
  };
}

/* -------------------------------------------------------------- Œuvres -- */

/** Les œuvres d'une collection donnée, dans l'ordre global. */
export async function getCollection(collection: Collection, locale: AppLocale): Promise<LocalizedArtwork[]> {
  const { artworks } = await snapshot();
  return artworks.filter((a) => a.collection === collection).map((a) => localize(a, locale));
}

/** La demoreel : première œuvre marquée `reel` de la collection animation. */
export async function getReel(locale: AppLocale): Promise<LocalizedArtwork | undefined> {
  const { artworks } = await snapshot();
  const found = artworks.find((a) => a.collection === "animation" && a.reel);
  return found ? localize(found, locale) : undefined;
}

/** Une vignette représentative par collection (pour les tuiles d'accueil). */
export async function getCollectionCover(
  collection: Collection,
  locale: AppLocale,
): Promise<LocalizedArtwork | undefined> {
  const { artworks } = await snapshot();
  const items = artworks.filter((a) => a.collection === collection);
  const cover = items.find((a) => a.featured) ?? items[0];
  return cover ? localize(cover, locale) : undefined;
}

/** Nombre d'œuvres visibles par collection. */
export async function countCollection(collection: Collection): Promise<number> {
  const { artworks } = await snapshot();
  return artworks.filter((a) => a.collection === collection).length;
}

/* ------------------------------------------------------------- Projets -- */

/**
 * Les projets qui contiennent au moins une œuvre de cette collection,
 * chacun réduit aux œuvres de cette collection.
 */
export async function getProjectsForCollection(
  collection: Collection,
  locale: AppLocale,
): Promise<LocalizedProject[]> {
  const { projects, artworks } = await snapshot();
  return projects
    .map((p) => localizeProject(p, artworks, locale, (a) => a.collection === collection))
    .filter((p) => p.artworks.length > 0);
}

/** Les projets mis en avant sur l'accueil, ou ceux choisis (slugs, dans l'ordre). */
export async function getFeaturedProjects(locale: AppLocale, limit = 2, chosen?: string[]): Promise<LocalizedProject[]> {
  const { projects, artworks } = await snapshot();
  if (chosen?.length) {
    return chosen
      .map((slug) => projects.find((p) => p.slug === slug))
      .filter((p): p is (typeof projects)[number] => Boolean(p))
      .map((p) => localizeProject(p, artworks, locale));
  }
  const pool = projects.filter((p) => p.featured);
  return (pool.length > 0 ? pool : projects).slice(0, limit).map((p) => localizeProject(p, artworks, locale));
}
