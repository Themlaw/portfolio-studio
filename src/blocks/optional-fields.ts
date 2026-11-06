/**
 * Champs facultatifs des blocs (v0.20, lot 27) : ce que « + Ajouter … » / « Retirer … » crée ou retire depuis la
 * toile, comme le titre d'un bloc Texte depuis la v0.18. Un champ n'existe que s'il a été demandé : sans sa clé, il
 * n'occupe aucune place, sur la toile comme en public, et n'affiche aucun texte d'aide. Module pur (aucun import) :
 * lu par la toile (rendu des boutons), l'éditeur de page (écriture) et les tests Node.
 *
 * Lot 128 : « head », « head-eyebrow », « head-below », « head-over » sont les opérations du titre de composant (src/blocks/head.ts, écrites par
 * l'éditeur de page : `props.head` est un objet, pas un texte localisé) ; « cap-title » ajoute le titre de légende (`captionTitle`) d'une case de grille justifiée.
 *
 * Clé d'une opération (`field-op`, src/lib/edit/protocol.ts) : « add-<champ> » / « remove-<champ> » ; `<champ>` est le
 * nom court d'ici, `prop` la clé réelle dans les réglages du bloc.
 *  - kind « text » : texte localisé { fr, en }, absent = pas de champ ;
 *  - kind « hide » : drapeau inversé (`prop: false` = retiré, clé absente = affiché), pour ce qui existait déjà.
 */

export type FieldOpDef = { prop: string; kind: "text" | "hide"; add: string; remove: string };

/** Noms courts des champs facultatifs gérés ici (les quatre premiers : blocs Texte et Titre, lots 19a et 22). */
export const FIELD_OP_NAMES = ["title", "eyebrow", "intro", "counts", "cta", "caption", "contact-eyebrow", "contact-label", "social-eyebrow", "name", "head", "head-eyebrow", "head-below", "head-over", "cap-title"] as const;
export type FieldOpName = (typeof FIELD_OP_NAMES)[number];

/** Champs facultatifs par type de bloc (hors Texte et Titre, qui ont leur propre règle dans l'éditeur de page). */
export const OPTIONAL_FIELDS: Record<string, Partial<Record<FieldOpName, FieldOpDef>>> = {
  grid: {
    eyebrow: { prop: "eyebrow", kind: "text", add: "+ Ajouter une étiquette", remove: "Retirer l'étiquette" },
    title: { prop: "title", kind: "text", add: "+ Ajouter un titre", remove: "Retirer le titre" },
  },
  contact: {
    eyebrow: { prop: "eyebrow", kind: "text", add: "+ Ajouter une étiquette", remove: "Retirer l'étiquette" },
    title: { prop: "title", kind: "text", add: "+ Ajouter un titre", remove: "Retirer le titre" },
    intro: { prop: "intro", kind: "text", add: "+ Ajouter une présentation", remove: "Retirer la présentation" },
    cta: { prop: "cta", kind: "text", add: "+ Ajouter un bouton e-mail", remove: "Retirer le bouton" },
  },
  profile: {
    eyebrow: { prop: "eyebrow", kind: "text", add: "+ Ajouter une étiquette", remove: "Retirer l'étiquette" },
    caption: { prop: "portraitCaption", kind: "text", add: "+ Ajouter une légende", remove: "Retirer la légende" },
    name: { prop: "showName", kind: "hide", add: "+ Ajouter ton nom", remove: "Retirer ton nom" },
    "contact-eyebrow": { prop: "contactEyebrow", kind: "text", add: "+ Ajouter l'étiquette du contact", remove: "Retirer l'étiquette du contact" },
    "contact-label": { prop: "contactLabel", kind: "text", add: "+ Ajouter un bouton e-mail", remove: "Retirer le bouton e-mail" },
    "social-eyebrow": { prop: "socialEyebrow", kind: "text", add: "+ Ajouter l'étiquette des réseaux", remove: "Retirer l'étiquette des réseaux" },
  },
  cv: {
    eyebrow: { prop: "eyebrow", kind: "text", add: "+ Ajouter une étiquette", remove: "Retirer l'étiquette" },
    title: { prop: "title", kind: "text", add: "+ Ajouter un titre", remove: "Retirer le titre" },
    intro: { prop: "intro", kind: "text", add: "+ Ajouter une présentation", remove: "Retirer la présentation" },
  },
  // Lot 128 : case d'une grille justifiée, le titre est la légende « titre » du média (sous lui, la géométrie des rangées ne bouge pas).
  image: { "cap-title": { prop: "captionTitle", kind: "text", add: "+ Titre", remove: "Retirer le titre" } },
  "video-single": { "cap-title": { prop: "captionTitle", kind: "text", add: "+ Titre", remove: "Retirer le titre" } },
  "free-board": { "cap-title": { prop: "captionTitle", kind: "text", add: "+ Titre", remove: "Retirer le titre" } },
};

/** Définition d'un champ facultatif d'un type de bloc, ou undefined (pas de `dict[key]` : « constructor », « __proto__ »…). */
export function fieldOpDef(type: string, field: string): FieldOpDef | undefined {
  if (!Object.hasOwn(OPTIONAL_FIELDS, type)) return undefined;
  const fields = OPTIONAL_FIELDS[type];
  return Object.hasOwn(fields, field) ? fields[field as FieldOpName] : undefined;
}

/** Le champ est-il présent dans ces réglages ? */
export function hasOptionalField(def: FieldOpDef, props: Record<string, unknown>): boolean {
  return def.kind === "hide" ? props[def.prop] !== false : props[def.prop] !== undefined;
}

/** Réglages après « add » ou « remove » du champ (copie). */
export function withOptionalField(def: FieldOpDef, props: Record<string, unknown>, add: boolean): Record<string, unknown> {
  const next = { ...props };
  if (def.kind === "hide") {
    if (add) delete next[def.prop];
    else next[def.prop] = false;
  } else if (add) next[def.prop] = { fr: "", en: "" };
  else delete next[def.prop];
  return next;
}

/** Texte localisé non vide dans au moins une langue (un champ vide n'occupe aucune place en public). */
export function hasText(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const t = v as { fr?: unknown; en?: unknown };
  return (typeof t.fr === "string" && t.fr.trim() !== "") || (typeof t.en === "string" && t.en.trim() !== "");
}
