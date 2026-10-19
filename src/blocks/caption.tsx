import MediaCaption, { type CaptionPart } from "@/components/MediaCaption";

import { inline, tr, type BlockContext, type Localized } from "./types";

/** Les trois textes facultatifs d'un média (lot 39), tels que les réglages d'un composant les portent. */
export type CaptionProps = { captionTitle?: Localized; caption?: Localized; captionDate?: Localized };

/** Chemins déclarés `inline` (registre) par les composants qui ont cette légende. */
export const CAPTION_INLINE = ["captionTitle", "caption", "captionDate"];

/** Marque de l'enveloppe (média + légende) : les repères gris des champs vides n'y apparaissent qu'au survol ou au choix. */
export function capHost(ctx: BlockContext): { "data-cap-host"?: string } {
  return ctx.edit || ctx.inlineEdit ? { "data-cap-host": "" } : {};
}

/** Un champ d'un composant : texte du langage courant, repère de saisie en place et style local (barre typographique). */
export function captionPart(ctx: BlockContext, path: string, value: Localized | undefined): CaptionPart {
  const { style, ...attrs } = inline(ctx, path);
  return { text: value ? tr(value, ctx.locale) : "", attrs, style };
}

/** Titre / Légende / Date d'un composant (image, vidéo, grille). `legend` : chemin de la légende (`caption` ou `description`). */
export function BlockCaption({ ctx, title, legend, date, className, as }: { ctx: BlockContext; title: CaptionPart; legend: CaptionPart; date: CaptionPart; className?: string; as?: "div" | "figcaption" }) {
  return <MediaCaption title={title} legend={legend} date={date} edit={Boolean(ctx.edit || ctx.inlineEdit)} className={className} as={as} />;
}
