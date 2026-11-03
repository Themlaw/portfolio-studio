import type { CSSProperties } from "react";

import { resolveTextStyle, TextStyleSchema, textStyleObject, type TextStyle } from "@/lib/look";
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

/** Style d'une légende : celui du texte (priorité) par-dessus celui du projet, en CSS en ligne. */
export function captionCss(project: TextStyle | undefined, local: TextStyle | undefined, palette?: CardPalette): CSSProperties | undefined {
  if (!project && !local) return undefined;
  return textStyleObject(resolveTextStyle(project, local), palette) as CSSProperties | undefined;
}
