/**
 * Lot 132 — « boiling line » : 2 à 6 dessins alternés (8 images par seconde) pour le trait, la signature et le cadre du kit.
 *
 * Données : `assets.kit.boil.{stroke,signature,frame}` = les dessins SUPPLÉMENTAIRES (1 à 5), après celui du kit (`kit.stroke`, …). Sans
 * eux, rien n'est émis : ni variable, ni attribut, ni règle (rendu identique à celui d'avant). Les variables
 * `--t-kit-boil-<élément>-<i>` (css.ts) portent les dessins ; ce module écrit les images clés. Aucun script : une animation CSS dont chaque
 * image clé pose l'image du masque (trait, signature) ou de la bordure (cadre), `steps(1, end)` entre deux images clés.
 * Pas de mouvement pour qui demande « réduire les animations » (le premier dessin reste).
 */
import type { KitAssets } from "@/themes/schema";

/** Dessins au total (celui du kit compris). */
export const BOIL_MIN = 2;
export const BOIL_MAX = 6;
export const BOIL_FPS = 8;
export const BOIL_ELEMENTS = ["stroke", "signature", "frame"] as const;
export type BoilElement = (typeof BOIL_ELEMENTS)[number];

/** Les mêmes sélecteurs que les règles d'origine (variants.css) : seul le dessin change d'une image à l'autre. */
const TARGETS: Record<BoilElement, { gate: string; rules: { selector: string; props: (v: string) => string }[]; base: string }> = {
  stroke: {
    gate: "stroke",
    base: "--t-kit-stroke",
    rules: [
      { selector: "[data-kit-stroke][data-kit-boil~=\"stroke\"] .nav-underline", props: (v) => `-webkit-mask-image:${v};mask-image:${v}` },
      { selector: "[data-kit-stroke][data-kit-boil~=\"stroke\"] hr.rule", props: (v) => `-webkit-mask-image:${v};mask-image:${v}` },
    ],
  },
  signature: {
    gate: "signature",
    base: "--t-kit-signature",
    rules: [{ selector: "[data-kit-signature][data-kit-boil~=\"signature\"] .site-signature", props: (v) => `-webkit-mask-image:${v};mask-image:${v}` }],
  },
  frame: {
    gate: "frame",
    base: "--t-kit-frame",
    rules: [{ selector: "[data-kit-frame][data-kit-boil~=\"frame\"] :is(.media-frame, .tile-media)", props: (v) => `border-image-source:${v}` }],
  },
};

/** Nombre de dessins supplémentaires de chaque élément. */
export function boilCounts(kit: KitAssets | undefined): Partial<Record<BoilElement, number>> {
  const out: Partial<Record<BoilElement, number>> = {};
  if (!kit?.boil) return out;
  for (const el of BOIL_ELEMENTS) {
    const n = kit.boil[el]?.length ?? 0;
    // Il faut le dessin de base : sans lui rien à alterner.
    if (n > 0 && kit[el]) out[el] = Math.min(n, BOIL_MAX - 1);
  }
  return out;
}

/** CSS des animations (vide sans `kit.boil`). */
export function boilCss(kit: KitAssets | undefined): string {
  const counts = boilCounts(kit);
  const parts: string[] = [];
  for (const el of BOIL_ELEMENTS) {
    const extra = counts[el];
    if (!extra) continue;
    const total = extra + 1;
    const target = TARGETS[el];
    const frames: string[] = [];
    for (let i = 0; i < total; i++) {
      const v = i === 0 ? `var(${target.base})` : `var(--t-kit-boil-${el}-${i})`;
      frames.push(`${((i * 100) / total).toFixed(3).replace(/\.?0+$/, "")}%{${target.rules[0].props(v)}}`);
    }
    // Cadre : la propriété est border-image-source quelle que soit la règle ; les masques posent mask-image.
    parts.push(`@keyframes kit-boil-${el}{${frames.join("")}}`);
    const duration = `${Math.round((total / BOIL_FPS) * 1000) / 1000}s`;
    const selectors = target.rules.map((r) => r.selector).join(",");
    parts.push(`@media (prefers-reduced-motion:no-preference){${selectors}{animation:kit-boil-${el} ${duration} steps(1,end) infinite}}`);
  }
  return parts.join("");
}
