/**
 * Regroupement des composants proposés à l'ajout (v0.19) : UNE source pour le panneau « Ajouter » et la fenêtre
 * « Ajouter une rubrique ». Chaque type du registre (src/blocks/registry.ts) porte son `group` et son `order`
 * (rang dans le groupe) ; les raccourcis (`presets`) ont leur propre `order`. Module pur (aucun import) : lu par
 * le registre, l'éditeur (client) et les tests Node.
 */

export const BLOCK_GROUPS = [
  { id: "text", label: "Texte" },
  { id: "projects", label: "Projets" },
  { id: "media", label: "Images et vidéos" },
  { id: "grids", label: "Grilles" },
  { id: "other", label: "Autres" },
] as const;

export type BlockGroup = (typeof BLOCK_GROUPS)[number]["id"];

export const GROUP_LABELS: Record<BlockGroup, string> = Object.fromEntries(BLOCK_GROUPS.map((g) => [g.id, g.label])) as Record<BlockGroup, string>;

export type Groupable = { group?: BlockGroup; order?: number; hidden?: boolean };

/** Entrées proposables rangées par groupe (ordre des groupes, puis `order`) ; groupes vides omis. */
export function groupEntries<T extends Groupable>(entries: T[]): { id: BlockGroup; label: string; entries: T[] }[] {
  return BLOCK_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
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

export type PickerGroup<T, S> = { id: BlockGroup; label: string; starters: S[]; entries: T[] };

/**
 * Ce que montrent le panneau « Ajouter » et la fenêtre « Ajouter une rubrique » : les groupes dans l'ordre de
 * BLOCK_GROUPS, chacun avec ses composants. Le groupe « Texte » porte les trois raccourcis (`starters`), pas les
 * types rich-text / section-title du registre. `query` filtre par nom et description (sans accents ni casse) ;
 * un groupe sans résultat est omis.
 */
export function pickerGroups<T extends Groupable & { type: string; label: string; description: string }, S extends { label: string; description: string }>(
  catalog: T[],
  starters: S[],
  query = "",
): PickerGroup<T, S>[] {
  const groups = groupEntries(catalog.filter((c) => !STARTER_BLOCKS.includes(c.type)));
  return BLOCK_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    starters: g.id === "text" ? starters.filter((s) => matchesSearch(s, query)) : [],
    entries: (groups.find((x) => x.id === g.id)?.entries ?? []).filter((e) => matchesSearch(e, query)),
  })).filter((g) => g.starters.length > 0 || g.entries.length > 0);
}
