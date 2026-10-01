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
import { asc, eq, inArray, isNull } from "drizzle-orm";

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
  /** Vue brouillon de l'éditeur seulement : repères de l'emplacement. */
  edit?: ArtworkEdit;
};

/**
 * Repères d'édition d'un emplacement (vue brouillon) : clé stable, place
 * vide (pointillés au ratio gardé), média en cours de traitement.
 */
export type ArtworkEdit = { key: string; empty: boolean; pending: boolean; aspect: number };

/** Projet prêt à l'affichage, ses œuvres déjà résolues et localisées. */
export type LocalizedProject = {
  slug: string;
  year: string;
  featured: boolean;
  title: string;
  context: string;
  description: string;
  artworks: LocalizedArtwork[];
  /** Vue brouillon seulement : identifiant, et projet créé dans ce brouillon. */
  edit?: { id: number; draft: boolean };
};

type RawProject = {
  id: number;
  draftPageId: number | null;
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
  edit?: ArtworkEdit;
};

type Snapshot = { projects: RawProject[]; artworks: RawArtwork[] };

async function projectIds(): Promise<number[]> {
  // Projets publiés seulement : un projet créé dans un brouillon de page n'existe pas encore.
  return cached(["project-ids"], [TAGS.projects], () =>
    getDb()
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(isNull(schema.projects.draftPageId))
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
      draftPageId: schema.projects.draftPageId,
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
  const published = new Set(ids);
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
        .filter((r) => r.slot.draftState !== "added" && published.has(r.slot.projectId));
      return { projects: readProjects(ids), artworks: toArtworks(rows) };
    },
  );
}

/**
 * Vue brouillon : la surcouche portée par le brouillon de la page rendue
 * (ordre, média, textes, places vides ou retirées, emplacements ajoutés) et
 * les projets créés dans ce brouillon ; ce qui appartient au brouillon d'une
 * autre page est ignoré (version publiée). Les places vides et les médias en
 * traitement restent présents, marqués pour la toile.
 */
function draftSnapshot(): Snapshot {
  const pageId = draftViewPage();
  const db = getDb();
  const projects = db
    .select({ id: schema.projects.id, page: schema.projects.draftPageId })
    .from(schema.projects)
    .orderBy(asc(schema.projects.position))
    .all()
    .filter((p) => p.page === null || p.page === pageId);
  const visible = new Set(projects.map((p) => p.id));
  const media = new Map(db.select().from(schema.media).all().map((m) => [m.id, m]));
  const artworks: RawArtwork[] = [];
  for (const slot of db.select().from(schema.slots).orderBy(asc(schema.slots.id)).all()) {
    if (!visible.has(slot.projectId)) continue;
    const mine = slot.draftPageId === pageId && pageId !== null;
    if (mine ? slot.draftState === "retired" : slot.draftState === "added") continue;
    const mediaId = mine ? (slot.draftState === "removed" ? null : (slot.draftMediaId ?? slot.mediaId)) : slot.mediaId;
    const m = mediaId ? media.get(mediaId) : undefined;
    const ready = m?.status === "ready";
    const aspect = m?.width && m.height ? m.width / m.height : (slot.aspect ?? 4 / 3);
    const merged = {
      ...slot,
      position: mine && slot.draftPosition !== null ? slot.draftPosition : slot.position,
      title: (mine ? slot.draftTitle : null) ?? slot.title,
      description: (mine ? slot.draftDescription : null) ?? slot.description,
    };
    const edit: ArtworkEdit = { key: slot.draftKey ?? `s${slot.id}`, empty: !ready, pending: Boolean(m) && !ready && m?.status === "processing", aspect };
    if (ready) artworks.push({ ...toArtworks([{ slot: merged, media: m! }])[0], edit });
    else
      artworks.push({
        id: slot.id,
        projectId: slot.projectId,
        position: merged.position,
        slug: slot.slug,
        collection: slot.collection,
        title: merged.title,
        description: merged.description,
        year: slot.year,
        featured: slot.featured,
        duration: null,
        videoId: null,
        reel: false,
        key: "",
        sources: null,
        video: null,
        alt: null,
        width: Math.round(aspect * 1000),
        height: 1000,
        edit,
      });
  }
  return { projects: readProjects(projects.map((p) => p.id)), artworks };
}

/** Œuvres affichables hors des planches (collections, couvertures, compteurs) : jamais une place vide. */
const shown = (a: RawArtwork) => !a.edit?.empty;

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
  if (a.edit) out.edit = a.edit;
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
    ...(project.draftPageId !== undefined && artworks.some((a) => a.edit) ? { edit: { id: project.id, draft: project.draftPageId !== null } } : {}),
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
  return artworks.filter((a) => shown(a) && a.collection === collection).map((a) => localize(a, locale));
}

/** La demoreel : première œuvre marquée `reel` de la collection animation. */
export async function getReel(locale: AppLocale): Promise<LocalizedArtwork | undefined> {
  const { artworks } = await snapshot();
  const found = artworks.find((a) => shown(a) && a.collection === "animation" && a.reel);
  return found ? localize(found, locale) : undefined;
}

/** Une vignette représentative par collection (pour les tuiles d'accueil). */
export async function getCollectionCover(
  collection: Collection,
  locale: AppLocale,
): Promise<LocalizedArtwork | undefined> {
  const { artworks } = await snapshot();
  const items = artworks.filter((a) => shown(a) && a.collection === collection);
  const cover = items.find((a) => a.featured) ?? items[0];
  return cover ? localize(cover, locale) : undefined;
}

/** Nombre d'œuvres visibles par collection. */
export async function countCollection(collection: Collection): Promise<number> {
  const { artworks } = await snapshot();
  return artworks.filter((a) => shown(a) && a.collection === collection).length;
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
    .filter((p) => p.artworks.some((a) => !a.edit?.empty));
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

/**
 * Un projet et sa planche (bloc « Planche d'un projet »). En vue brouillon :
 * projet créé dans ce brouillon compris, places vides comprises (toile).
 * Planche vide en vue brouillon : projet sans emplacement, repéré quand même.
 */
export async function getProjectBoard(slug: string, locale: AppLocale): Promise<LocalizedProject | null> {
  const { projects, artworks } = await snapshot();
  const project = projects.find((p) => p.slug === slug);
  if (!project) return null;
  const out = localizeProject(project, artworks, locale);
  if (!out.edit && (await isDraftView())) out.edit = { id: project.id, draft: project.draftPageId !== null };
  return out;
}
