import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Secret de DÉVELOPPEMENT, jamais écrit dans le code : tiré au hasard à la première utilisation et gardé dans
 * `<DATA_DIR>/.dev-secret` (le dossier de données n'entre ni dans le dépôt ni dans l'image), donc stable d'un
 * processus et d'un redémarrage à l'autre. Un secret propre à chaque usage en est dérivé (HMAC). Si le fichier
 * est inaccessible, un secret en mémoire propre au processus est utilisé. Jamais appelé en production.
 */
let base: string | null = null;

function baseSecret(): string {
  if (base) return base;
  const file = path.join(process.env.DATA_DIR || "./data", ".dev-secret");
  try {
    base = readFileSync(file, "utf8").trim();
  } catch {
    base = "";
  }
  if (base.length >= 32) return base;
  const fresh = randomBytes(48).toString("base64url");
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, fresh, { flag: "wx", mode: 0o600 });
    base = fresh;
  } catch {
    // créé entre-temps par un autre processus, ou dossier en lecture seule
    try {
      const other = readFileSync(file, "utf8").trim();
      base = other.length >= 32 ? other : fresh;
    } catch {
      base = fresh;
    }
  }
  return base;
}

export const devSecret = (label: string): string => createHmac("sha256", baseSecret()).update(label).digest("base64url");
