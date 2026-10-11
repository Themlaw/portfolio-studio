import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import { boardMarks } from "@/lib/board-marks";
import { getProjectBoard } from "@/lib/gallery";

import { inline, localized, localizedText, textStyle, tr, type BlockContext } from "./types";

export const sectionTitleSchema = z.object({
  eyebrow: localized.optional(),
  title: localized.optional(),
  intro: localizedText.optional(),
  /**
   * Titre lié au projet du conteneur : son nom (titre) et sa présentation
   * (texte) viennent du projet ; l'étiquette reste celle du bloc.
   */
  linked: z.boolean().optional(),
});

/**
 * Titre de section : étiquette, titre, présentation. Même rendu que l'ancien
 * en-tête des « Projets mis en avant » (la migration 0014 s'appuie dessus :
 * parité au pixel). Dans un conteneur, peut reprendre le nom et la
 * présentation du projet du conteneur (projet créé sur la page : nom
 * modifiable en place, comme sur sa planche).
 */
export default async function SectionTitleBlock({ props, ctx }: { props: z.infer<typeof sectionTitleSchema>; ctx: BlockContext }) {
  const project = props.linked && ctx.project ? await getProjectBoard(ctx.project, ctx.locale) : null;
  if (props.linked && !project && !ctx.edit) return null;
  const ph = (text: string) => (ctx.edit ? { "data-placeholder": text } : {});
  // Vue brouillon : le nom et la présentation du projet se modifient en place (v0.15). Le contenu
  // est celui du projet (une seule source, partagée avec sa planche) ; seule la mise en forme est celle du bloc.
  const linkedEdit = props.linked && project?.edit ? project.edit : null;
  const title = props.linked ? (project?.title ?? "") : props.title ? tr(props.title, ctx.locale) : "";
  const intro = props.linked ? (project?.description ?? "") : props.intro ? tr(props.intro, ctx.locale) : null;
  const header = (
    <header className="title-head max-w-2xl" {...(linkedEdit ? { ...boardMarks(linkedEdit), "data-edit-board-label": project?.title } : {})}>
      {(props.eyebrow || ctx.edit) && (
        <Eyebrow {...inline(ctx, "eyebrow")} {...ph("Étiquette")}>
          {props.eyebrow ? tr(props.eyebrow, ctx.locale) : ""}
        </Eyebrow>
      )}
      <h2
        className="mt-4 font-display text-[clamp(2rem,5vw,3.75rem)] text-ink"
        {...(props.linked ? { ...(linkedEdit ? { "data-project-inline": "title", "data-look-key": "title" } : {}), ...textStyle(ctx, "title") } : inline(ctx, "title"))}
        {...ph(props.linked ? (ctx.project ? "Nom du projet" : "Choisis le projet du conteneur") : "Titre")}
      >
        {title}
      </h2>
      {(intro !== null || ctx.edit) && (
        <p
          className="mt-5 text-base leading-relaxed text-ink-soft"
          {...(props.linked ? { ...(linkedEdit ? { "data-project-inline": "description", "data-look-key": "intro" } : {}), ...textStyle(ctx, "intro") } : inline(ctx, "intro"))}
          {...ph(props.linked ? "Présentation du projet" : "Présentation")}
        >
          {intro ?? ""}
        </p>
      )}
    </header>
  );
  if (ctx.cell) return header;
  return <section className="shell pt-[var(--section-gap)]">{header}</section>;
}
