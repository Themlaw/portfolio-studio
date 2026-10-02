import { z } from "zod";

import ProjectStrip from "@/components/ProjectStrip";
import { getProjectBoard } from "@/lib/gallery";

import { collection, projectSlug, type BlockContext } from "./types";

export const projectBoardSchema = z.object({
  /**
   * Slug du projet. Absent dans un brouillon (planche neuve, pas encore
   * nommée) : la publication l'exige (publishCheck du registre), sauf dans un
   * conteneur qui a un projet (la planche prend celui du conteneur).
   */
  project: projectSlug.optional(),
  /** Fond papier profond (alternance des anciennes listes de planches). */
  deep: z.boolean().optional(),
  /** Seulement les œuvres d'un métier (anciennes « planches d'une collection », migration 0014). */
  collection: collection.optional(),
  /** Nom, contexte et présentation du projet en tête de planche (masquable sous un titre lié). */
  header: z.boolean().optional(),
});

/**
 * La planche d'un projet : son en-tête et sa bande d'images. Sur la toile de
 * l'éditeur, une planche neuve (sans projet) laisse une place que la couche
 * d'édition remplit (nom du projet, projet existant, dépôt d'images) ; hors
 * de l'éditeur, elle n'affiche rien. Dans un conteneur sans projet propre,
 * elle montre le projet du conteneur.
 */
export default async function ProjectBoardBlock({ props, ctx }: { props: z.infer<typeof projectBoardSchema>; ctx: BlockContext }) {
  const slug = props.project ?? ctx.project;
  const project = slug ? await getProjectBoard(slug, ctx.locale, props.collection) : null;
  if (project) return <ProjectStrip project={project} deep={props.deep} showHeader={props.header !== false} collection={props.collection} />;
  if (!ctx.edit) return null;
  // Dans un conteneur encore sans projet : la planche attend le choix du conteneur.
  if (ctx.parent && !props.project) {
    return (
      <section className="shell py-[clamp(2rem,5vw,3.5rem)]" lang="fr">
        <p className="pe-wait" data-edit-board-wait="">
          Planche du projet : choisis d&apos;abord le projet du conteneur.
        </p>
      </section>
    );
  }
  return (
    <section className="shell py-[clamp(3rem,7vw,5.5rem)]" data-edit-board-new="" lang="fr">
      <div className="pe-board-new-space" style={{ minHeight: 320 }} />
    </section>
  );
}
