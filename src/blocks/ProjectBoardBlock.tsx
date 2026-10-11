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
  if (project) {
    const strip = <ProjectStrip project={project} deep={props.deep} showHeader={props.header !== false} collection={props.collection} slotRadius={ctx.look?.slotRadius} />;
    // Toile : les images de ce projet sont en cours de modification sur une autre page
    // (son brouillon est montré ici) : on le dit, plutôt qu'un refus muet au premier geste.
    if (!ctx.edit || !project.edit?.heldBy) return strip;
    return (
      <>
        <div className="shell" data-edit-board-held={project.edit.heldBy} lang="fr">
          <p className="pe-board-held">
            Images en cours de modification sur la page « {project.edit.heldBy} » : ordre et images de ce brouillon montrés ici. Modifie-les sur
            cette page, ou publie-la d&apos;abord.
          </p>
        </div>
        {strip}
      </>
    );
  }
  if (!ctx.edit) return null;
  // Dans un conteneur encore sans projet : la planche attend le choix du conteneur.
  if (ctx.parent && !props.project) {
    return (
      <section className="shell py-[var(--t-board-pad)]" lang="fr">
        <p className="pe-wait" data-edit-board-wait="">
          Planche du projet : choisis d&apos;abord le projet du conteneur.
        </p>
      </section>
    );
  }
  return (
    <section className="shell py-[var(--t-board-pad)]" data-edit-board-new="" lang="fr">
      <div className="pe-board-new-space" style={{ minHeight: 320 }} />
    </section>
  );
}
