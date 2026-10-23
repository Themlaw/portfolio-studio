import { Children, type CSSProperties, type ReactNode } from "react";
import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import ViewerScope from "@/components/ViewerScope";
import { RATIO_VALUES } from "@/lib/images/formats";
import { parseRatio } from "@/lib/images/sizes";

import { FieldOps } from "./FieldOps";
import { getMedia } from "@/lib/media";

import { aloneFlags, freeCells, GRID_LAYOUTS, gridCells, isJustified, justifyRows, MAX_SPAN_H, MAX_SPAN_W } from "./grid-layouts";
import { hasText } from "./optional-fields";
import { MAX_CHILDREN } from "./tree";
import { BlockCaption, capHost, captionPart } from "./caption";
import { childBlock, inline, localized, localizedText, tr, type BlockContext } from "./types";


export const gridSchema = z.object({
  layout: z.enum(GRID_LAYOUTS).default("2"),
  /** « Sur mesure » (lot 31d) : colonnes (2 à 4), taille de chaque case (même ordre que `children`), gauche / droite inversés. */
  cols: z.number().int().min(2).max(4).optional(),
  spans: z.array(z.object({ w: z.number().int().min(1).max(MAX_SPAN_W), h: z.number().int().min(1).max(MAX_SPAN_H) })).max(MAX_CHILDREN).optional(),
  mirror: z.boolean().optional(),
  /** Rangées justifiées (lot 37b) : `true` = cette image occupe seule une rangée pleine largeur (même ordre que `children`). */
  alone: z.array(z.boolean()).max(MAX_CHILDREN).optional(),
  gap: z.enum(["none", "tight", "normal", "wide"]).default("normal"),
  align: z.enum(["start", "center", "end", "stretch"]).default("stretch"),
  /** Ratio imposé aux images des cellules (les vidéos gardent le 16:9). */
  ratio: z.enum(RATIO_VALUES).default("auto"),
  /** Marge au-dessus (espacement de section du thème), ou aucune. */
  top: z.enum(["gap", "none"]).default("gap"),
  eyebrow: localized.optional(),
  title: localized.optional(),
  /** Titre, Légende et Date facultatifs sous la grille entière (lot 39) ; chaque case a les siens (image, vidéo). */
  captionTitle: localizedText.optional(),
  caption: localizedText.optional(),
  captionDate: localizedText.optional(),
  /** Agrandir au clic (lot 44) : un clic sur une image ouvre la visionneuse, qui fait défiler toutes les images et vidéos de la grille en boucle. Absent = oui. */
  zoom: z.boolean().optional(),
  /**
   * Mémoire de « Afficher en : Images qui défilent » (lot 69, planche d'un projet) : les réglages de l'autre forme, gardés tels quels
   * pour le retour (src/blocks/grid-strip.ts). Jamais rendue ; absente sur une grille qui n'a pas été carrousel.
   */
  converted: z.record(z.string().max(40), z.unknown()).optional(),
  children: z.array(childBlock).max(MAX_CHILDREN).default([]),
});

/**
 * Grille (v0.13) : conteneur générique « flexbox » à la Elementor. Rendu par
 * classes sémantiques (`.block-grid`, data-layout/gap/align/ratio) réglées
 * dans globals.css avec les tokens d'espacement du thème. Sur la toile : une
 * place « + » par cellule libre du motif (jamais en public).
 */
export default async function GridBlock({ props, ctx, children }: { props: z.infer<typeof gridSchema>; ctx: BlockContext; children?: ReactNode }) {
  const cells = Children.toArray(children);
  // Repères des cases (numéros, places libres, « + Image »…) : la toile d'une page, ou celle d'une grille de planche (lot 31d).
  const canvas = Boolean(ctx.edit || ctx.gridCanvas);
  // « Automatique » (lot 31e) : la taille de chaque case suit le format réel de son média, lu à chaque rendu (page publiée,
  // brouillon, toile) : rien n'est figé case par case. Sans média connu (texte, image absente) : une case normale.
  const auto = props.layout === "auto";
  // Rangées justifiées (lots 37 et 37b) : « Automatique » et les agencements en colonnes simples, avec le format « Libre ».
  const justified = isJustified(props);
  const ratios = auto || justified
    ? await Promise.all(
        props.children.slice(0, cells.length).map(async (c) => {
          const id = typeof c.props.mediaId === "number" ? c.props.mediaId : undefined;
          const m = id ? await getMedia(id) : null;
          if (m?.width && m?.height) {
            const natural = m.width / m.height;
            // Format réellement affiché (lot 37) : cadrage libre posé sur l'image, sinon format propre à l'image.
            const look = c.props.look as { crop?: { mediaId?: { rect?: { w?: number; h?: number } } } } | undefined;
            const rect = look?.crop?.mediaId?.rect;
            if (rect && typeof rect.w === "number" && typeof rect.h === "number" && rect.w > 0 && rect.h > 0) return (natural * rect.w) / rect.h;
            const own = typeof c.props.ratio === "string" && c.props.ratio !== "auto" ? parseRatio(c.props.ratio) : null;
            return own ?? natural;
          }
          return m?.video ? 16 / 9 : null;
        }),
      )
    : undefined;
  const geometry = gridCells({ ...props, ratios }, cells.length);
  const free = canvas ? freeCells(props, cells.length) : [];
  // Largeur de chaque case proportionnelle à son format, même hauteur par rangée.
  const aloneNow = justified ? aloneFlags(props, cells.length) : undefined;
  const rows = justified ? justifyRows(ratios ?? [], geometry.cols, aloneNow) : [];
  // Places libres (toile seulement) : une colonne chacune, à la suite de la dernière rangée si elle est incomplète, sinon sur une
  // nouvelle rangée ; elles ne changent jamais la largeur des images (parité avec le public).
  if (justified) {
    let last = rows[rows.length - 1];
    let inRow = last ? rows.filter((c) => c.row === last!.row).length : 0;
    for (let i = 0; i < free.length; i++) {
      if (last && last.part && !last.full && inRow < geometry.cols) inRow++;
      else {
        last = { r: 1, k: 1, full: false, part: true, row: (last?.row ?? -1) + 1 };
        inRow = 1;
      }
      rows.push({ ...last, r: 1, k: 1, part: true });
    }
  }
  const justAttrs = (i: number): { style?: CSSProperties; [k: string]: unknown } => {
    const j = rows[i];
    if (!j) return {};
    return {
      ...(j.full ? { "data-jfull": "" } : {}),
      ...(i < cells.length && aloneNow?.[i] ? { "data-jalone": "" } : {}),
      ...(j.part ? { "data-jpart": "" } : {}),
      "data-jrow": j.row,
      style: { "--jr": j.r.toFixed(4), "--jk": j.k.toFixed(4) } as CSSProperties,
    };
  };
  // « Sur mesure » et « Automatique » : grille CSS à colonnes réglables, taille de chaque case en `--w` / `--h`.
  const custom = props.layout === "custom" || auto;
  // Colonnes et format de l'écran large en variables CSS : aussi pour les préréglages justifiés.
  const sized = custom || justified;
  const unit = parseRatio(props.ratio) ?? 4 / 3;
  /** Taille d'une case (vue d'un agencement « Sur mesure » ou d'une case sur deux rangées). */
  const sizeAttrs = (s: { w: number; h: number }) =>
    justified
      ? {}
      : {
          ...(s.h > 1 ? { "data-span-h": s.h } : {}),
          ...(custom ? { "data-w": s.w, style: { "--w": s.w, "--h": s.h } as CSSProperties } : {}),
        };
  // Étiquette et titre : des champs qui n'existent que s'ils ont été demandés (« + Ajouter … » sur la toile, lot 27).
  // Vide en public : aucune place ; sur la toile, un champ présent reste saisissable.
  const showEyebrow = props.eyebrow !== undefined && (ctx.edit || hasText(props.eyebrow));
  const showTitle = props.title !== undefined && (ctx.edit || hasText(props.title));
  if (!cells.length && !canvas && !showTitle && !showEyebrow) return null;
  // Cliquer pour agrandir (lot 44) : la grille entière est la zone de la visionneuse (public et Aperçu seulement).
  const zoom = props.zoom !== false && !canvas && !ctx.inlineEdit;
  const Section = zoom ? ViewerScope : "section";
  return (
    // Espace en bas (v0.13.1) : la grille se referme sur son propre pas (l'écart entre
    // cellules), comme une planche sur sa marge ; le bloc suivant ne colle plus.
    <Section {...(zoom ? { as: "section" as const } : {})} className={`block-grid-section shell ${props.top === "gap" ? "pt-[var(--section-gap)]" : ""}${ctx.edit ? " pe-field-host" : ""}`} {...capHost(ctx)}>
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
      <div
        className="block-grid"
        data-layout={props.layout}
        data-gap={props.gap}
        data-align={props.align}
        data-ratio={props.ratio}
        {...(sized ? { "data-cols": geometry.cols } : {})}
        {...(justified ? { "data-justify": "" } : {})}
        {...(geometry.mirror && !justified ? { "data-mirror": "" } : {})} /* Rangées justifiées : le miroir est ignoré, l'ordre visuel reste l'ordre de lecture (v0.27). */
        {...(sized ? { style: { "--cols": geometry.cols, "--grid-r": unit } as CSSProperties } : {})}
        {...(canvas ? { "data-edit-grid": "", "data-grid-cols": geometry.cols } : {})}
      >
        {cells.map((cell, i) => (
          <div
            key={i}
            className="block-grid-cell"
            {...sizeAttrs(geometry.cells[i])}
            {...justAttrs(i)}
            {...(canvas ? { "data-cell-index": i, "data-cell-w": geometry.cells[i].w, "data-cell-h": geometry.cells[i].h } : {})}
            {...(canvas && ctx.cellInfo?.[i]
              ? { "data-edit-cell": ctx.cellInfo[i].uid, "data-cell-type": ctx.cellInfo[i].type, ...(ctx.cellInfo[i].look ? { "data-edit-look": ctx.cellInfo[i].look } : {}) }
              : {})}
          >
            {cell}
          </div>
        ))}
        {free.map((size, i) => {
          const index = cells.length + i;
          return (
            <div
              key={`free-${i}`}
              className="block-grid-cell"
              data-edit-cell-free=""
              data-cell-index={index}
              lang="fr"
              {...sizeAttrs(size)}
              {...justAttrs(cells.length + i)}
              {...(canvas ? { style: { ...(custom && !justified ? { "--w": size.w, "--h": size.h } : {}), ...(justAttrs(cells.length + i).style ?? {}), "--free-r": justified ? 1 : Math.max(0.2, (unit * size.w) / size.h) } as CSSProperties } : {})}
            >
              <span className="pe-cell-free">
                {/* Le numéro de la case : les images la remplissent dans l'ordre (le repère n'existe que sur la toile). */}
                <span className="pe-cell-num" aria-hidden="true">
                  {index + 1}
                </span>
                {/* Deux choix clairs (lot 25) : une image ou une vidéo de la médiathèque (ou de l'ordinateur), posée dans cette case. */}
                <span className="pe-cell-media" role="group" aria-label={`Que mettre dans la case ${index + 1} ?`}>
                  {([["image", "Image"], ["video", "Vidéo"]] as const).map(([k, label]) => (
                    <button key={k} type="button" className="pe-cell-pick" data-edit-cell-media={k}>
                      <span aria-hidden="true">+</span> {label}
                    </button>
                  ))}
                </span>
                {ctx.edit && (
                  <>
                    <span className="pe-cell-or">ou du texte</span>
                    {/* Une rubrique de texte dans cette case, éditée aussitôt (lot 17c ; trois choix au lot 19a). */}
                    <span className="pe-cell-choices">
                      {([["text", "Texte"], ["title", "Titre"], ["title-text", "Titre + texte"]] as const).map(([k, label]) => (
                        <button key={k} type="button" className="pe-cell-text" data-edit-cell-text={k}>
                          {label}
                        </button>
                      ))}
                    </span>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {/* Sous la grille entière : mêmes champs que sous une image (lot 39). */}
      <BlockCaption ctx={ctx} title={captionPart(ctx, "captionTitle", props.captionTitle)} legend={captionPart(ctx, "caption", props.caption)} date={captionPart(ctx, "captionDate", props.captionDate)} />
    </Section>
  );
}
