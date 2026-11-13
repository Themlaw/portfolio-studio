import { z } from "zod";

import { Link } from "@/i18n/navigation";
import { hrefForPage } from "@/lib/pages";

import { inline, localized, pageRef, textStyle, tr, type BlockContext } from "./types";
import { editI18n } from "./edit-i18n";

export const pageLinkSchema = z.object({
  /** Texte du lien. */
  label: localized,
  /** Page de destination (facultative dans un brouillon, exigée à la publication). */
  pageId: pageRef.optional(),
});

/**
 * « Lien vers une page » (v0.19) : un lien souligné « Texte → » vers une page du site, posé entre deux
 * rubriques. Né de la migration 0021, où le lien « voir plus » de l'ancien conteneur « Projet mis en avant »
 * devient un bloc à part (même balisage : rendu public identique). Sans page choisie, rien en public ; sur la
 * toile, le lien reste visible pour qu'on le règle.
 */
export default async function PageLinkBlock({ props, ctx }: { props: z.infer<typeof pageLinkSchema>; ctx: BlockContext }) {
  const { ta } = await editI18n(ctx);
  const href = props.pageId ? await hrefForPage(props.pageId, ctx.locale) : null;
  if (!href && !ctx.edit) return null;
  return (
    <section className="shell">
      <Link className="link-underline text-sm" href={href ?? "/"}>
        {ctx.edit || textStyle(ctx, "label").style ? (
          <span {...inline(ctx, "label")} data-placeholder={ta("seeMore")}>
            {tr(props.label, ctx.locale)}
          </span>
        ) : (
          tr(props.label, ctx.locale)
        )}{" "}
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
