import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";

import { inline, localized, tr, type BlockContext, localizedText } from "./types";

export const richTextSchema = z.object({
  eyebrow: localized.optional(),
  title: localized.optional(),
  /** Paragraphes de texte brut (aucun HTML interprété). */
  paragraphs: z.array(localizedText).min(1).max(30),
});

/**
 * Bloc Texte. Un champ n'existe que s'il a été demandé : sans clé `title` (ni `eyebrow`), le bloc est un paragraphe
 * seul, sans place réservée ni texte d'aide, sur la toile comme en public. Sur la toile, « + Ajouter un titre » /
 * « Retirer le titre » (visibles au survol) créent ou retirent la clé (lot 19a).
 */
export default function RichTextBlock({ props, ctx }: { props: z.infer<typeof richTextSchema>; ctx: BlockContext }) {
  // Titre ou étiquette vides : aucune place en public (pas même leur marge) ; en édition, un champ présent reste saisissable.
  const showEyebrow = props.eyebrow !== undefined && (ctx.edit || Boolean(tr(props.eyebrow, ctx.locale)));
  const showTitle = props.title !== undefined && (ctx.edit || Boolean(tr(props.title, ctx.locale)));
  return (
    <section className={ctx.edit ? "shell pt-[var(--section-gap)] pe-field-host" : "shell pt-[var(--section-gap)]"}>
      <div className={ctx.edit ? "max-w-2xl relative" : "max-w-2xl"}>
        {ctx.edit && (
          <button type="button" className="pe-field-op" data-edit-field-op={props.title === undefined ? "add-title" : "remove-title"} {...(ctx.cell ? { "data-cell": "" } : {})}>
            {props.title === undefined ? "+ Ajouter un titre" : "Retirer le titre"}
          </button>
        )}
        {showEyebrow && <Eyebrow {...inline(ctx, "eyebrow")} data-placeholder={ctx.edit ? "Étiquette" : undefined}>{tr(props.eyebrow!, ctx.locale)}</Eyebrow>}
        {showTitle && (
          <h2 className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] text-ink" {...inline(ctx, "title")} data-placeholder={ctx.edit ? "Titre" : undefined}>
            {tr(props.title!, ctx.locale)}
          </h2>
        )}
        {/* La marge sous le titre n'existe que s'il y a un titre : un paragraphe seul colle au rythme de la page. */}
        <div className={`${showEyebrow || showTitle ? "mt-6 " : ""}space-y-6 text-base leading-relaxed text-ink-soft`}>
          {props.paragraphs.map((p, i) => (
            <p key={i} {...inline(ctx, `paragraphs.${i}`)} data-placeholder={ctx.edit ? "Paragraphe" : undefined}>
              {tr(p, ctx.locale)}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
