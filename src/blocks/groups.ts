/**
 * Regroupement des composants proposés à l'ajout (v0.19) : UNE source pour le panneau « Ajouter » et la fenêtre
 * « Ajouter une rubrique ». Chaque type du registre (src/blocks/registry.ts) porte son `group` et son `order`
 * (rang dans le groupe) ; les raccourcis (`presets`) ont leur propre `order`. Module pur (aucun import) : lu par
 * le registre, l'éditeur (client) et les tests Node.
 */

import type { AdminT } from "@/i18n/admin-lang";

import { FR_LABELS } from "./block-msg";

/** `label` : français ; dans l'interface, les groupes sont traduits par `groupLabel(id, t)` (espace blockRegLabels). */
export const BLOCK_GROUPS = [
  { id: "text", label: FR_LABELS.group.text },
  { id: "projects", label: FR_LABELS.group.projects },
  { id: "media", label: FR_LABELS.group.media },
  { id: "grids", label: FR_LABELS.group.grids },
  { id: "other", label: FR_LABELS.group.other },
] as const;

export type BlockGroup = (typeof BLOCK_GROUPS)[number]["id"];

/** Libellé d'un groupe dans la langue de `t` (espace blockRegLabels) ; sans `t`, le français. */
export const groupLabel = (id: BlockGroup, t?: AdminT): string => (t ? t(`group.${id}`) : FR_LABELS.group[id]);

export const GROUP_LABELS: Record<BlockGroup, string> = Object.fromEntries(BLOCK_GROUPS.map((g) => [g.id, g.label])) as Record<BlockGroup, string>;

export type Groupable = { group?: BlockGroup; order?: number; hidden?: boolean };

/** Entrées proposables rangées par groupe (ordre des groupes, puis `order`) ; groupes vides omis. */
export function groupEntries<T extends Groupable>(entries: T[], t?: AdminT): { id: BlockGroup; label: string; entries: T[] }[] {
  return BLOCK_GROUPS.map((g) => ({
    id: g.id,
    label: groupLabel(g.id, t),
    entries: entries.filter((e) => !e.hidden && e.group === g.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  })).filter((g) => g.entries.length > 0);
}

/** Sans accents ni casse, espaces compactés (recherche d'un composant). */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tous les mots de la requête figurent dans le nom ou la description (vide : tout correspond). */
export function matchesSearch(entry: { label: string; description: string }, query: string): boolean {
  const words = foldText(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = foldText(`${entry.label} ${entry.description}`);
  return words.every((w) => hay.includes(w));
}

/** Types du groupe « Texte » proposés par les trois raccourcis (Texte, Titre, Titre + texte), pas comme cartes. */
export const STARTER_BLOCKS: readonly string[] = ["rich-text", "section-title"];

/** Une carte du panneau : le type, et ses modèles de départ (puces « Avec 3 images »…), jamais des cartes à part (lot 27). */
export type PickerEntry<T> = T & { models: T[] };
export type PickerGroup<T, S> = { id: BlockGroup; label: string; starters: S[]; entries: PickerEntry<T>[] };

/**
 * Ce que montrent le panneau « Ajouter » et la fenêtre « Ajouter une rubrique » : les groupes dans l'ordre de
 * BLOCK_GROUPS, chacun avec ses composants. Le groupe « Texte » porte les trois raccourcis (`starters`), pas les
 * types rich-text / section-title du registre. `query` filtre par nom et description (sans accents ni casse) ;
 * un groupe sans résultat est omis.
 */
export function pickerGroups<T extends Groupable & { type: string; label: string; description: string; preset?: boolean }, S extends { label: string; description: string }>(
  catalog: T[],
  starters: S[],
  query = "",
  t?: AdminT,
): PickerGroup<T, S>[] {
  // Les modèles de départ d'un type (`preset`) se rangent sous sa carte : « Grille » propose « Avec 3 images », « Avec des vidéos »…
  const models = (type: string) => catalog.filter((c) => c.preset && c.type === type && !c.hidden).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const groups = groupEntries(catalog.filter((c) => !STARTER_BLOCKS.includes(c.type) && !c.preset), t);
  return BLOCK_GROUPS.map((g) => ({
    id: g.id,
    label: groupLabel(g.id, t),
    starters: g.id === "text" ? starters.filter((s) => matchesSearch(s, query)) : [],
    entries: (groups.find((x) => x.id === g.id)?.entries ?? [])
      .map((e) => ({ ...e, models: models(e.type) }))
      // Un type correspond à la recherche par son nom, sa description ou celle d'un de ses modèles.
      .filter((e) => matchesSearch(e, query) || e.models.some((m) => matchesSearch(m, query))),
  })).filter((g) => g.starters.length > 0 || g.entries.length > 0);
}
