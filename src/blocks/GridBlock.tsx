import { Children, type ReactNode } from "react";
import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import { RATIO_VALUES } from "@/lib/images/formats";

import { FieldOps } from "./FieldOps";
import { GRID_LAYOUTS, GRID_PATTERN } from "./grid-layouts";
import { hasText } from "./optional-fields";
import { MAX_CHILDREN } from "./tree";
import { childBlock, inline, localized, tr, type BlockContext } from "./types";


export const gridSchema = z.object({
  layout: z.enum(GRID_LAYOUTS).default("2"),
  gap: z.enum(["tight", "normal", "wide"]).default("normal"),
  align: z.enum(["start", "center", "end", "stretch"]).default("stretch"),
  /** Ratio imposé aux images des cellules (les vidéos gardent le 16:9). */
  ratio: z.enum(RATIO_VALUES).default("auto"),
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
  // Étiquette et titre : des champs qui n'existent que s'ils ont été demandés (« + Ajouter … » sur la toile, lot 27).
  // Vide en public : aucune place ; sur la toile, un champ présent reste saisissable.
  const showEyebrow = props.eyebrow !== undefined && (ctx.edit || hasText(props.eyebrow));
  const showTitle = props.title !== undefined && (ctx.edit || hasText(props.title));
  if (!cells.length && !ctx.edit && !showTitle && !showEyebrow) return null;
  return (
    // Espace en bas (v0.13.1) : la grille se referme sur son propre pas (l'écart entre
    // cellules), comme une planche sur sa marge ; le bloc suivant ne colle plus.
    <section className={`block-grid-section shell ${props.top === "gap" ? "pt-[var(--section-gap)]" : ""}${ctx.edit ? " pe-field-host" : ""}`}>
      {ctx.edit && (
        <div className="relative">
          <FieldOps ctx={ctx} type="grid" props={props} />
        </div>
      )}
      {showEyebrow && (
        <Eyebrow {...inline(ctx, "eyebrow")} {...(ctx.edit ? { "data-placeholder": "Étiquette" } : {})}>
          {tr(props.eyebrow!, ctx.locale)}
        </Eyebrow>
      )}
      {showTitle && (
        <h2
          className={`mt-3 font-display text-[clamp(1.75rem,4vw,2.75rem)] text-ink ${hasText(props.title) ? "mb-8" : ""}`}
          {...inline(ctx, "title")}
          {...(ctx.edit ? { "data-placeholder": "Titre" } : {})}
        >
          {tr(props.title!, ctx.locale)}
        </h2>
      )}
      <div className="block-grid" data-layout={props.layout} data-gap={props.gap} data-align={props.align} data-ratio={props.ratio}>
        {cells.map((cell, i) => (
          <div key={i} className="block-grid-cell">
            {cell}
          </div>
        ))}
        {Array.from({ length: free }, (_, i) => (
          <div key={`free-${i}`} className="block-grid-cell" data-edit-cell-free="" lang="fr">
            <span className="pe-cell-free">
              {/* Deux choix clairs (lot 25) : une image ou une vidéo de la médiathèque (ou de l'ordinateur), posée dans cette case. */}
              <span className="pe-cell-media" role="group" aria-label="Que mettre dans cette case ?">
                {([["image", "Image"], ["video", "Vidéo"]] as const).map(([k, label]) => (
                  <button key={k} type="button" className="pe-cell-pick" data-edit-cell-media={k}>
                    <span aria-hidden="true">+</span> {label}
                  </button>
                ))}
              </span>
              <span className="pe-cell-or">ou du texte</span>
              {/* Une rubrique de texte dans cette case, éditée aussitôt (lot 17c ; trois choix au lot 19a). */}
              <span className="pe-cell-choices">
                {([["text", "Texte"], ["title", "Titre"], ["title-text", "Titre + texte"]] as const).map(([k, label]) => (
                  <button key={k} type="button" className="pe-cell-text" data-edit-cell-text={k}>
                    {label}
                  </button>
                ))}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
