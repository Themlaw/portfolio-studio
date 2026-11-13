import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";

import { inline, localized, tr, type BlockContext, localizedText } from "./types";
import { editI18n } from "./edit-i18n";

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
export default async function RichTextBlock({ props, ctx }: { props: z.infer<typeof richTextSchema>; ctx: BlockContext }) {
  const { ta } = await editI18n(ctx);
  // Titre ou étiquette vides : aucune place en public (pas même leur marge) ; en édition, un champ présent reste saisissable.
  const showEyebrow = props.eyebrow !== undefined && (ctx.edit || Boolean(tr(props.eyebrow, ctx.locale)));
  const showTitle = props.title !== undefined && (ctx.edit || Boolean(tr(props.title, ctx.locale)));
  return (
    <section className={ctx.edit ? "shell pt-[var(--section-gap)] pe-field-host" : "shell pt-[var(--section-gap)]"}>
      <div className={ctx.edit ? "max-w-2xl relative" : "max-w-2xl"}>
        {ctx.edit && (
          <div className="pe-field-ops" {...(ctx.cell ? { "data-cell": "" } : {})}>
            <button type="button" className="pe-field-op" data-edit-field-op={props.title === undefined ? "add-title" : "remove-title"}>
              {props.title === undefined ? ta("addTitle") : ta("removeTitle")}
            </button>
            {/* L'étiquette a son propre bouton : « Retirer le titre » ne touche qu'au titre. */}
            {props.eyebrow !== undefined && (
              <button type="button" className="pe-field-op" data-edit-field-op="remove-eyebrow">
                {ta("removeLabel")}
              </button>
            )}
          </div>
        )}
        {showEyebrow && <Eyebrow {...inline(ctx, "eyebrow")} data-placeholder={ctx.edit ? ta("label") : undefined}>{tr(props.eyebrow!, ctx.locale)}</Eyebrow>}
        {showTitle && (
          <h2 className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] text-ink" {...inline(ctx, "title")} data-placeholder={ctx.edit ? ta("title") : undefined}>
            {tr(props.title!, ctx.locale)}
          </h2>
        )}
        {/* La marge sous le titre n'existe que s'il y a un titre : un paragraphe seul colle au rythme de la page. */}
        <div className={`${showEyebrow || showTitle ? "mt-6 " : ""}space-y-6 text-base leading-relaxed text-ink-soft`}>
          {props.paragraphs.map((p, i) => (
            <p key={i} {...inline(ctx, `paragraphs.${i}`)} data-placeholder={ctx.edit ? ta("paragraph") : undefined}>
              {tr(p, ctx.locale)}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
