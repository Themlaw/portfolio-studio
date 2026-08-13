import artworkData from "@/content/artworks.json";
import projectData from "@/content/projects.json";
import type { AppLocale } from "@/i18n/routing";

/* --------------------------------------------------------------------------
 * Couche d'accès au contenu.
 * Les composants n'importent JAMAIS les JSON directement : ils passent par
 * ces fonctions. Brancher plus tard un CMS / une base / S3 revient à
 * réimplémenter ce fichier, sans toucher à l'UI.
 *
 * Deux niveaux : l'œuvre (une image) et le projet (le groupe qui lui donne
 * son sens). Une œuvre appartient à UN seul projet ; son champ `collection`
 * dit par quel métier elle entre dans le site (personnages / décors /
 * animation). Le site s'organise par projet, se filtre par collection.
 * ----------------------------------------------------------------------- */

export type Collection = "characters" | "backgrounds" | "animation";

type Localized = Record<AppLocale, string>;

export type Artwork = {
  id: string;
  slug: string;
  collection: Collection;
  title: Localized;
  description: Localized;
  image: string;
  width: number;
  height: number;
  year: number;
  featured: boolean;
  /** Animation seulement */
  duration?: string;
  videoId?: string;
  reel?: boolean;
};

/** Œuvre prête à l'affichage : textes déjà résolus dans la langue courante. */
export type LocalizedArtwork = {
  id: string;
  slug: string;
  collection: Collection;
  title: string;
  description: string;
  image: string;
  width: number;
  height: number;
  year: number;
  featured: boolean;
  duration?: string;
  videoId?: string;
  reel?: boolean;
};

export type Project = {
  slug: string;
  /** Période affichée telle quelle, ex. « 2023–2024 ». */
  year: string;
  featured: boolean;
  title: Localized;
  /** Nature du projet et rôle tenu, ex. « Court métrage · Décors & couleur ». */
  context: Localized;
  description: Localized;
  artworkIds: string[];
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

const artworks = artworkData as Artwork[];
const projects = projectData as Project[];

const byId = new Map(artworks.map((a) => [a.id, a]));

function localize(artwork: Artwork, locale: AppLocale): LocalizedArtwork {
  const { title, description, ...rest } = artwork;
  return {
    ...rest,
    title: title[locale] ?? title.fr,
    description: description[locale] ?? description.fr,
  };
}

/**
 * Résout un projet dans la langue courante.
 * `filter` permet de ne garder qu'une partie de ses œuvres (par collection).
 */
function localizeProject(
  project: Project,
  locale: AppLocale,
  filter?: (artwork: Artwork) => boolean,
): LocalizedProject {
  const { title, context, description, artworkIds, ...rest } = project;
  const resolved = artworkIds
    .map((id) => byId.get(id))
    .filter((a): a is Artwork => Boolean(a))
    .filter((a) => (filter ? filter(a) : true));

  return {
    ...rest,
    title: title[locale] ?? title.fr,
    context: context[locale] ?? context.fr,
    description: description[locale] ?? description.fr,
    artworks: resolved.map((a) => localize(a, locale)),
  };
}

/* -------------------------------------------------------------- Œuvres -- */

/** Toutes les œuvres, ordre du fichier de contenu. */
export function getAll(locale: AppLocale): LocalizedArtwork[] {
  return artworks.map((a) => localize(a, locale));
}

/** Les œuvres d'une collection donnée. */
export function getCollection(
  collection: Collection,
  locale: AppLocale,
): LocalizedArtwork[] {
  return artworks
    .filter((a) => a.collection === collection)
    .map((a) => localize(a, locale));
}

/** Une œuvre par son slug. */
export function getArtwork(
  slug: string,
  locale: AppLocale,
): LocalizedArtwork | undefined {
  const found = artworks.find((a) => a.slug === slug);
  return found ? localize(found, locale) : undefined;
}

/** La demoreel : première œuvre marquée `reel` de la collection animation. */
export function getReel(locale: AppLocale): LocalizedArtwork | undefined {
  const found = artworks.find((a) => a.collection === "animation" && a.reel);
  return found ? localize(found, locale) : undefined;
}

/** Une vignette représentative par collection (pour les tuiles d'accueil). */
export function getCollectionCover(
  collection: Collection,
  locale: AppLocale,
): LocalizedArtwork | undefined {
  const items = artworks.filter((a) => a.collection === collection);
  const cover = items.find((a) => a.featured) ?? items[0];
  return cover ? localize(cover, locale) : undefined;
}

/** Nombre d'œuvres par collection (affiché sur les tuiles). */
export function countCollection(collection: Collection): number {
  return artworks.filter((a) => a.collection === collection).length;
}

/* ------------------------------------------------------------- Projets -- */

/** Tous les projets, ordre du fichier de contenu, avec toutes leurs œuvres. */
export function getProjects(locale: AppLocale): LocalizedProject[] {
  return projects.map((p) => localizeProject(p, locale));
}

/** Un projet par son slug. */
export function getProject(
  slug: string,
  locale: AppLocale,
): LocalizedProject | undefined {
  const found = projects.find((p) => p.slug === slug);
  return found ? localizeProject(found, locale) : undefined;
}

/**
 * Les projets qui contiennent au moins une œuvre de cette collection,
 * chacun réduit aux œuvres de cette collection.
 */
export function getProjectsForCollection(
  collection: Collection,
  locale: AppLocale,
): LocalizedProject[] {
  return projects
    .map((p) => localizeProject(p, locale, (a) => a.collection === collection))
    .filter((p) => p.artworks.length > 0);
}

/** Les projets mis en avant sur l'accueil. */
export function getFeaturedProjects(
  locale: AppLocale,
  limit = 2,
): LocalizedProject[] {
  const pool = projects.filter((p) => p.featured);
  return (pool.length > 0 ? pool : projects)
    .slice(0, limit)
    .map((p) => localizeProject(p, locale));
}
