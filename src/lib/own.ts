/**
 * Lecture d'un dictionnaire (registre de blocs, presets, libellés…) avec une
 * clé venue de l'extérieur (requête, base, variable d'env) : seules les
 * propriétés PROPRES comptent. Sans ce garde, « constructor », « __proto__ »
 * ou « hasOwnProperty » renverraient une fonction héritée d'Object.prototype.
 * Module pur.
 */
export function own<T>(dict: Record<string, T>, key: string | null | undefined): T | undefined {
  return typeof key === "string" && Object.hasOwn(dict, key) ? dict[key] : undefined;
}
