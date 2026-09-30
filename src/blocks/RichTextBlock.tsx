import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";

import { localized, tr, type BlockContext } from "./types";

export const richTextSchema = z.object({
  eyebrow: localized.optional(),
  title: localized.optional(),
  /** Paragraphes de texte brut (aucun HTML interprété). */
  paragraphs: z.array(localized).min(1),
});

export default function RichTextBlock({ props, ctx }: { props: z.infer<typeof richTextSchema>; ctx: BlockContext }) {
  return (
    <section className="shell pt-[var(--section-gap)]">
      <div className="max-w-2xl">
        {props.eyebrow && <Eyebrow>{tr(props.eyebrow, ctx.locale)}</Eyebrow>}
        {props.title && (
          <h2 className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] text-ink">{tr(props.title, ctx.locale)}</h2>
        )}
        <div className="mt-6 space-y-6 text-base leading-relaxed text-ink-soft">
          {props.paragraphs.map((p, i) => (
            <p key={i}>{tr(p, ctx.locale)}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
