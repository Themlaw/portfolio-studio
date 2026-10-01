import { z } from "zod";

import ProjectStrip from "@/components/ProjectStrip";
import { getProjectBoard } from "@/lib/gallery";

import type { BlockContext } from "./types";

export const projectBoardSchema = z.object({
  /**
   * Slug du projet. Absent dans un brouillon (planche neuve, pas encore
   * nommée) : la publication l'exige (publishCheck du registre).
   */
  project: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(80)
    .optional(),
});

/**
 * La planche d'un projet : son en-tête et sa bande d'images. Sur la toile de
 * l'éditeur, une planche neuve (sans projet) laisse une place que la couche
 * d'édition remplit (nom du projet, projet existant, dépôt d'images) ; hors
 * de l'éditeur, elle n'affiche rien.
 */
export default async function ProjectBoardBlock({ props, ctx }: { props: z.infer<typeof projectBoardSchema>; ctx: BlockContext }) {
  const project = props.project ? await getProjectBoard(props.project, ctx.locale) : null;
  if (project) return <ProjectStrip project={project} />;
  if (!ctx.edit) return null;
  return (
    <section className="shell py-[clamp(3rem,7vw,5.5rem)]" data-edit-board-new="" lang="fr">
      <div className="pe-board-new-space" style={{ minHeight: 320 }} />
    </section>
  );
}
