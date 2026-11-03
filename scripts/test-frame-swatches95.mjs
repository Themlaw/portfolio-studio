/**
 * Lot 95 : pastilles du cadre « Bordure » (src/lib/frame-swatches.ts) et couleur du cadre (src/lib/look.ts). Données synthétiques.
 * Les doublons de couleur ne sont gardés qu'une fois, les teintes confondues avec le fond de la page sont masquées, et le choix enregistré
 * n'est jamais perdu.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { contrastRatio, planFrameSwatches } from "../src/lib/frame-swatches.ts";
import { frameColorCss, frameStyle, PALETTE, PALETTE_DISPLAY } from "../src/lib/look.ts";

const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
// Thème clair synthétique : le texte vaut « Couleur par défaut », l'étiquette retombe sur « Détails » (auto), le fond de page et les cartes sont presque blancs.
const THEME = { bg: hex("#faf9f6"), surface: hex("#ffffff"), ink: hex("#232629"), primary: hex("#2e4e9e"), secondary: hex("#a85231"), tertiary: hex("#7e8f77"), "ink-soft": hex("#686d73"), eyebrow: hex("#a85231") };
const DEFAULT = THEME.ink;
const plan = (colors = THEME, stored) => planFrameSwatches(PALETTE_DISPLAY, colors, DEFAULT, colors.bg, stored);

test("T1 la couleur du cadre : une teinte choisie est la couleur du thème, jamais la variante lisible d'une carte", () => {
  for (const c of PALETTE) assert.equal(frameColorCss(c), c === "ink" ? "var(--color-ink)" : `var(--t-color-${c})`, c);
  assert.equal(frameColorCss(undefined), "var(--color-ink)");
  assert.equal(frameColorCss("#a1b2c3cc"), "#a1b2c3cc");
  assert.equal(frameColorCss("red; background:url(x)"), "var(--color-ink)");
  assert.deepEqual(frameStyle({ kind: "band", color: "primary" }).style, { "--frame-color": "var(--t-color-primary)" });
});

test("T2 doublons et teintes confondues avec le fond : seules restent des pastilles distinctes et visibles", () => {
  const p = plan();
  // « Texte » = couleur par défaut, « Étiquette » = « Détails » : une seule pastille chacune ; « Fond de page » et « Cartes » se confondent avec le papier.
  assert.deepEqual(p.shown, ["primary", "secondary", "tertiary", "ink-soft"]);
  assert.equal(p.twin.ink, "default");
  assert.equal(p.twin.eyebrow, "secondary");
  assert.deepEqual(p.blended, ["bg", "surface"]);
  assert.ok(contrastRatio(THEME.bg, THEME.bg) < 1.3 && contrastRatio(THEME.surface, THEME.bg) < 1.3);
});

test("T3 le choix enregistré n'est jamais perdu", () => {
  // Fond de page enregistré : sa pastille reste (cochée), même si le cadre se confond avec le papier.
  assert.ok(plan(THEME, "bg").shown.includes("bg"));
  // Un jeton masqué comme doublon est remplacé par sa jumelle (qui sera cochée) : la valeur enregistrée reste telle quelle.
  assert.equal(plan(THEME, "eyebrow").twin.eyebrow, "secondary");
  assert.equal(plan(THEME, "ink").twin.ink, "default");
});

test("T4 l'ordre est conservé, un thème sans doublon garde ses huit pastilles, un jeton illisible est gardé", () => {
  const dark = { bg: hex("#101214"), surface: hex("#e8e0d0"), ink: hex("#d9c7a0"), primary: hex("#c0392b"), secondary: hex("#3a8f6a"), tertiary: hex("#8a6fb5"), "ink-soft": hex("#8f8f99"), eyebrow: hex("#e09f3e") };
  const p = planFrameSwatches(PALETTE_DISPLAY, dark, hex("#d9c7a0"), dark.bg, undefined);
  assert.deepEqual(p.shown, ["surface", "primary", "secondary", "tertiary", "ink-soft", "eyebrow"]);
  assert.deepEqual(p.shown, PALETTE_DISPLAY.filter((c) => p.shown.includes(c)));
  const unreadable = { ...THEME };
  delete unreadable.tertiary;
  assert.ok(plan(unreadable).shown.includes("tertiary"));
  assert.deepEqual(planFrameSwatches(PALETTE_DISPLAY, {}, undefined, undefined, undefined).shown, [...PALETTE_DISPLAY]);
});
