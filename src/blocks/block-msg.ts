/**
 * Textes d'interface des modules purs de src/blocks (lot 130b). Ces modules sont lus par le serveur, l'éditeur (client) et les tests
 * Node : ils n'importent pas next-intl. Le français vient du catalogue (messages/admin-parts/*.fr.json, la source), l'anglais et les
 * autres langues d'un traducteur `t` fourni par l'appelant (serveur : getAdminT(espace) ; client : useTranslations(espace)).
 */
import type { AdminT } from "@/i18n/admin-lang";

import labelsFr from "../../messages/admin-parts/blockRegLabels.fr.json";
import problemsFr from "../../messages/admin-parts/blockRegProblems.fr.json";

/** Libellés français du catalogue `blockRegLabels` (valeurs par défaut des constantes : tests Node, rendu serveur sans traducteur). */
export const FR_LABELS = labelsFr;

type Values = Record<string, string | number>;

/** `{nom}` remplacés (les gabarits français du catalogue n'ont pas de pluriel ICU). */
export function fillTemplate(template: string, values?: Values): string {
  return values ? template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? "")) : template;
}

export type ProblemKey = keyof typeof problemsFr;

/**
 * Message de validation (erreur renvoyée au client). Sans traducteur : le français du catalogue `blockRegProblems`.
 * Avec `t` (espace `blockRegProblems`) : la langue de l'interface (les actions serveur le passent depuis l'étape 130c).
 */
export function problemMsg(key: ProblemKey, values?: Values, t?: AdminT): string {
  return t ? t(key, values) : fillTemplate(problemsFr[key], values);
}
