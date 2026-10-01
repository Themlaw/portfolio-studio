/**
 * Version du kit exporté : empreinte de l'état enregistré du thème et du nom
 * du site (la signature pré-remplie est ce nom) ; change à chaque enregistrement.
 */
import { createHash } from "node:crypto";

import type { Theme } from "@/themes/schema";

export function themeVersion(theme: Theme, siteName = ""): string {
  return createHash("sha256").update(`${JSON.stringify(theme)}\n${siteName}`).digest("hex").slice(0, 12);
}
