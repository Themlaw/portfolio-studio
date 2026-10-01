import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import { getSite } from "@/lib/settings";

import { localized, tr, type BlockContext, localizedText } from "./types";

export const contactSchema = z.object({
  eyebrow: localized,
  title: localized,
  intro: localizedText,
  cta: localized,
});

export default async function ContactBlock({ props, ctx }: { props: z.infer<typeof contactSchema>; ctx: BlockContext }) {
  const site = await getSite(ctx.locale);
  return (
    <section className="shell pt-[var(--section-gap)]">
      <div className="rounded-lg border border-line bg-surface px-[clamp(1.5rem,5vw,4rem)] py-[clamp(2.5rem,6vw,4.5rem)] text-center shadow-card">
        <Eyebrow>{tr(props.eyebrow, ctx.locale)}</Eyebrow>
        <h2 className="mx-auto mt-4 max-w-2xl font-display text-[clamp(2rem,5vw,3.5rem)] text-ink">
          {tr(props.title, ctx.locale)}
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-ink-soft">{tr(props.intro, ctx.locale)}</p>
        <a className="btn mt-8" href={`mailto:${site.email}`}>
          {tr(props.cta, ctx.locale)}
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </section>
  );
}
