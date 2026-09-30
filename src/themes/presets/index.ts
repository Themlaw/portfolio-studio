/**
 * Registre des presets. Chaque preset est validé par le schéma au chargement
 * du module : un preset invalide casse le démarrage avec un message explicite
 * plutôt que de produire un rendu faux.
 */
import { ThemeSchema, type Theme } from "../schema";
import carnetDAtelier from "./carnet-d-atelier";
import galerieLumineuse from "./galerie-lumineuse";
import pro from "./pro";
import salleDeProjection from "./salle-de-projection";

const RAW = [galerieLumineuse, pro, salleDeProjection, carnetDAtelier];

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
  Object.fromEntries(RAW.map((raw) => [raw.id, validate(raw)])),
);

export const DEFAULT_THEME_ID = "galerie-lumineuse";
export const PRESET_IDS = Object.keys(PRESETS);
