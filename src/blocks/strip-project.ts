/**
 * Ce que la planche d'un projet (`ProjectStrip`, composant client) reçoit du serveur (docs/SECURITE.md N8). Tout ce qui
 * est passé à un composant client part dans le flux RSC public : on n'y met que ce qu'il affiche. Jamais la suite de
 * composants brute (`project.layout` : réglages FR et EN de chaque composant, ancienne forme `props.converted` jamais
 * rendue, médias retirés…) — les composants arrivent déjà rendus (`parts`), seul le style des légendes du projet est
 * extrait ici ; et pas l'en-tête (contexte, année, présentation) quand il est masqué (`showHeader: false`), sauf sur la
 * toile de l'éditeur, qui le modifie en place. Module pur (types seulement côté galerie).
 */
import type { LocalizedProject } from "@/lib/gallery";

import { captionStylesOf, type CaptionStyles } from "./caption-style";

export type StripProject = Pick<LocalizedProject, "slug" | "title" | "context" | "year" | "description" | "count" | "artworks" | "edit"> & {
  /** Style des légendes du projet (lot 98), déjà relu par le schéma. */
  captionStyles?: CaptionStyles;
};

export function stripProject(project: LocalizedProject, showHeader = true): StripProject {
  const header = showHeader || Boolean(project.edit);
  const captionStyles = captionStylesOf(project.layout);
  return {
    slug: project.slug,
    title: project.title,
    context: header ? project.context : "",
    year: header ? project.year : "",
    description: header ? project.description : "",
    count: project.count,
    artworks: project.artworks,
    ...(project.edit ? { edit: project.edit } : {}),
    ...(captionStyles ? { captionStyles } : {}),
  };
}
