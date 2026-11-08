import Eyebrow from "@/components/Eyebrow";

import { hasText } from "./optional-fields";
import { headOpsFor, headTag, headVisible, type Head as HeadData, type HeadWhere } from "./head";
import { inline, tr, type BlockContext } from "./types";

/** Taille d'un titre de composant selon son niveau (clamp, comme les autres titres : téléphone sans débordement) ; la taille se règle ensuite avec « Aa ». */
const SIZE = {
  h2: "text-[clamp(1.75rem,4vw,2.75rem)]",
  h3: "text-[clamp(1.4rem,3vw,2.1rem)]",
  h4: "text-[clamp(1.15rem,2.2vw,1.6rem)]",
} as const;

/**
 * Titre et sous-titre d'un composant (lot 128). Rendu par `renderBlock` DANS la zone du composant (carte, fond, réglages `look`) : jamais de
 * bande ni de fond propre. Public : rien si le texte est vide (pas même l'enveloppe, donc aucune marge). Toile : un champ présent reste
 * saisissable (texte en place `head.title` / `head.eyebrow`, style via « Aa » dans `look.text`).
 *
 * `level` : niveau calculé (h2 au premier niveau, h3 dans une grille titrée…), jamais choisi ; le sous-titre est toujours un <p>.
 * `cell` : dans une case de grille (pas de largeur de page ni d'espace de section).
 * `scope` : repère de la portée « Tout le projet » (bloc Projet seulement, `data-pscope` de la planche du même bloc, lot 120) : le titre de la page
 * autour d'une planche se règle avec les titres de ce projet.
 */
export default function Head({ head, ctx, level, cell = false, scope }: { head: HeadData | undefined; ctx: BlockContext; level: number; cell?: boolean; scope?: string }) {
  const edit = Boolean(ctx.edit);
  if (!head || !headVisible(head, edit)) return null;
  const at = head.at ?? "above";
  const tag = headTag(level);
  const Tag = tag === "h2" ? "h2" : tag === "h3" ? "h3" : "h4";
  const showEyebrow = head.eyebrow !== undefined && (edit || hasText(head.eyebrow));
  const showTitle = head.title !== undefined && (edit || hasText(head.title));
  const frame = at === "over" || cell ? "" : at === "below" ? " shell" : " shell pt-[var(--section-gap)]";
  return (
    <div className={`comp-head${at === "over" ? " comp-head-over" : ""}${frame}`} data-at={at} {...(cell ? { "data-cell": "" } : {})} {...(scope ? { "data-pscope": scope, "data-head-board": "" } : {})}>
      {showEyebrow && (
        <Eyebrow {...inline(ctx, "head.eyebrow")} {...(edit ? { "data-placeholder": "Sous-titre" } : {})}>
          {head.eyebrow ? tr(head.eyebrow, ctx.locale) : ""}
        </Eyebrow>
      )}
      {showTitle && (
        <Tag className={`comp-head-title font-display break-words ${SIZE[tag]}${at === "over" ? "" : " text-ink"}${showEyebrow ? " mt-3" : ""}`} {...inline(ctx, "head.title")} {...(edit ? { "data-placeholder": "Titre" } : {})}>
          {head.title ? tr(head.title, ctx.locale) : ""}
        </Tag>
      )}
    </div>
  );
}

/**
 * Pastilles « + Titre » & co d'un composant, sur la toile seulement (jamais dans le HTML public). Une ancre sans hauteur posée avant le composant :
 * elle ne change ni les espaces ni l'ordre du contenu ; les boutons se montrent au survol du bloc (CSS : le bloc suivant l'ancre est survolé).
 */
export function HeadOps({ uid, type, props, ctx, where }: { uid: string; type: string; props: Record<string, unknown>; ctx: BlockContext; where: HeadWhere }) {
  if (!ctx.edit) return null;
  const ops = headOpsFor(type, props, where);
  if (!ops.length) return null;
  return (
    <div className={`pe-head-anchor${where.cell ? "" : " shell"}`} data-head-for={uid} data-head-state={headState(props, where)}>
      <div className="relative">
        <div className="pe-field-ops" {...(where.cell ? { "data-cell": "" } : {})}>
          {ops.map((o) => (
            <button key={o.op} type="button" className="pe-field-op" data-edit-field-op={o.op}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** « above » | « below » | « over » | « none » (rien, ou case justifiée) : lu par la barre de position du titre. */
function headState(props: Record<string, unknown>, where: HeadWhere): string {
  if (where.cell && where.justified) return "none";
  const head = props.head as HeadData | undefined;
  if (!head || typeof head !== "object") return "none";
  return head.at ?? "above";
}
