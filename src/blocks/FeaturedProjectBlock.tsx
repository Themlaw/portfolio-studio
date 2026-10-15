import type { ReactNode } from "react";
import { z } from "zod";

import { Link } from "@/i18n/navigation";
import { hrefForPage } from "@/lib/pages";

import { MAX_CHILDREN } from "./tree";
import { childBlock, inline, localized, pageRef, projectSlug, textStyle, tr, type BlockContext } from "./types";

export const featuredProjectSchema = z.object({
  /** Projet mis en avant (slug) : transmis aux composants qui n'en ont pas. */
  project: projectSlug.optional(),
  /** Lien « voir plus » sous les composants. */
  more: z.object({ label: localized, pageId: pageRef.optional() }).optional(),
  children: z.array(childBlock).max(MAX_CHILDREN).default([]),
});

/**
 * « Projet mis en avant » (v0.13) : premier CONTENEUR. Il ne dessine rien
 * lui-même : ses composants (titre, planche, image, texte, grille…) se
 * suivent comme des blocs de page, le projet choisi leur étant transmis
 * (src/blocks/BlockList.tsx). Vide, il ne rend rien en public ; sur la toile,
 * une place pour choisir le projet et une zone de dépôt (couche d'édition).
 */
export default async function FeaturedProjectBlock({
  props,
  ctx,
  children,
}: {
  props: z.infer<typeof featuredProjectSchema>;
  ctx: BlockContext;
  children?: ReactNode;
}) {
  const empty = props.children.length === 0;
  if (empty && !ctx.edit) return null;
  const moreHref = props.more?.pageId ? await hrefForPage(props.more.pageId, ctx.locale) : null;
  return (
    <>
      {ctx.edit && !props.project && (
        <section className="shell pe-container-pick" data-edit-container-pick="" lang="fr" aria-hidden="true" />
      )}
      {children}
      {ctx.edit && empty && <section className="shell pe-container-empty" data-edit-container-empty="" lang="fr" aria-hidden="true" />}
      {props.more && (moreHref || ctx.edit) && (
        <section className="shell">
          <Link className="link-underline text-sm" href={moreHref ?? "/"}>
            {ctx.edit || textStyle(ctx, "more.label").style ? <span {...inline(ctx, "more.label")} data-placeholder="Voir plus">{tr(props.more.label, ctx.locale)}</span> : tr(props.more.label, ctx.locale)}{" "}
            <span aria-hidden="true">→</span>
          </Link>
        </section>
      )}
    </>
  );
}
