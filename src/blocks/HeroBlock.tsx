import { z } from "zod";

import Hero from "@/components/Hero";
import { getMedia } from "@/lib/media";
import { hrefForPage } from "@/lib/pages";
import { getSiteView } from "@/lib/settings";

import { localized, localizedText, mediaRef, pageRef, tr, type BlockContext } from "./types";

export const heroSchema = z.object({
  eyebrow: localized,
  /** <mark>…</mark> signale le mot mis en valeur (hero type-only). */
  statement: localizedText,
  /** Page vers laquelle mène le bouton demoreel (hero spotlight). */
  reelPageId: pageRef.optional(),
  /**
   * Image ou vidéo de fond choisie sur la toile : remplace le décor du thème
   * (ouverture « parallax »). Absente : le décor du thème.
   */
  backgroundMediaId: mediaRef.optional(),
});

/**
 * L'ouverture (bloc « hero ») : forme choisie par le thème. Nom et métier
 * viennent de l'identité du site (communs à toutes les pages, modifiables en
 * place : brouillon du site) ; étiquette et phrase sont propres au bloc.
 */
export default async function HeroBlock({ props, ctx }: { props: z.infer<typeof heroSchema>; ctx: BlockContext }) {
  const [{ site }, bg] = await Promise.all([getSiteView(ctx.locale, ctx.pageId), getMedia(props.backgroundMediaId)]);
  return (
    <Hero
      content={{
        name: site.name,
        role: site.role,
        eyebrow: tr(props.eyebrow, ctx.locale),
        statement: tr(props.statement, ctx.locale),
        reelHref: await hrefForPage(props.reelPageId, ctx.locale),
        background: bg ? { src: bg.url, sources: bg.sources, video: bg.video, width: bg.width ?? 1920, height: bg.height ?? 1080 } : null,
        edit: ctx.edit,
      }}
    />
  );
}
