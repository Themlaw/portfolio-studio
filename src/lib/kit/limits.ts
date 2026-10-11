/** Limites d'un kit PSD envoyé, contrôlées AVANT décodage (psd-header.ts). Module léger : utilisé par la route d'envoi. */
import type { PreflightLimits } from "./psd-header";
import { DOC, DOC_V1, DOC_V2 } from "./spec";

export const DEFAULT_LIMITS: PreflightLimits = {
  maxFileBytes: 300 * 1024 * 1024,
  maxLayers: 120,
  // 5 documents v2 (4000 × 4000) entiers de calques décodables au total (surface
  // déclarée) ; le kit v3, plus haut, n'en déclare qu'une fraction : plafond inchangé.
  maxLayerArea: 5 * DOC_V2.width * DOC_V2.height,
  sizes: [DOC, DOC_V2, DOC_V1],
};
