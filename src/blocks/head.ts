/**
 * Titre de composant (lot 128, étape 1) : un titre et un sous-titre FACULTATIFS posés « dans » un composant (image, vidéo, planche libre, projet,
 * œuvre au hasard), sans bloc texte à part : donc sans nouvelle bande ni nouveau fond, dans la carte et le fond du composant (rendu par
 * `renderBlock`, src/blocks/BlockList.tsx). Module pur (aucun import de rendu) : lu par le rendu, l'éditeur de page (écriture) et les tests Node.
 *
 * Donnée : `props.head = { eyebrow?, title?, at? }`. Absente = rendu et HTML public d'avant, octet pour octet (aucune migration). `at` : absent =
 * au-dessus ; « below » = dessous ; « over » = sur l'image (image et planche libre seulement). La grille garde ses champs `eyebrow` / `title`
 * (un seul titre, jamais deux).
 *
 * Opérations de la pastille (`field-op`, src/blocks/optional-fields.ts) : « add-head » / « remove-head » (titre ; retirer retire la clé entière),
 * « add-head-eyebrow » / « remove-head-eyebrow » (sous-titre), « add-head-below » / « remove-head-below » (dessous / dessus), « add-head-over » /
 * « remove-head-over » (sur l'image). Case d'une grille JUSTIFIÉE : « add-cap-title » / « remove-cap-title » (le champ `captionTitle` qui existe déjà,
 * sous le média : un titre au-dessus fausserait les rangées justifiées).
 */
import { z } from "zod";

import type { AdminT } from "@/i18n/admin-lang";

import { FR_LABELS } from "./block-msg";
import { hasText, OPTIONAL_FIELDS } from "./optional-fields";

const localized = z.object({ fr: z.string().max(200), en: z.string().max(200) });
type Localized = z.infer<typeof localized>;

/** Types de composants qui reçoivent un `head` (la grille a déjà `eyebrow` / `title`, les blocs Texte et Titre SONT des titres). */
export const HEAD_TYPES = ["image", "video-single", "free-board", "project-board", "random-work"] as const;
/** Types dont le titre peut se poser SUR l'image. */
export const HEAD_OVER_TYPES = ["image", "free-board"] as const;

export const HeadSchema = z.object({
  eyebrow: localized.optional(),
  title: localized.optional(),
  at: z.enum(["below", "over"]).optional(),
});
export type Head = z.infer<typeof HeadSchema>;

export const isHeadType = (type: string): boolean => (HEAD_TYPES as readonly string[]).includes(type);
export const isOverType = (type: string): boolean => (HEAD_OVER_TYPES as readonly string[]).includes(type);

/** Lecture tolérante : une valeur illisible est ignorée (jamais le bloc). */
export function readHead(raw: unknown): Head | undefined {
  const parsed = HeadSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Y a-t-il quelque chose à montrer ? Public : un texte non vide ; toile : la clé suffit (un champ présent reste saisissable). */
export function headVisible(head: Head | undefined, edit: boolean): boolean {
  if (!head) return false;
  return edit ? head.title !== undefined || head.eyebrow !== undefined : hasText(head.title) || hasText(head.eyebrow);
}

/** Balise du titre d'après son niveau : h2 au premier niveau, h3 dedans, plafond h4 ; jamais h1 (réservé au titre de la page). */
export function headTag(level: number | undefined): "h2" | "h3" | "h4" {
  if (typeof level !== "number" || !Number.isFinite(level) || level <= 2) return "h2";
  return level === 3 ? "h3" : "h4";
}

/**
 * Niveau des composants d'un conteneur : +1 si le conteneur AFFICHE un titre (celui de la grille), inchangé sinon (un conteneur sans titre ne
 * consomme pas de niveau : jamais de saut). Un titre vide n'est pas affiché.
 */
export function childLevel(level: number, container: { type: string; props: unknown }): number {
  const props = (container.props ?? {}) as { title?: unknown; head?: { title?: unknown } };
  const shown = container.type === "grid" ? hasText(props.title) : isHeadType(container.type) && hasText(props.head?.title);
  return shown ? level + 1 : level;
}

export type HeadOpName =
  | "add-head"
  | "remove-head"
  | "add-head-eyebrow"
  | "remove-head-eyebrow"
  | "add-head-below"
  | "remove-head-below"
  | "add-head-over"
  | "remove-head-over";

const EMPTY: Localized = { fr: "", en: "" };

/**
 * Réglages après une opération de la pastille, ou null (refusée ou sans effet). `edit` : chemin du texte à mettre en saisie aussitôt.
 * Copie : l'original n'est pas modifié ; « Retirer le titre » retire la clé `head` entière (jamais de clé vide résiduelle).
 */
export function applyHeadOp(type: string, props: Record<string, unknown>, op: string, _where?: HeadWhere): { props: Record<string, unknown>; edit?: string } | null {
  void _where;
  if (!isHeadType(type) || !/^(add|remove)-head(-(eyebrow|below|over))?$/.test(op)) return null;
  const head = readHead(props.head);
  const next = { ...props };
  switch (op as HeadOpName) {
    case "add-head":
      if (head) return null;
      next.head = { title: { ...EMPTY } };
      return { props: next, edit: "head.title" };
    case "remove-head":
      if (!("head" in props)) return null;
      delete next.head;
      return { props: next };
    case "add-head-eyebrow":
      if (!head || head.eyebrow !== undefined) return null;
      next.head = { ...head, eyebrow: { ...EMPTY } };
      return { props: next, edit: "head.eyebrow" };
    case "remove-head-eyebrow": {
      if (!head || head.eyebrow === undefined) return null;
      const rest = { ...head };
      delete rest.eyebrow;
      next.head = rest;
      return { props: next };
    }
    case "add-head-below":
      if (!head || head.at === "below") return null;
      next.head = { ...head, at: "below" };
      return { props: next };
    case "add-head-over":
      if (!head || head.at === "over" || !isOverType(type)) return null;
      next.head = { ...head, at: "over" };
      return { props: next };
    case "remove-head-below":
    case "remove-head-over": {
      const want = op === "remove-head-below" ? "below" : "over";
      if (!head || head.at !== want) return null;
      const rest = { ...head };
      delete rest.at;
      next.head = rest;
      return { props: next };
    }
  }
  return null;
}

/** Où se trouve le composant : bloc de page, ou case d'une grille (justifiée ou non). */
export type HeadWhere = { cell: boolean; justified: boolean };

/**
 * Pastilles proposées sur la toile pour ce composant, dans l'ordre : sans titre, « + Titre » ; avec un titre, « Retirer le titre », le sous-titre,
 * dessous / dessus, sur l'image. Case d'une grille justifiée : seulement le titre de légende (`captionTitle`).
 * `t` (espace blockRegLabels, clés `headOps.*`) : langue de l'interface ; sans lui, le français.
 */
export function headOpsFor(type: string, props: Record<string, unknown>, where: HeadWhere, t?: AdminT): { op: string; label: string }[] {
  const L = (key: keyof typeof FR_LABELS.headOps) => (t ? t(`headOps.${key}`) : FR_LABELS.headOps[key]);
  if (!isHeadType(type)) return [];
  if (where.cell && where.justified) {
    if (!OPTIONAL_FIELDS[type]?.["cap-title"]) return [];
    return props.captionTitle !== undefined ? [{ op: "remove-cap-title", label: L("removeTitle") }] : [{ op: "add-cap-title", label: L("addTitle") }];
  }
  const head = readHead(props.head);
  if (!head) return [{ op: "add-head", label: L("addTitle") }];
  const out = [{ op: "remove-head", label: L("removeTitle") }];
  out.push(head.eyebrow === undefined ? { op: "add-head-eyebrow", label: L("addSubtitle") } : { op: "remove-head-eyebrow", label: L("removeSubtitle") });
  out.push(head.at === "below" ? { op: "remove-head-below", label: L("putAbove") } : { op: "add-head-below", label: L("putBelow") });
  if (isOverType(type) && !where.cell) out.push(head.at === "over" ? { op: "remove-head-over", label: L("outside") } : { op: "add-head-over", label: L("onImage") });
  return out;
}
