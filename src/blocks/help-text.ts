/**
 * Textes d'aide d'un bloc Texte neuf (lot 17c, « Ajouter un bloc ») : posés dans le bloc,
 * sélectionnés à l'ouverture de l'édition en place pour être remplacés d'une frappe. Posé dans la langue
 * éditée seulement (l'autre reste vide, comme tout texte neuf). Module pur (aucun import) : lu par le
 * registre (la publication refuse un texte d'aide resté tel quel), l'éditeur et les tests.
 */

export const HELP_TEXT = {
  paragraph: { fr: "Écris ton texte ici.", en: "Write your text here." },
  title: { fr: "Titre du bloc", en: "Section title" },
} as const;

/**
 * Rubriques de texte proposées en premier (lot 19a). Trois choix nets : « Texte » (un paragraphe, rien d'autre),
 * « Titre » (un titre seul, étiquette facultative) et « Titre + texte ». `block` : type du bloc créé ; `props` :
 * ses propriétés de départ (un champ absent n'existe pas : ni place, ni texte d'aide) ; `edit` : champ édité d'emblée.
 */
export const TEXT_STARTERS = {
  text: { label: "Texte", description: "Un paragraphe seul : ni titre, ni étiquette.", block: "rich-text", props: { paragraphs: [HELP_TEXT.paragraph] }, edit: "paragraphs.0" },
  title: { label: "Titre", description: "Un titre seul, avec une étiquette facultative.", block: "section-title", props: { title: HELP_TEXT.title }, edit: "title" },
  "title-text": {
    label: "Titre + texte",
    description: "Un titre et un paragraphe dessous.",
    block: "rich-text",
    props: { title: HELP_TEXT.title, paragraphs: [HELP_TEXT.paragraph] },
    edit: "title",
  },
} as const;
export type TextStarter = keyof typeof TEXT_STARTERS;
/** Les trois raccourcis en liste (panneau « Ajouter », fenêtre « Ajouter une rubrique »). */
export const STARTER_LIST = (Object.keys(TEXT_STARTERS) as TextStarter[]).map((key) => ({ key, ...TEXT_STARTERS[key] }));

type Localized = { fr?: unknown; en?: unknown } | undefined;

/** Anciens textes d'aide (avant le vocabulaire du lot 75, « rubrique » -> « bloc ») : encore enregistrés dans des brouillons, ils restent reconnus comme textes d'exemple. */
const OLD_HELP_FR: readonly string[] = ["Titre de la rubrique"];

/** Le texte est-il encore le texte d'aide (dans l'une des deux langues, ou l'ancienne formulation) ? */
export function isHelpText(value: Localized, help: { fr: string; en: string }): boolean {
  return Boolean(value) && (value!.fr === help.fr || value!.en === help.en || (help.fr === HELP_TEXT.title.fr && typeof value!.fr === "string" && OLD_HELP_FR.includes(value!.fr)));
}

/** Message de publication si un texte d'aide est resté tel quel, sinon null. */
export function helpTextProblem(props: Record<string, unknown>): string | null {
  const title = props.title as Localized;
  const paragraphs = Array.isArray(props.paragraphs) ? (props.paragraphs as Localized[]) : [];
  if (isHelpText(title, HELP_TEXT.title) || paragraphs.some((p) => isHelpText(p, HELP_TEXT.paragraph))) {
    return "Remplace le texte d'exemple de ce bloc Texte (ou supprime-le).";
  }
  return null;
}

/** Idem pour un bloc Titre : son titre est resté le texte d'aide (un titre lié au projet n'a pas de texte propre). */
export function titleHelpProblem(props: Record<string, unknown>): string | null {
  if (props.linked) return null;
  return isHelpText(props.title as Localized, HELP_TEXT.title) ? "Remplace le texte d'exemple de ce titre (ou supprime-le)." : null;
}
