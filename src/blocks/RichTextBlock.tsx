import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";

import { inline, localized, tr, type BlockContext, localizedText } from "./types";

export const richTextSchema = z.object({
  eyebrow: localized.optional(),
  title: localized.optional(),
  /** Paragraphes de texte brut (aucun HTML interprété). */
  paragraphs: z.array(localizedText).min(1).max(30),
});

export default function RichTextBlock({ props, ctx }: { props: z.infer<typeof richTextSchema>; ctx: BlockContext }) {
  return (
    <section className="shell pt-[var(--section-gap)]">
      <div className="max-w-2xl">
        {/* Titre ou étiquette vides : aucune place en public (pas même leur marge) ; en édition ils restent saisissables. */}
        {props.eyebrow && (ctx.edit || tr(props.eyebrow, ctx.locale)) && <Eyebrow {...inline(ctx, "eyebrow")}>{tr(props.eyebrow, ctx.locale)}</Eyebrow>}
        {(ctx.edit || (props.title && tr(props.title, ctx.locale))) && (
          <h2 className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] text-ink" {...inline(ctx, "title")} data-placeholder={ctx.edit ? "Titre" : undefined}>
            {props.title ? tr(props.title, ctx.locale) : ""}
          </h2>
        )}
        <div className="mt-6 space-y-6 text-base leading-relaxed text-ink-soft">
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
