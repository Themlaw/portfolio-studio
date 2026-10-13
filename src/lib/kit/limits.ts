/** Limites d'un kit PSD envoyé, contrôlées AVANT décodage (psd-header.ts). Module léger : utilisé par la route d'envoi. */
import type { PreflightLimits } from "./psd-header";
import { DECOR_CANVAS, DOC, DOC_V1, DOC_V2, KIT_FILES, KIT_ROLES, roleOfSize } from "./spec";

export const DEFAULT_LIMITS: PreflightLimits = {
  maxFileBytes: 300 * 1024 * 1024,
  maxLayers: 120,
  // 5 documents v2 (4000 × 4000) entiers de calques décodables au total (surface
  // déclarée) ; le kit v3, plus haut, n'en déclare qu'une fraction : plafond inchangé.
  maxLayerArea: 5 * DOC_V2.width * DOC_V2.height,
  // Kit v4 : le décor accepte jusqu'à 10 calques pleine toile (5760 × 3200 = 18,4 Mpx chacun), décodés un à un.
  areaFor: (width, height) => (roleOfSize(width, height) === "decor" ? 10 * DECOR_CANVAS.width * DECOR_CANVAS.height : 5 * DOC_V2.width * DOC_V2.height),
  sizes: [...KIT_ROLES.map((r) => KIT_FILES[r].doc), DOC, DOC_V2, DOC_V1],
};
