/**
 * Registre des thèmes livrés. Chaque thème est un dossier
 * `src/themes/presets/<slug>/` (docs/THEMES.md), découvert par
 * scripts/theme-registry.mjs (registry.generated.ts). Chaque preset est validé
 * par le schéma au chargement du module : un preset invalide casse le
 * démarrage avec un message explicite plutôt que de produire un rendu faux.
 */
import { ThemeSchema, type Theme } from "../schema";
import { PRESET_THUMBS, RAW_PRESETS } from "./registry.generated";

function validate(input: unknown): Theme {
  const result = ThemeSchema.safeParse(input);
  if (!result.success) {
    const id = (input as { id?: string })?.id ?? "?";
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Preset de thème invalide « ${id} » :\n${issues}`);
  }
  return result.data;
}

export const PRESETS: Readonly<Record<string, Theme>> = Object.freeze(
  Object.fromEntries(RAW_PRESETS.map((raw) => [raw.id, validate(raw)])),
);

export const DEFAULT_THEME_ID = "galerie-lumineuse";
export const PRESET_IDS = Object.keys(PRESETS);

/** Vignette d'aperçu d'un thème livré (chemin public), si elle a été générée. */
export function presetThumb(id: string): string | null {
  return Object.hasOwn(PRESET_THUMBS, id) ? PRESET_THUMBS[id] : null;
}
