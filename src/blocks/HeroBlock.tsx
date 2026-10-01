import { z } from "zod";

import Hero from "@/components/Hero";
import { hrefForPage } from "@/lib/pages";
import { getSite } from "@/lib/settings";

import { localized, pageRef, tr, type BlockContext, localizedText } from "./types";

export const heroSchema = z.object({
  eyebrow: localized,
  /** <mark>…</mark> signale le mot mis en valeur (hero type-only). */
  statement: localizedText,
  /** Page vers laquelle mène le bouton demoreel (hero spotlight). */
  reelPageId: pageRef.optional(),
});

export default async function HeroBlock({ props, ctx }: { props: z.infer<typeof heroSchema>; ctx: BlockContext }) {
  const site = await getSite(ctx.locale);
  return (
    <Hero
      content={{
        name: site.name,
        role: site.role,
        eyebrow: tr(props.eyebrow, ctx.locale),
        statement: tr(props.statement, ctx.locale),
        reelHref: await hrefForPage(props.reelPageId, ctx.locale),
      }}
    />
  );
}
