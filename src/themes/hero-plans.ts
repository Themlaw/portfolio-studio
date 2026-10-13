/**
 * Pile du hero « parallax-layers » : calques SVG du thème et plans dessinés du
 * kit. Plan par plan, un plan dessiné remplace le calque SVG de même rang ;
 * décor libre du kit v4 (`plansOnly`) : les plans sont TOUT le décor, les
 * calques SVG du thème ne s'y ajoutent plus. Fonction pure (testée par
 * scripts/test-theme-kit.mjs).
 */
import type { Theme } from "./schema";

export type HeroStack = { layers: string[]; plans: (NonNullable<NonNullable<Theme["assets"]["kit"]>["plans"]>[number])[]; count: number };

export function heroStack(assets: Pick<Theme["assets"], "heroLayers" | "kit">): HeroStack {
  const plans = assets.kit?.plans ?? [];
  const layers = assets.kit?.plansOnly ? [] : (assets.heroLayers ?? []);
  return { layers, plans, count: Math.max(layers.length, plans.length) };
}
