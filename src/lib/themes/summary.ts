/**
 * Lot 60 : résumé d'une ligne d'une version de « Mon thème » (« kit : logo, cadre », « couleurs changées »…), généré en
 * comparant deux thèmes. Pur (aucun accès à la base) : testé par scripts/test-themes60.mjs.
 */
import type { Theme } from "@/themes/schema";

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Éléments du kit, dans l'ordre où on les cite, avec leur nom d'utilisatrice (« Signature » est « Logo » partout : lot 60). */
const KIT_PARTS: { label: string; of: (kit: NonNullable<Theme["assets"]["kit"]>) => unknown }[] = [
  { label: "logo", of: (k) => k.signature },
  { label: "icône du site", of: (k) => k.icon },
  { label: "cadre", of: (k) => k.frame },
  { label: "papier", of: (k) => k.paper },
  { label: "décor", of: (k) => [k.plans, k.plansOnly] },
  { label: "trait", of: (k) => k.stroke },
  { label: "flèches et icônes", of: (k) => k.icons },
  { label: "icônes vidéo", of: (k) => k.vicons },
  { label: "scotch", of: (k) => k.tape },
  { label: "curseurs", of: (k) => k.cursors },
];

/** Éléments du kit qui diffèrent entre deux thèmes (« logo », « cadre »…). */
export function kitChanges(prev: Theme | null, next: Theme): string[] {
  const a = prev?.assets.kit ?? {};
  const b = next.assets.kit ?? {};
  return KIT_PARTS.filter((p) => !same(p.of(a), p.of(b))).map((p) => p.label);
}

/** Ce qui a changé entre deux états d'un thème, en phrases courtes ; `null` si rien de visible n'a bougé. */
export function themeChanges(prev: Theme | null, next: Theme): string[] {
  if (!prev) return [];
  const out: string[] = [];
  const kit = kitChanges(prev, next);
  if (kit.length) out.push(`kit : ${kit.join(", ")}`);
  if (!same(prev.tokens.color, next.tokens.color) || !same(prev.tokens.palette, next.tokens.palette)) out.push("couleurs changées");
  if (!same(prev.tokens.font, next.tokens.font) || !same(prev.tokens.type, next.tokens.type)) out.push("textes changés");
  if (!same(prev.variants, next.variants)) out.push("formes changées");
  if (!same(prev.tokens.radius, next.tokens.radius) || !same(prev.tokens.space, next.tokens.space) || !same(prev.tokens.layout, next.tokens.layout)) out.push("arrondis et espacements changés");
  if (!same(prev.assets.heroLayers, next.assets.heroLayers) || !same(prev.assets.heroNote, next.assets.heroNote)) out.push("décor changé");
  if (prev.name !== next.name) out.push("renommé");
  return out;
}

export type VersionSource = "model" | "kit" | "import" | "editor" | "revert" | "migration" | "adopt";

/** Nom de modèle d'un thème : sans les suffixes « (copie) », « (kit 2) », « (importé) » que les versions précédentes ajoutaient. */
export function cleanThemeName(name: string): string {
  let out = name.trim();
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/\s*\((?:copie|kit|importé)(?: \d+)?\)\s*$/i, "").trim();
    if (next === out) break;
    out = next;
  }
  return out || name.trim();
}

/** Le nom a-t-il été fabriqué par l'ancien système (« Studio (kit 2) ») ? Alors « Mon thème » le remplace ; un nom choisi est gardé. */
export const isMachineName = (name: string) => cleanThemeName(name) !== name.trim();

/** Nom donné à Mon thème quand il naît d'un thème existant : son nom s'il a été CHOISI, sinon « Mon thème » (nom fabriqué, ou nom d'un modèle). */
export function ownThemeName(name: string, presetNames: Iterable<string>): string {
  const trimmed = name.trim();
  return !trimmed || isMachineName(trimmed) || [...presetNames].includes(trimmed) ? "Mon thème" : trimmed;
}

/** Résumé d'une ligne d'une version. `prev` : l'état d'avant (null à la création). */
export function summarizeVersion(source: VersionSource, prev: Theme | null, next: Theme, detail?: string): string {
  switch (source) {
    case "model":
      return prev ? `Modèle « ${detail ?? next.name} »` : `Départ : modèle « ${detail ?? next.name} »`;
    case "revert":
      return `Retour à la version ${detail ?? "précédente"}`;
    case "migration":
      return `Reprise de « ${detail ?? next.name} »`;
    case "adopt":
      return `Reprise de « ${detail ?? next.name} »`;
    case "import": {
      const changes = themeChanges(prev, next);
      return `Importé${detail ? ` (${detail})` : ""}${changes.length ? ` : ${changes.join(", ")}` : ""}`;
    }
    case "kit": {
      const kit = kitChanges(prev, next);
      const colors = prev && (!same(prev.tokens.color, next.tokens.color) || !same(prev.tokens.palette, next.tokens.palette));
      const parts = [...(kit.length ? [`kit : ${kit.join(", ")}`] : []), ...(colors ? ["couleurs repeintes"] : [])];
      return parts.join(" · ") || "kit appliqué";
    }
    default: {
      const changes = themeChanges(prev, next);
      return changes.length ? changes.join(", ") : "réglages enregistrés";
    }
  }
}
