/**
 * Liens partageables : helpers purs (proxy, tests).
 */
export function isShareLinkPath(rest: string): boolean {
  // rest est le chemin après la locale, sans slash initial ni final (ex. "l/cv").
  if (typeof rest !== "string") return false;
  const parts = rest.split("/");
  if (parts.length !== 2) return false;
  if (parts[0] !== "l") return false;
  const slug = parts[1];
  return /^[a-z0-9-]{1,60}$/.test(slug);
}