/**
 * Lot 104b : suites découpées en parties (une suite longue = plusieurs entrées de la batterie, chacune avec ONLY / variables propres).
 *
 * Une partie rejoue la mise en place de la suite (connexion, pages publiées, serveur…). Les vérifications de cette mise en place, et les
 * vérifications de fin de suite (aucune erreur JavaScript…), ne doivent compter PASS qu'UNE fois pour que la somme des PASS des parties soit
 * celle de la suite entière : les parties autres que la première reçoivent PREP_QUIET=1. Avec PREP_QUIET=1, une vérification réussie s'écrit
 * « SETUP <libellé> » (hors du compte), une vérification en échec reste un FAIL dans TOUTES les parties : rien n'est affaibli.
 */

/** @param {(label: string, cond: unknown, detail?: string) => void} ok */
export function sharedOk(ok) {
  return (label, cond, detail = "") => {
    if (process.env.PREP_QUIET === "1" && cond) console.log(`SETUP ${label}`);
    else ok(label, cond, detail);
  };
}

/** Sections choisies par ONLY (liste séparée par des virgules ; vide = toutes). */
export function onlyOf(env = process.env.ONLY ?? "") {
  const set = env ? env.split(",") : null;
  return (s) => !set || set.includes(s);
}
