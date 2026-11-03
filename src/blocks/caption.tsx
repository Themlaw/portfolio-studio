import MediaCaption, { type CaptionPart } from "@/components/MediaCaption";

import { captionFieldOf } from "./board-layout";
import { captionCss } from "./caption-style";
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
  const { style: own, ...attrs } = inline(ctx, path);
  // Style des légendes du PROJET (lot 98) : derrière le style propre de cette légende ("Ce texte"), devant celui du site.
  const field = ctx.captionStyle ? captionFieldOf(path) : null;
  const project = field ? ctx.captionStyle?.[field] : undefined;
  const mine = ctx.look?.text && Object.hasOwn(ctx.look.text, path) ? ctx.look.text[path] : undefined;
  const style = project ? captionCss(project, mine, ctx.palette) : own;
  // Légende réglée seule : l'aperçu du style du projet (toile) ne la touche pas.
  return { text: value ? tr(value, ctx.locale) : "", attrs: ctx.captionStyle && mine && own ? { ...attrs, "data-cap-local": "" } : attrs, style };
}

/** Titre / Légende / Date d'un composant (image, vidéo, grille). `legend` : chemin de la légende (`caption` ou `description`). */
export function BlockCaption({ ctx, title, legend, date, className, as }: { ctx: BlockContext; title: CaptionPart; legend: CaptionPart; date: CaptionPart; className?: string; as?: "div" | "figcaption" }) {
  return <MediaCaption title={title} legend={legend} date={date} edit={Boolean(ctx.edit || ctx.inlineEdit)} className={className} as={as} />;
}
