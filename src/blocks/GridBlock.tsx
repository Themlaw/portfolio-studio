import { Children, type ReactNode } from "react";
import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";

import { GRID_LAYOUTS, GRID_PATTERN } from "./grid-layouts";
import { MAX_CHILDREN } from "./tree";
import { childBlock, inline, localized, tr, type BlockContext } from "./types";


export const gridSchema = z.object({
  layout: z.enum(GRID_LAYOUTS).default("2"),
  gap: z.enum(["tight", "normal", "wide"]).default("normal"),
  align: z.enum(["start", "center", "end", "stretch"]).default("stretch"),
  /** Ratio imposé aux images des cellules (les vidéos gardent le 16:9). */
  ratio: z.enum(["auto", "16:9", "1:1", "4:5"]).default("auto"),
  /** Marge au-dessus (espacement de section du thème), ou aucune. */
  top: z.enum(["gap", "none"]).default("gap"),
  eyebrow: localized.optional(),
  title: localized.optional(),
  children: z.array(childBlock).max(MAX_CHILDREN).default([]),
});

/**
 * Grille (v0.13) : conteneur générique « flexbox » à la Elementor. Rendu par
 * classes sémantiques (`.block-grid`, data-layout/gap/align/ratio) réglées
 * dans globals.css avec les tokens d'espacement du thème. Sur la toile : une
 * place « + » par cellule libre du motif (jamais en public).
 */
export default function GridBlock({ props, ctx, children }: { props: z.infer<typeof gridSchema>; ctx: BlockContext; children?: ReactNode }) {
  const cells = Children.toArray(children);
  const pattern = GRID_PATTERN[props.layout];
  const free = ctx.edit ? (cells.length === 0 ? pattern : (pattern - (cells.length % pattern)) % pattern) : 0;
  const hasHeading = Boolean(props.eyebrow || props.title || ctx.edit);
  if (!cells.length && !ctx.edit && !props.title && !props.eyebrow) return null;
  return (
    <section className={`shell ${props.top === "gap" ? "pt-[var(--section-gap)]" : ""}`}>
      {hasHeading && (props.eyebrow || props.title || ctx.edit) && (
        <>
          {(props.eyebrow || ctx.edit) && (
            <Eyebrow {...inline(ctx, "eyebrow")} {...(ctx.edit ? { "data-placeholder": "Étiquette (facultative)" } : {})}>
              {props.eyebrow ? tr(props.eyebrow, ctx.locale) : ""}
            </Eyebrow>
          )}
          {(props.title || ctx.edit) && (
            <h2
              className={`mt-3 font-display text-[clamp(1.75rem,4vw,2.75rem)] text-ink ${props.title ? "mb-8" : ""}`}
              {...inline(ctx, "title")}
              {...(ctx.edit ? { "data-placeholder": "Titre (facultatif)" } : {})}
            >
              {props.title ? tr(props.title, ctx.locale) : ""}
            </h2>
          )}
        </>
      )}
      <div className="block-grid" data-layout={props.layout} data-gap={props.gap} data-align={props.align} data-ratio={props.ratio}>
        {cells.map((cell, i) => (
          <div key={i} className="block-grid-cell">
            {cell}
          </div>
        ))}
        {Array.from({ length: free }, (_, i) => (
          <div key={`free-${i}`} className="block-grid-cell" data-edit-cell-free="" lang="fr">
            <span className="pe-cell-free" aria-hidden="true">
              +
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
