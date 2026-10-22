import { cache } from "react";

/**
 * Images à charger tout de suite (lot 54) : la première image visible d'une page ne doit jamais être différée
 * (« lazy »), sinon elle arrive en dernier. Le serveur rend la page dans l'ordre du document ; chaque composant qui
 * pose une image réclame ici sa part, et les deux premières images de la page (en tout, tous composants confondus)
 * sont chargées en priorité haute. Compteur propre à chaque rendu (cache de React), module serveur uniquement.
 */
const EAGER_BUDGET = 2;
const counter = cache(() => ({ used: 0 }));

/** Réclame jusqu'à `wanted` images prioritaires ; rend le nombre accordé (0 une fois le budget de la page épuisé). */
export function claimEager(wanted = 1): number {
  const c = counter();
  const granted = Math.max(0, Math.min(wanted, EAGER_BUDGET - c.used));
  c.used += granted;
  return granted;
}
