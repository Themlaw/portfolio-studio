/**
 * Formats de couleur acceptés par le schéma de thème, pour la saisie dans
 * l'éditeur (mêmes règles que src/themes/schema.ts, validé aussi côté serveur).
 */
export const OPAQUE_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const THEME_COLOR =
  /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/;

/** Valeur du sélecteur natif quand le champ contient une couleur non hex. */
export const PICKER_FALLBACK = "#000000";

/** Exemple de format affiché dans les messages d'aide. */
export const FREE_FORMAT_HINT = "#rrggbb, ou rgba(r, g, b, opacité) pour une transparence";
