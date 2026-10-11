import { z } from "zod";

import { getTranslations } from "next-intl/server";

import Hero from "@/components/Hero";
import { getMedia } from "@/lib/media";
import { hrefForPage } from "@/lib/pages";
import { getSiteView } from "@/lib/settings";

import { localized, localizedText, type Localized, mediaRef, pageRef, textStyle, tr, type BlockContext } from "./types";

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
  /** Indicateur de défilement : libellé (absent ou vide dans une langue = message de l'interface) ; false = masqué. */
  scroll: localized.optional(),
  showScroll: z.boolean().optional(),
  /** Bouton demoreel (hero projecteur) : libellé, même repli. */
  reel: localized.optional(),
});

/**
 * L'ouverture (bloc « hero ») : forme choisie par le thème. Nom et métier
 * viennent de l'identité du site (communs à toutes les pages, modifiables en
 * place : brouillon du site) ; étiquette et phrase sont propres au bloc.
 */
export default async function HeroBlock({ props, ctx }: { props: z.infer<typeof heroSchema>; ctx: BlockContext }) {
  const [{ site }, bg, t] = await Promise.all([
    getSiteView(ctx.locale, ctx.pageId),
    getMedia(props.backgroundMediaId),
    getTranslations({ locale: ctx.locale, namespace: "home.hero" }),
  ]);
  // Libellés d'interface par défaut : une page existante rend exactement comme avant.
  const label = (own: Localized | undefined, fallback: string) => (own?.[ctx.locale]?.trim() ? own[ctx.locale] : fallback);
  return (
    <Hero
      content={{
        name: site.name,
        role: site.role,
        eyebrow: tr(props.eyebrow, ctx.locale),
        scroll: label(props.scroll, t("scroll")),
        showScroll: props.showScroll !== false,
        reel: label(props.reel, t("reel")),
        statement: tr(props.statement, ctx.locale),
        reelHref: await hrefForPage(props.reelPageId, ctx.locale),
        background: bg ? { src: bg.url, sources: bg.sources, video: bg.video, width: bg.width ?? 1920, height: bg.height ?? 1080 } : null,
        edit: ctx.edit,
        styles: { eyebrow: textStyle(ctx, "eyebrow").style, scroll: textStyle(ctx, "scroll").style, reel: textStyle(ctx, "reel").style, name: textStyle(ctx, "site.name").style, role: textStyle(ctx, "site.role").style },
      }}
    />
  );
}
