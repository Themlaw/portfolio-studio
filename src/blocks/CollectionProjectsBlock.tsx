import { z } from "zod";

import ProjectStrip from "@/components/ProjectStrip";
import { getProjectsForCollection } from "@/lib/gallery";

import { collection, type BlockContext } from "./types";

export const collectionProjectsSchema = z.object({ collection });

/**
 * Planches des projets qui ont demandé ce métier, chacune réduite aux œuvres
 * de la collection. Le lecteur voit pour qui avant de voir les images.
 */
export default async function CollectionProjectsBlock({
  props,
  ctx,
}: {
  props: z.infer<typeof collectionProjectsSchema>;
  ctx: BlockContext;
}) {
  const projects = await getProjectsForCollection(props.collection, ctx.locale);
  return (
    <>
      {projects.map((project, index) => (
        <ProjectStrip key={project.slug} project={project} deep={index % 2 === 1} />
      ))}
    </>
  );
}
