/**
 * Thèmes livrés, vus depuis les scripts Node (sans bundler).
 *
 * Un thème = un dossier `src/themes/presets/<slug>/` contenant `theme.ts`
 * (export par défaut : les données du thème). Découverte par lecture du
 * dossier : aucun script n'a de liste de thèmes à tenir à jour.
 * Node ≥ 23 exécute ces fichiers TypeScript « effaçables » directement.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const ROOT = new URL("../../", import.meta.url).pathname;
export const PRESETS_DIR = path.join(ROOT, "src/themes/presets");
export const PUBLIC_THEMES_DIR = path.join(ROOT, "public/themes");
/** Identifiant d'un thème = nom de son dossier. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Dossiers de thèmes (triés), ceux qui ont un theme.ts. */
export function presetSlugs() {
  return readdirSync(PRESETS_DIR)
    .filter((name) => SLUG.test(name) && statSync(path.join(PRESETS_DIR, name)).isDirectory())
    .filter((name) => existsSync(path.join(PRESETS_DIR, name, "theme.ts")))
    .sort();
}

/** Données brutes (non validées) d'un thème livré. */
export async function loadPreset(slug) {
  const mod = await import(path.join(PRESETS_DIR, slug, "theme.ts"));
  return mod.default;
}

/** Tous les thèmes livrés, éventuellement filtrés par identifiant. */
export async function loadPresets(wanted = []) {
  const out = [];
  for (const slug of presetSlugs()) {
    if (wanted.length && !wanted.includes(slug)) continue;
    out.push(await loadPreset(slug));
  }
  return out;
}

/** Vignette d'aperçu générée d'un thème (public/themes/<slug>/thumb.webp). */
export const thumbPath = (slug) => path.join(PUBLIC_THEMES_DIR, slug, "thumb.webp");
/** Empreinte des données du thème au moment de la vignette. */
export const thumbStampPath = (slug) => path.join(PUBLIC_THEMES_DIR, slug, "thumb.json");
