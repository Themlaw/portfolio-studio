/**
 * Règles des tags, partagées par le client (combobox) et le serveur :
 * libellé nettoyé (espaces réduits), clé de comparaison (minuscules, sans
 * accents), bornes, classement des suggestions (testés par scripts/test-tags.mjs).
 */
import { matchSorter, rankings } from "match-sorter";

export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_MEDIA = 20;
export const MAX_TAGS = 500;

/**
 * Caractères invisibles retirés des libellés : contrôles (Cc), formats (Cf :
 * zéro-largeur, bidi, BOM…), remplissages hangul (U+115F, U+1160, U+3164) et
 * blanc braille (U+2800), qui afficheraient un tag « vide » ou trompeur.
 */
const FORMATS = new RegExp(`[\\p{Cf}${String.fromCharCode(0x115f, 0x1160, 0x3164, 0x2800)}]`, "gu");
const CONTROLS = /\p{Cc}/gu;

/** Libellé tel qu'affiché : formes de compatibilité unifiées (NFKC), invisibles retirés, espaces réduits. */
export function cleanTagLabel(input: string): string {
  return input
    .normalize("NFKC")
    // Formats d'abord (le BOM U+FEFF compte comme une espace pour \s), puis
    // espaces (tabulations, retours à la ligne) réduites, puis contrôles restants.
    .replace(FORMATS, "")
    .replace(/\s+/g, " ")
    .replace(CONTROLS, "")
    .trim();
}

/** Clé de comparaison : « Décor  Nuit », « decor nuit » et « ＤÉＣＯＲ nuit » sont le même tag. */
export function tagKey(input: string): string {
  return cleanTagLabel(input)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/ß/g, "ss")
    .normalize("NFKC");
}

/** Message d'erreur d'un libellé, ou null s'il convient. */
export function tagLabelProblem(input: string): string | null {
  const label = cleanTagLabel(input);
  if (!label) return "Un tag ne peut pas être vide.";
  // Que des accents ou des signes combinants : clé vide, tag introuvable ensuite.
  if (!tagKey(label)) return "Un tag doit contenir au moins une lettre, un chiffre ou un signe visible.";
  if ([...label].length > MAX_TAG_LENGTH) return `Un tag fait ${MAX_TAG_LENGTH} caractères au plus.`;
  return null;
}

/**
 * Classement des suggestions : exact, puis début, puis début de mot, puis
 * contient (match-sorter), sans accents ni casse ; à rang égal, les plus
 * utilisés d'abord, puis l'ordre alphabétique. Saisie vide : tous, les plus
 * utilisés d'abord.
 */
export type TagOption = { label: string; count?: number };

export function rankTags(options: TagOption[], query: string): TagOption[] {
  const q = tagKey(query);
  if (!q) return [...options].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label, "fr"));
  return matchSorter(options, q, {
    keys: [(o) => tagKey(o.label)],
    threshold: rankings.CONTAINS,
    baseSort: (a, b) => (b.item.count ?? 0) - (a.item.count ?? 0) || a.item.label.localeCompare(b.item.label, "fr"),
  });
}
