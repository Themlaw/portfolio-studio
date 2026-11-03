/**
 * Pages spéciales (lot 89) : des pages que le site fait vivre lui-même, éditables comme les autres mais qui ne sont ni des pages du menu
 * ni des adresses à partager. Aujourd'hui une seule : « Page introuvable » (adresse réservée `_404`, voir src/proxy.ts), rendue avec le
 * statut 404. Convention : tout slug qui commence par « _ » (un slug de page ordinaire ne le peut pas, voir `slugProblem`). Pas de colonne
 * en base : le slug suffit. Module pur (aucun import) : lu par le serveur, l'admin (client) et les tests Node.
 */

/** Adresse réservée de la page 404 (jamais un slug de page ordinaire : « _ » interdit en tête). */
export const NOT_FOUND_SLUG = "_404";

/** Nom de la page spéciale 404 dans l'admin, par langue. */
export const NOT_FOUND_TITLE = { fr: "Page introuvable", en: "Page not found" } as const;

/** Phrase d'aide affichée à côté du badge « Page spéciale » (liste des pages). */
export const NOT_FOUND_HELP = "s'affiche quand un lien est cassé";

/** Ce slug (français ou anglais) désigne-t-il une page spéciale ? */
export const isSpecialSlug = (slug: unknown): boolean => typeof slug === "string" && slug.startsWith("_");

/** Cette page (slug localisé) est-elle spéciale ? Le slug français fait foi (les deux langues portent la même adresse). */
export const isSpecialPage = (page: { slug: { fr?: string; en?: string } }): boolean => isSpecialSlug(page.slug.fr) || isSpecialSlug(page.slug.en);

/** Types de bloc réservés à une page spéciale (absents du catalogue des autres pages, refusés à la publication). */
export const SPECIAL_ONLY_TYPES: readonly string[] = ["exit", "random-work"];
/** Types refusés sur une page spéciale (effets de bord : un formulaire n'a rien à faire sur une page d'erreur). */
export const NOT_ON_SPECIAL_TYPES: readonly string[] = ["contact", "contact-form"];
/** Types qu'une page spéciale garde obligatoirement (non supprimables) : le bloc qui ramène le visiteur sur le site. */
export const LOCKED_TYPES: readonly string[] = ["exit"];

/**
 * Premier type de bloc qui n'a pas sa place sur cette page (réservé à une page spéciale posé sur une page ordinaire, ou
 * interdit sur une page spéciale), ou null. Composants de conteneurs compris (le parcours est fait par l'appelant).
 */
export function scopeProblem(special: boolean, types: string[], label: (type: string) => string): string | null {
  for (const type of types) {
    if (!special && SPECIAL_ONLY_TYPES.includes(type)) return `« ${label(type)} » n'existe que sur la page « ${NOT_FOUND_TITLE.fr} » : retire-le de cette page.`;
    if (special && NOT_ON_SPECIAL_TYPES.includes(type)) return `« ${label(type)} » n'a pas sa place sur la page « ${NOT_FOUND_TITLE.fr} » : retire-le.`;
  }
  return null;
}
