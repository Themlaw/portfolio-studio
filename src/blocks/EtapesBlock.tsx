import type { CSSProperties, ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import Picture from "@/components/Picture";
import { claimEager } from "@/lib/eager";
import { RATIO_VALUES } from "@/lib/images/formats";
import { getMedia } from "@/lib/media";
import { textStyleObject } from "@/lib/look";

import EtapesView, { type StepsViewItem } from "./EtapesView";
import { compareStart, MAX_STEPS, STEPS_MODES, STEPS_VIEWS, stepsItems, stepsMode, stepsView } from "./etapes";
import { hasText } from "./optional-fields";
import { inline, localized, localizedText, mediaRef, tr, type BlockContext } from "./types";

export const etapesSchema = z.object({
  /** Lecture : comparer (avant / après), étapes (making-of) ou tourner (turnaround). */
  mode: z.enum(STEPS_MODES).optional(),
  /** Étapes seulement : onglets (défaut), frise ou défilement. */
  view: z.enum(STEPS_VIEWS).optional(),
  /** Format commun des images (recadrage pareil pour toutes) ; absent : celui de la première. */
  ratio: z.enum(RATIO_VALUES).optional(),
  /** Comparer : position de départ du curseur (0 à 100). */
  start: z.number().min(0).max(100).optional(),
  eyebrow: localized.optional(),
  title: localized.optional(),
  intro: localizedText.optional(),
  items: z
    .array(z.object({ media: mediaRef, label: localized.optional(), caption: localizedText.optional() }))
    .max(MAX_STEPS)
    .default([]),
});

/**
 * Étapes (lot 131) : voir src/blocks/etapes.ts. Les images sont recadrées pareil par le CSS (format commun, `object-fit: cover`) ;
 * l'interaction vit dans EtapesView (client), le HTML reste lisible sans JavaScript.
 */
export default async function EtapesBlock({ props, ctx }: { props: z.infer<typeof etapesSchema>; ctx: BlockContext }) {
  const eager = claimEager(1) > 0;
  const mode = stepsMode(props);
  const picked = stepsItems(props);
  const medias = await Promise.all(picked.map((it) => getMedia(it.media)));
  const kept = picked.map((it, i) => ({ it, m: medias[i] })).filter((x): x is { it: (typeof picked)[number]; m: NonNullable<(typeof medias)[number]> } => Boolean(x.m && !x.m.video && !x.m.pdf));
  if (!kept.length && !ctx.edit) return null;
  const t = await getTranslations({ locale: ctx.locale, namespace: "steps" });
  const first = kept[0]?.m;
  const natural = first ? (first.width ?? 1200) / Math.max(1, first.height ?? 800) : 1.5;
  const pics: ReactNode[] = kept.map(({ it, m }, i) => (
    <Picture
      key={m.id}
      src={m.url}
      sources={m.sources}
      alt={m.alt ? tr(m.alt, ctx.locale) : it.label ? tr(it.label, ctx.locale) : ""}
      width={m.width ?? 1200}
      height={m.height ?? 800}
      sizes="(min-width: 1236px) 1200px, 100vw"
      className="steps-pic"
      priority={eager && i === 0}
    />
  ));
  const items: StepsViewItem[] = kept.map(({ it }) => ({ label: it.label ? tr(it.label, ctx.locale) : "", caption: it.caption ? tr(it.caption, ctx.locale) : "" }));
  // Style local (Aa) des textes de chaque étape.
  const styles: Record<string, CSSProperties> = {};
  kept.forEach((_, i) => {
    for (const k of ["label", "caption"]) {
      const s = ctx.look?.text && Object.hasOwn(ctx.look.text, `items.${i}.${k}`) ? textStyleObject(ctx.look.text[`items.${i}.${k}`], ctx.palette) : undefined;
      if (s) styles[`items.${i}.${k}`] = s as CSSProperties;
    }
  });
  const ph = (text: string) => (ctx.edit ? { "data-placeholder": text } : {});
  const shown = (v: { fr: string; en: string } | undefined) => v !== undefined && (ctx.edit ? true : hasText(v));
  const body = (
    <div className="steps-block">
      {(shown(props.eyebrow) || shown(props.title) || shown(props.intro)) && (
        <header className="steps-head">
          {shown(props.eyebrow) && (
            <Eyebrow {...inline(ctx, "eyebrow")} {...ph("Étiquette")}>
              {tr(props.eyebrow!, ctx.locale)}
            </Eyebrow>
          )}
          {shown(props.title) && (
            <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3.25rem)] text-ink" {...inline(ctx, "title")} {...ph("Titre")}>
              {tr(props.title!, ctx.locale)}
            </h2>
          )}
          {shown(props.intro) && (
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft" {...inline(ctx, "intro")} {...ph("Présentation")}>
              {tr(props.intro!, ctx.locale)}
            </p>
          )}
        </header>
      )}
      {kept.length ? (
        <EtapesView
          mode={mode}
          view={stepsView(props)}
          ratio={props.ratio}
          fallbackRatio={natural}
          start={compareStart(props)}
          items={items}
          pics={pics}
          styles={styles}
          edit={Boolean(ctx.edit)}
          uid={ctx.blockUid}
          texts={{ before: t("before"), after: t("after"), slider: t("slider"), prev: t("prev"), next: t("next"), views: t("views"), steps: t("steps"), view: t("view") }}
        />
      ) : (
        <span className="pe-media-empty" lang="fr">
          <span>{t("chooseImages")}</span>
        </span>
      )}
    </div>
  );
  if (ctx.cell) return body;
  return <section className="shell pt-[var(--section-gap)]">{body}</section>;
}
