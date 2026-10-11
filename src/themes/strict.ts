/**
 * Clés inconnues d'un thème : zod retire en silence les clés non déclarées
 * des objets imbriqués. Pour l'import et `theme:check`, une clé inconnue est
 * une ERREUR (faute de frappe, réglage d'une autre version) : on compare
 * l'entrée à la sortie du schéma. Module pur, sans import (scripts Node).
 */
export function unknownKeys(input: unknown, parsed: unknown, at = ""): string[] {
  if (Array.isArray(input) && Array.isArray(parsed)) return input.flatMap((v, i) => unknownKeys(v, parsed[i], `${at}[${i}]`));
  if (input && typeof input === "object" && parsed && typeof parsed === "object" && !Array.isArray(input)) {
    return Object.keys(input).flatMap((k) =>
      Object.hasOwn(parsed, k)
        ? unknownKeys((input as Record<string, unknown>)[k], (parsed as Record<string, unknown>)[k], at ? `${at}.${k}` : k)
        : [at ? `${at}.${k}` : k],
    );
  }
  return [];
}
