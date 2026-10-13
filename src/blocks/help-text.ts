/**
 * Textes d'aide d'une rubrique Texte neuve (lot 17c, « Ajouter une rubrique ») : posés dans le bloc,
 * sélectionnés à l'ouverture de l'édition en place pour être remplacés d'une frappe. Posé dans la langue
 * éditée seulement (l'autre reste vide, comme tout texte neuf). Module pur (aucun import) : lu par le
 * registre (la publication refuse un texte d'aide resté tel quel), l'éditeur et les tests.
 */

export const HELP_TEXT = {
  paragraph: { fr: "Écris ton texte ici.", en: "Write your text here." },
  title: { fr: "Titre de la rubrique", en: "Section title" },
} as const;

/** Rubriques de texte proposées en premier : propriétés du bloc `rich-text` neuf et champ à éditer d'emblée. */
export const TEXT_STARTERS = {
  text: { label: "Texte", description: "Quelques lignes de texte, sans titre.", props: { title: undefined, paragraphs: [HELP_TEXT.paragraph] }, edit: "paragraphs.0" },
  "title-text": {
    label: "Titre + texte",
    description: "Un titre et un paragraphe dessous.",
    props: { title: HELP_TEXT.title, paragraphs: [HELP_TEXT.paragraph] },
    edit: "title",
  },
} as const;
export type TextStarter = keyof typeof TEXT_STARTERS;

type Localized = { fr?: unknown; en?: unknown } | undefined;

/** Le texte est-il encore le texte d'aide (dans l'une des deux langues) ? */
export function isHelpText(value: Localized, help: { fr: string; en: string }): boolean {
  return Boolean(value) && (value!.fr === help.fr || value!.en === help.en);
}

/** Message de publication si un texte d'aide est resté tel quel, sinon null. */
export function helpTextProblem(props: Record<string, unknown>): string | null {
  const title = props.title as Localized;
  const paragraphs = Array.isArray(props.paragraphs) ? (props.paragraphs as Localized[]) : [];
  if (isHelpText(title, HELP_TEXT.title) || paragraphs.some((p) => isHelpText(p, HELP_TEXT.paragraph))) {
    return "Remplace le texte d'exemple de cette rubrique Texte (ou supprime-la).";
  }
  return null;
}
