/** Limites d'un kit PSD envoyé, contrôlées AVANT décodage (psd-header.ts). Module léger : utilisé par la route d'envoi. */
import type { PreflightLimits } from "./psd-header";
import { DOC, DOC_V1 } from "./spec";

export const DEFAULT_LIMITS: PreflightLimits = {
  maxFileBytes: 300 * 1024 * 1024,
  maxLayers: 120,
  // 5 documents v2 entiers de calques décodables au total (surface déclarée).
  maxLayerArea: 5 * DOC.width * DOC.height,
  sizes: [DOC, DOC_V1],
};
