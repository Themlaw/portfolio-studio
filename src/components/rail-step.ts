/**
 * Défilement d'une bande de planche image par image (flèches de la bande,
 * flèches du clavier sur la barre). Les arrêts sont les bords gauches des
 * photogrammes (`.strip-frame`), calés sur la marge de page (padding du rail,
 * comme l'accrochage CSS) et bornés au défilement possible.
 *
 * Appuis rapprochés : on part de la CIBLE du défilement en cours, pas de la
 * position courante (sinon un second appui pendant l'animation repartirait
 * de l'image d'avant et la bande hésiterait).
 */

const targets = new WeakMap<HTMLElement, number>();

/** Positions d'arrêt (scrollLeft) de chaque image, croissantes, sans doublon. */
export function frameStops(rail: HTMLElement): number[] {
  const slack = Math.max(0, rail.scrollWidth - rail.clientWidth);
  const pad = parseFloat(getComputedStyle(rail).paddingLeft) || 0;
  const railLeft = rail.getBoundingClientRect().left - rail.scrollLeft;
  const stops = new Set<number>([0]);
  for (const frame of rail.querySelectorAll<HTMLElement>(".strip-frame")) {
    const x = frame.getBoundingClientRect().left - railLeft - pad;
    stops.add(Math.round(Math.min(slack, Math.max(0, x))));
  }
  stops.add(Math.round(slack));
  return [...stops].sort((a, b) => a - b);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Fait défiler la bande d'une image vers la droite (1) ou la gauche (-1). */
export function stepRail(rail: HTMLElement, direction: 1 | -1): void {
  const pending = targets.get(rail);
  const from = pending ?? rail.scrollLeft;
  const stops = frameStops(rail);
  const next = direction > 0 ? stops.find((s) => s > from + 4) : [...stops].reverse().find((s) => s < from - 4);
  if (next === undefined) return;
  scrollRailTo(rail, next);
}

/** Défilement animé (sauf « réduire les animations ») vers une position, cible mémorisée. */
export function scrollRailTo(rail: HTMLElement, left: number): void {
  const reduced = prefersReducedMotion();
  if (reduced) {
    targets.delete(rail);
    rail.scrollTo({ left, behavior: "auto" });
    return;
  }
  targets.set(rail, left);
  const done = () => {
    if (targets.get(rail) === left) targets.delete(rail);
  };
  // scrollend : fin réelle du défilement ; délai de secours (navigateur sans scrollend).
  rail.addEventListener("scrollend", done, { once: true });
  window.setTimeout(done, 900);
  rail.scrollTo({ left, behavior: "smooth" });
}

/** Oublie la cible en cours (le geste de l'utilisateur reprend la main). */
export function clearRailTarget(rail: HTMLElement): void {
  targets.delete(rail);
}

/** Commandes de défilement d'une bande (flèches, barre) : sur la toile de l'éditeur, leur clic leur appartient. */
export const NATIVE_SCROLL = ".strip-nav, .rail-bar";
