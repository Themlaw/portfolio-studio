import type { CSSProperties } from "react";

import { PROJECT_CAPTION_KEYS, resolveTextStyle, TextStyleSchema, textStyleObject, type Look, type TextStyle } from "@/lib/look";
import type { CardPalette } from "@/themes/surface";

import { CAPTION_STYLE_FIELDS, projectCaptionStyle, type BoardItem, type CaptionStyleField } from "./board-layout";

/** Style des légendes d'un projet (lot 98), champ par champ, relu avec le schéma (un champ illisible est ignoré). */
export type CaptionStyles = Partial<Record<CaptionStyleField, TextStyle>>;
export type CaptionCss = Partial<Record<CaptionStyleField, CSSProperties>>;

export function captionStylesOf(layout: readonly BoardItem[] | undefined): CaptionStyles | undefined {
  const raw = projectCaptionStyle(layout);
  if (!raw) return undefined;
  const out: CaptionStyles = {};
  for (const f of CAPTION_STYLE_FIELDS) {
    const parsed = raw[f] ? TextStyleSchema.safeParse(raw[f]) : null;
    if (parsed?.success && Object.keys(parsed.data).length) out[f] = parsed.data;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Style des légendes d'une planche (lot 120) : celui de la portée « Tout le projet » (`look.projectText` du bloc, champ par champ)
 * par-dessus l'ancien style du projet rangé dans sa suite (lot 98, relu tel quel : les anciennes données rendent à l'identique).
 */
export function projectCaptionStyles(layout: readonly BoardItem[] | undefined, projectText: Look["projectText"] | undefined): CaptionStyles | undefined {
  const out: CaptionStyles = { ...(captionStylesOf(layout) ?? {}) };
  for (const f of CAPTION_STYLE_FIELDS) {
    const own = projectText?.[PROJECT_CAPTION_KEYS[f]];
    if (own && Object.keys(own).length) out[f] = own;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Style d'une légende : celui du texte (priorité) par-dessus celui du projet, en CSS en ligne. */
export function captionCss(project: TextStyle | undefined, local: TextStyle | undefined, palette?: CardPalette): CSSProperties | undefined {
  if (!project && !local) return undefined;
  return textStyleObject(resolveTextStyle(project, local), palette) as CSSProperties | undefined;
}
