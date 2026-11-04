/* --------------------------------------------------------------------------
 * Façade du contenu « galerie » (projets, œuvres), lue en base.
 * Les composants n'importent jamais Drizzle : ils passent par ces fonctions.
 *
 * Deux niveaux : l'œuvre (un slot de planche) et le projet (le groupe qui lui
 * donne son sens). Une œuvre appartient à UN seul projet ; son champ
 * `collection` dit par quel métier elle entre dans le site. L'ordre global
 * des œuvres (collections, couverture, demoreel) est l'ordre des slots (id).
 * Un slot sans média (image retirée) est masqué côté public.
 *
 * Projet « masqué » (docs/SECURITE.md N4) : un projet qu'aucune page publiée
 * n'affiche n'est pas sur le site. Il n'entre donc ni dans les couvertures et
 * compteurs des collections, ni dans la demoreel, ni dans les planches d'une
 * collection, ni dans le repli des projets mis en avant (`displayedIds`, une
 * seule lecture par rendu, étiquetée par page).
 * ----------------------------------------------------------------------- */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { isProjectStrip, layoutMediaIds, readLayout, type BoardItem } from "@/blocks/board-layout";
import { extractProjectRefs } from "@/blocks/refs";
import type { AppLocale } from "@/i18n/routing";

import { cached, TAGS } from "./cache";
import { draftViewPage, getDraftBlocks, isDraftView } from "./draft-view";
import { getDb, schema } from "./db";
import type { PictureSources } from "./images/variants";
import { parseJson } from "./json";
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
  /** Média de l'image (recadrage libre d'une tuile de collection, lot 17d). */
  mediaId?: number;
  /** Variantes AVIF/WebP d'une image téléversée (absent : SVG du seed). */
  sources?: PictureSources;
  /** Vidéo hébergée (MP4 convertis, poster, durée ; boucle si muette et courte). */
  video?: VideoView;
  width: number;
  height: number;
  year: number;
  /** Date libre sous l'image d'une bande (lot 39, texte du langage courant) ; absente : l'année de l'emplacement. */
  date?: string;
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
export type ArtworkEdit = { key: string; empty: boolean; pending: boolean; aspect: number; pos?: number };

/** Projet prêt à l'affichage, ses œuvres déjà résolues et localisées. */
export type LocalizedProject = {
  slug: string;
  year: string;
  featured: boolean;
  title: string;
  context: string;
  description: string;
  artworks: LocalizedArtwork[];
  /** Contenu de la planche (lot 31) : la suite de composants sous l'en-tête ; par défaut la bande d'images seule. */
  layout: BoardItem[];
  /**
   * « N œuvres » de la planche (lot 31c) : les images et vidéos qu'elle montre, chacune une fois. Voir `workCount`.
   */
  count: number;
  /** Vue brouillon seulement : identifiant, et projet créé dans ce brouillon. */
  /**
   * Vue brouillon seulement. `heldBy` : titre de la page dont le brouillon
   * porte les changements d'images de ce projet (une AUTRE page) ; la planche
   * les montre, mais ne se modifie que sur cette page. `textHeldBy` : idem pour
   * les TEXTES du projet (nom, contexte, présentation, année) ; `textDraft` :
   * cette page porte une modification de ces textes (v0.15).
   */
  edit?: { id: number; draft: boolean; heldBy?: string; textHeldBy?: string; textDraft?: boolean; layoutHeldBy?: string; layoutDraft?: boolean };
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
  /** Vue brouillon : page qui tient les textes du projet (autre que la vue), ou surcouche de la vue. */
  textHeldBy?: string;
  textDraft?: boolean;
  /** Suite de composants de la planche (version publiée, ou surcouche de la page en vue brouillon). */
  layout: BoardItem[];
  /** Vue brouillon : page qui tient le contenu de la planche (autre que la vue), ou surcouche de la vue. */
  layoutHeldBy?: string;
  layoutDraft?: boolean;
  /** Médias des composants de la suite (hors bande du projet) qui s'affichent : prêts, hors corbeille, chacun une fois. */
  layoutLive: number[];
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
  mediaId: number | null;
  key: string;
  sources: PictureSources | null;
  video: VideoView | null;
  alt: L | null;
  width: number;
  height: number;
  edit?: ArtworkEdit;
};

type Snapshot = { projects: RawProject[]; artworks: RawArtwork[]; held?: Map<number, string> };

async function projectIds(): Promise<number[]> {
  // Projets publiés seulement : un projet créé dans un brouillon de page n'existe pas encore.
  return cached(["project-ids"], [TAGS.projects], () =>
    getDb()
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(isNull(schema.projects.draftPageId), isNull(schema.projects.deletedAt)))
      .orderBy(asc(schema.projects.position))
      .all()
      .map((r) => r.id),
  );
}

/* ---------------------------------------------------- Projets affichés -- */

/** Pages visibles du public : publiées, hors corbeille (pages spéciales comprises : la 404 est publique). */
function livePageIds(): number[] {
  return getDb()
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(and(eq(schema.pages.published, true), isNull(schema.pages.deletedAt)))
    .orderBy(asc(schema.pages.id))
    .all()
    .map((p) => p.id);
}

type AnyBlock = { type: string; props: unknown };

/**
 * Projets AFFICHÉS par ces pages (lecture directe, sans cache ; exportée pour les tests sur une vraie base) :
 * - tout projet cité par un bloc (`extractProjectRefs` : Projet, Titre lié, conteneurs, anciens projets choisis), comme
 *   « Une œuvre au hasard » (random-works.ts) ;
 * - anciens blocs encore lus : « Projets mis en avant » sans choix (les projets marqués), planches d'une collection
 *   (`collection-projects` : les projets qui ont une œuvre de ce métier).
 * `view` (vue brouillon) : les blocs du brouillon de cette page remplacent les siens, et les projets créés dans ce
 * brouillon comptent. Sinon : pages publiées seulement, projets publiés seulement.
 */
export function readDisplayedProjects(view?: { pageId: number; blocks: AnyBlock[] }): Set<number> {
  const db = getDb();
  const pages = livePageIds().filter((id) => id !== view?.pageId);
  const rows: AnyBlock[] = pages.length
    ? db
        .select({ type: schema.blocks.type, props: schema.blocks.props })
        .from(schema.blocks)
        .where(inArray(schema.blocks.pageId, pages))
        .all()
        .map((b) => ({ type: b.type, props: parseJson(b.props) }))
    : [];
  if (view) rows.push(...view.blocks);
  const slugs = new Set<string>();
  const collections = new Set<string>();
  let featured = false;
  const visit = (b: AnyBlock, depth: number) => {
    const p = b.props && typeof b.props === "object" ? (b.props as Record<string, unknown>) : {};
    if (b.type === "collection-projects" && typeof p.collection === "string") collections.add(p.collection);
    if (b.type === "featured-projects" && !(Array.isArray(p.projects) && p.projects.length)) featured = true;
    if (depth < 2 && Array.isArray(p.children)) for (const c of p.children) if (c && typeof c === "object" && typeof (c as AnyBlock).type === "string") visit(c as AnyBlock, depth + 1);
  };
  for (const b of rows) {
    for (const slug of extractProjectRefs(b.type, b.props)) slugs.add(slug);
    visit(b, 0);
  }
  const projects = db
    .select({ id: schema.projects.id, slug: schema.projects.slug, featured: schema.projects.featured, draftPageId: schema.projects.draftPageId })
    .from(schema.projects)
    .where(isNull(schema.projects.deletedAt))
    .all()
    .filter((p) => p.draftPageId === null || (view !== undefined && p.draftPageId === view.pageId));
  const inCollection = new Set(
    collections.size
      ? db
          .select({ projectId: schema.slots.projectId, state: schema.slots.draftState })
          .from(schema.slots)
          .where(inArray(schema.slots.collection, [...collections] as Collection[]))
          .all()
          .filter((r) => view !== undefined || r.state !== "added")
          .map((r) => r.projectId)
      : [],
  );
  return new Set(projects.filter((p) => slugs.has(p.slug) || (featured && p.featured) || inCollection.has(p.id)).map((p) => p.id));
}

/**
 * Projets affichés, une lecture par rendu. Version publiée : étiquetée par les projets, le menu et chaque page publiée
 * (une page qui ajoute ou retire un projet, une page publiée ou dépubliée, la rafraîchit). Vue brouillon : directe.
 */
async function displayedIds(): Promise<Set<number>> {
  if (await isDraftView()) {
    const pageId = draftViewPage();
    if (pageId === null) return readDisplayedProjects();
    const draft = await getDraftBlocks(pageId);
    const blocks =
      draft ??
      getDb()
        .select({ type: schema.blocks.type, props: schema.blocks.props })
        .from(schema.blocks)
        .where(eq(schema.blocks.pageId, pageId))
        .all()
        .map((b) => ({ type: b.type, props: parseJson(b.props) }));
    return readDisplayedProjects({ pageId, blocks });
  }
  const pages = livePageIds();
  const ids = await cached(["displayed-projects", pages.join(",")], [TAGS.projects, TAGS.nav, ...pages.map(TAGS.page)], () => [...readDisplayedProjects()]);
  return new Set(ids);
}

type SlotRow = typeof schema.slots.$inferSelect;
type MediaRow = typeof schema.media.$inferSelect;

/**
 * `overlayPage` : vue brouillon de cette page — la surcouche de textes qu'elle
 * porte (`projects.draft_text`) remplace les textes publiés ; celle d'une
 * autre page n'est pas montrée (signalée par `textHeldBy`).
 */
function readProjects(ids: number[], overlayPage?: number | null): RawProject[] {
  if (!ids.length) return [];
  const db = getDb();
  const rows = db
    .select({
      id: schema.projects.id,
      draftPageId: schema.projects.draftPageId,
      slug: schema.projects.slug,
      year: schema.projects.year,
      featured: schema.projects.featured,
      title: schema.projects.title,
      context: schema.projects.context,
      description: schema.projects.description,
      draftText: schema.projects.draftText,
      draftTextPageId: schema.projects.draftTextPageId,
      layout: schema.projects.layout,
      draftLayout: schema.projects.draftLayout,
      draftLayoutPageId: schema.projects.draftLayoutPageId,
    })
    .from(schema.projects)
    .where(inArray(schema.projects.id, ids))
    .orderBy(asc(schema.projects.position))
    .all();
  // Médias cités par les suites de composants (publiée et surcouche) : seuls ceux qui s'affichent comptent (prêts, hors corbeille).
  const wanted = [...new Set(rows.flatMap((r) => [...layoutMediaIds(readLayout(r.layout)), ...(r.draftLayout ? layoutMediaIds(readLayout(r.draftLayout)) : [])]))];
  const live = new Set(
    wanted.length
      ? db
          .select({ id: schema.media.id })
          .from(schema.media)
          .where(and(inArray(schema.media.id, wanted), isNull(schema.media.deletedAt), eq(schema.media.status, "ready")))
          .all()
          .map((m) => m.id)
      : [],
  );
  let titles: Map<number, string> | null = null;
  const pageTitle = (id: number) => {
    titles ??= new Map(db.select({ id: schema.pages.id, title: schema.pages.title }).from(schema.pages).all().map((x) => [x.id, x.title.fr || `n° ${x.id}`]));
    return titles.get(id) ?? `n° ${id}`;
  };
  return rows.map(({ draftText, draftTextPageId, layout, draftLayout, draftLayoutPageId, ...p }) => {
    let out: RawProject = { ...p, layout: readLayout(layout), layoutLive: [] };
    const withLive = (o: RawProject): RawProject => ({ ...o, layoutLive: [...new Set(layoutMediaIds(o.layout))].filter((id) => live.has(id)) });
    if (overlayPage === undefined) return withLive(out);
    // Contenu de la planche : la surcouche de la page vue remplace la suite publiée ; celle d'une autre page n'est pas montrée.
    if (draftLayoutPageId !== null) {
      if (draftLayoutPageId === overlayPage && draftLayout) out = { ...out, layout: readLayout(draftLayout), layoutDraft: true };
      else if (draftLayoutPageId !== overlayPage) out = { ...out, layoutHeldBy: pageTitle(draftLayoutPageId) };
    }
    out = withLive(out);
    if (draftTextPageId === null) return out;
    if (draftTextPageId === overlayPage && draftText) return { ...out, ...draftText, textDraft: true };
    if (draftTextPageId === overlayPage) return out;
    return { ...out, textHeldBy: pageTitle(draftTextPageId) };
  });
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
      mediaId: media!.id,
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
 * Vue brouillon : la surcouche des emplacements (ordre, média, textes, places
 * vides ou retirées, emplacements ajoutés) et les projets créés dans ce
 * brouillon. L'ordre d'une planche est celui du PROJET : la surcouche portée
 * par le brouillon d'une AUTRE page est montrée aussi (v0.13.1 — sinon une
 * planche reposée ailleurs montrait l'ordre publié, « mêmes images, autre
 * ordre ») ; elle ne se modifie et ne se publie que depuis sa page (`held`,
 * signalé sur la toile). Les places vides et les médias en traitement restent
 * présents, marqués pour la toile.
 */
function draftSnapshot(): Snapshot {
  const pageId = draftViewPage();
  const db = getDb();
  const projects = db
    .select({ id: schema.projects.id, page: schema.projects.draftPageId })
    .from(schema.projects)
    .where(isNull(schema.projects.deletedAt))
    .orderBy(asc(schema.projects.position))
    .all()
    .filter((p) => p.page === null || p.page === pageId);
  const visible = new Set(projects.map((p) => p.id));
  const media = new Map(db.select().from(schema.media).all().map((m) => [m.id, m]));
  const artworks: RawArtwork[] = [];
  const held = new Map<number, string>();
  let titles: Map<number, string> | null = null;
  for (const slot of db.select().from(schema.slots).orderBy(asc(schema.slots.id)).all()) {
    if (!visible.has(slot.projectId)) continue;
    // Surcouche de n'importe quelle page : le brouillon courant du projet.
    const mine = slot.draftPageId !== null;
    if (mine && slot.draftPageId !== pageId && !held.has(slot.projectId)) {
      titles ??= new Map(db.select({ id: schema.pages.id, title: schema.pages.title }).from(schema.pages).all().map((p) => [p.id, p.title.fr || `n° ${p.id}`]));
      held.set(slot.projectId, titles.get(slot.draftPageId!) ?? `n° ${slot.draftPageId}`);
    }
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
        mediaId: null,
        key: "",
        sources: null,
        video: null,
        alt: null,
        width: Math.round(aspect * 1000),
        height: 1000,
        edit,
      });
  }
  return { projects: readProjects(projects.map((p) => p.id), pageId), artworks, held };
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
  if (a.mediaId) out.mediaId = a.mediaId;
  if (a.sources) out.sources = a.sources;
  if (a.video) out.video = a.video;
  if (a.duration) out.duration = a.duration;
  if (a.videoId) out.videoId = a.videoId;
  if (a.reel) out.reel = true;
  if (a.edit) out.edit = a.edit;
  return out;
}

const projectEdit = (p: RawProject) => ({
  id: p.id,
  draft: p.draftPageId !== null,
  ...(p.textHeldBy ? { textHeldBy: p.textHeldBy } : {}),
  ...(p.textDraft ? { textDraft: true } : {}),
  ...(p.layoutHeldBy ? { layoutHeldBy: p.layoutHeldBy } : {}),
  ...(p.layoutDraft ? { layoutDraft: true } : {}),
});

/**
 * « N œuvres » d'une planche, UNE règle partout (en-tête de la planche, compteurs de page, tuiles de collection) :
 * les images et vidéos DISTINCTES qu'elle montre — celles de la bande des images du projet (si elle y est ; `strip` : ses œuvres
 * déjà filtrées par métier, une place vide ne compte pas) plus celles des autres composants (grille, image, vidéo, carrousel),
 * chaque média une seule fois. Sans réglage de planche (la bande seule), c'est le compte d'avant.
 */
function workCount(project: RawProject, own: RawArtwork[]): number {
  const strip = project.layout.some(isProjectStrip) ? own : [];
  const inStrip = new Set(strip.map((a) => a.mediaId).filter((id): id is number => id !== null));
  return strip.length + project.layoutLive.filter((id) => !inStrip.has(id)).length;
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
    ...(project.draftPageId !== undefined && artworks.some((a) => a.edit) ? { edit: projectEdit(project) } : {}),
    slug: project.slug,
    year: project.year,
    featured: project.featured,
    title: project.title[locale] ?? project.title.fr,
    context: project.context[locale] ?? project.context.fr,
    description: project.description[locale] ?? project.description.fr,
    layout: project.layout,
    count: workCount(project, own.filter(shown)),
    artworks: own.map((a) => localize(a, locale)),
  };
}

/* -------------------------------------------------------------- Œuvres -- */

/** Les œuvres d'une collection donnée, dans l'ordre global. */
export async function getCollection(collection: Collection, locale: AppLocale): Promise<LocalizedArtwork[]> {
  const [{ artworks }, displayed] = await Promise.all([snapshot(), displayedIds()]);
  return artworks.filter((a) => shown(a) && a.collection === collection && displayed.has(a.projectId)).map((a) => localize(a, locale));
}

/** La demoreel : première œuvre marquée `reel` de la collection animation. */
export async function getReel(locale: AppLocale): Promise<LocalizedArtwork | undefined> {
  const [{ artworks }, displayed] = await Promise.all([snapshot(), displayedIds()]);
  const found = artworks.find((a) => shown(a) && a.collection === "animation" && a.reel && displayed.has(a.projectId));
  return found ? localize(found, locale) : undefined;
}

/** Une vignette représentative par collection (pour les tuiles d'accueil). */
export async function getCollectionCover(
  collection: Collection,
  locale: AppLocale,
): Promise<LocalizedArtwork | undefined> {
  const [{ artworks }, displayed] = await Promise.all([snapshot(), displayedIds()]);
  const items = artworks.filter((a) => shown(a) && a.collection === collection && displayed.has(a.projectId));
  const cover = items.find((a) => a.featured) ?? items[0];
  return cover ? localize(cover, locale) : undefined;
}

/** Nombre d'œuvres visibles par collection. */
export async function countCollection(collection: Collection): Promise<number> {
  const [{ projects, artworks }, displayed] = await Promise.all([snapshot(), displayedIds()]);
  // Les planches des projets AFFICHÉS qui ont du travail dans ce métier, comptées par la règle commune (`workCount`).
  let n = 0;
  for (const p of projects) {
    if (!displayed.has(p.id)) continue;
    const own = artworks.filter((a) => a.projectId === p.id && shown(a) && a.collection === collection);
    if (own.length) n += workCount(p, own);
  }
  return n;
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
  const [{ projects, artworks }, displayed] = await Promise.all([snapshot(), displayedIds()]);
  return projects
    .filter((p) => displayed.has(p.id))
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
  // Sans choix : les projets marqués, à défaut les premiers projets — jamais un projet qu'aucune page n'affiche.
  const displayed = await displayedIds();
  const visible = projects.filter((p) => displayed.has(p.id));
  const pool = visible.filter((p) => p.featured);
  return (pool.length > 0 ? pool : visible).slice(0, limit).map((p) => localizeProject(p, artworks, locale));
}

/** Une œuvre (plan de planche) par son slug, si elle est affichable. */
export async function getArtwork(slug: string, locale: AppLocale): Promise<LocalizedArtwork | null> {
  const { artworks } = await snapshot();
  const found = artworks.find((a) => a.slug === slug && shown(a));
  return found ? localize(found, locale) : null;
}

/**
 * Nombre d'œuvres qu'affiche la planche d'un projet (filtrée par métier
 * s'il y a lieu), places vides exclues ; null si le projet n'existe pas
 * (compteurs « N œuvres · M projets » calculés depuis la page).
 */
export async function boardWorkCount(slug: string, collection?: string): Promise<number | null> {
  const { projects, artworks } = await snapshot();
  const project = projects.find((p) => p.slug === slug);
  if (!project) return null;
  return workCount(project, artworks.filter((a) => a.projectId === project.id && shown(a) && (!collection || a.collection === collection)));
}

/**
 * Un projet et sa planche (bloc « Planche d'un projet »). En vue brouillon :
 * projet créé dans ce brouillon compris, places vides comprises (toile).
 * Planche vide en vue brouillon : projet sans emplacement, repéré quand même.
 */
export async function getProjectBoard(slug: string, locale: AppLocale, collection?: Collection): Promise<LocalizedProject | null> {
  const { projects, artworks, held } = await snapshot();
  const project = projects.find((p) => p.slug === slug);
  if (!project) return null;
  // Position de chaque emplacement dans la planche ENTIÈRE (toile) : une planche
  // filtrée par métier dépose ses images au bon rang.
  const order = artworks.filter((a) => a.projectId === project.id).sort((x, y) => x.position - y.position);
  const pos = new Map(order.map((a, i) => [a.id, i]));
  const placed = artworks.map((a) => (a.edit && pos.has(a.id) ? { ...a, edit: { ...a.edit, pos: pos.get(a.id)! } } : a));
  const out = localizeProject(project, placed, locale, collection ? (a) => a.collection === collection : undefined);
  if (!out.edit && (await isDraftView())) out.edit = projectEdit(project);
  const heldBy = held?.get(project.id);
  if (out.edit && heldBy) out.edit = { ...out.edit, heldBy };
  return out;
}
