/**
 * GÉNÉRÉ par scripts/theme-registry.mjs — ne pas modifier à la main.
 * Un dossier src/themes/presets/<slug>/theme.ts = un thème livré ;
 * `npm run theme:new -- <slug>` crée le dossier et régénère ce fichier.
 */
import type { ThemeInput } from "../schema";

import t_carnet_d_atelier from "./carnet-d-atelier/theme";
import t_fanzine_riso from "./fanzine-riso/theme";
import t_galerie_lumineuse from "./galerie-lumineuse/theme";
import t_planche_de_story from "./planche-de-story/theme";
import t_pro from "./pro/theme";
import t_salle_de_montage from "./salle-de-montage/theme";
import t_salle_de_projection from "./salle-de-projection/theme";
import t_studio from "./studio/theme";

/** Données brutes des thèmes livrés, par ordre alphabétique de dossier. */
export const RAW_PRESETS: readonly ThemeInput[] = [t_carnet_d_atelier, t_fanzine_riso, t_galerie_lumineuse, t_planche_de_story, t_pro, t_salle_de_montage, t_salle_de_projection, t_studio];

/** Dossier → vignette d'aperçu générée (npm run theme:thumbs). */
export const PRESET_THUMBS: Readonly<Record<string, string>> = {
  "carnet-d-atelier": "/themes/carnet-d-atelier/thumb.webp",
  "fanzine-riso": "/themes/fanzine-riso/thumb.webp",
  "galerie-lumineuse": "/themes/galerie-lumineuse/thumb.webp",
  "planche-de-story": "/themes/planche-de-story/thumb.webp",
  "pro": "/themes/pro/thumb.webp",
  "salle-de-montage": "/themes/salle-de-montage/thumb.webp",
  "salle-de-projection": "/themes/salle-de-projection/thumb.webp",
  "studio": "/themes/studio/thumb.webp",
};
