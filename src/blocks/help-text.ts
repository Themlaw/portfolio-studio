/**
 * Textes d'aide d'un bloc Texte neuf (lot 17c, « Ajouter un bloc ») : posés dans le bloc,
 * sélectionnés à l'ouverture de l'édition en place pour être remplacés d'une frappe. Posé dans la langue
 * éditée seulement (l'autre reste vide, comme tout texte neuf). Module pur (aucun import) : lu par le
 * registre (la publication refuse un texte d'aide resté tel quel), l'éditeur et les tests. Sans React ni next-intl : les libellés
 * des raccourcis sont des clés de l'espace `blockHelp` (starterList les traduit avec le traducteur de l'appelant) ; les messages de
 * publication se traduisent avec `t` s'il est donné, sinon en français (catalogue messages/admin-parts/blockHelp.fr.json).
 */
import type { AdminT } from "@/i18n/admin-lang";

import frHelp from "../../messages/admin-parts/blockHelp.fr.json";

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
  text: { labelKey: "starterText", descriptionKey: "starterTextDesc", block: "rich-text", props: { paragraphs: [HELP_TEXT.paragraph] }, edit: "paragraphs.0" },
  title: { labelKey: "starterTitle", descriptionKey: "starterTitleDesc", block: "section-title", props: { title: HELP_TEXT.title }, edit: "title" },
  "title-text": {
    labelKey: "starterTitleText",
    descriptionKey: "starterTitleTextDesc",
    block: "rich-text",
    props: { title: HELP_TEXT.title, paragraphs: [HELP_TEXT.paragraph] },
    edit: "title",
  },
} as const;
export type TextStarter = keyof typeof TEXT_STARTERS;
/** Les trois raccourcis en liste, libellés traduits (panneau « Ajouter », fenêtre « Ajouter une rubrique ») : `t` = traducteur de l'espace `blockHelp`. */
export const starterList = (t: AdminT) =>
  (Object.keys(TEXT_STARTERS) as TextStarter[]).map((key) => ({ key, ...TEXT_STARTERS[key], label: t(TEXT_STARTERS[key].labelKey), description: t(TEXT_STARTERS[key].descriptionKey) }));

type Localized = { fr?: unknown; en?: unknown } | undefined;

/** Anciens textes d'aide (avant le vocabulaire du lot 75, « rubrique » -> « bloc ») : encore enregistrés dans des brouillons, ils restent reconnus comme textes d'exemple. */
const OLD_HELP_FR: readonly string[] = ["Titre de la rubrique"];

/** Le texte est-il encore le texte d'aide (dans l'une des deux langues, ou l'ancienne formulation) ? */
export function isHelpText(value: Localized, help: { fr: string; en: string }): boolean {
  return Boolean(value) && (value!.fr === help.fr || value!.en === help.en || (help.fr === HELP_TEXT.title.fr && typeof value!.fr === "string" && OLD_HELP_FR.includes(value!.fr)));
}

/** Message de publication si un texte d'aide est resté tel quel, sinon null. */
export function helpTextProblem(props: Record<string, unknown>, t?: AdminT): string | null {
  const title = props.title as Localized;
  const paragraphs = Array.isArray(props.paragraphs) ? (props.paragraphs as Localized[]) : [];
  if (isHelpText(title, HELP_TEXT.title) || paragraphs.some((p) => isHelpText(p, HELP_TEXT.paragraph))) {
    return t ? t("sampleTextProblem") : frHelp.sampleTextProblem;
  }
  return null;
}

/** Idem pour un bloc Titre : son titre est resté le texte d'aide (un titre lié au projet n'a pas de texte propre). */
export function titleHelpProblem(props: Record<string, unknown>, t?: AdminT): string | null {
  if (props.linked) return null;
  return isHelpText(props.title as Localized, HELP_TEXT.title) ? (t ? t("sampleTitleProblem") : frHelp.sampleTitleProblem) : null;
}
