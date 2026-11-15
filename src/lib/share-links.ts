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

/**
 * Normalise un nom court (slug) pendant la frappe et côté serveur avant validation :
 * minuscules, accents retirés, espaces et « _ » → « - », tout autre caractère retiré,
 * tirets multiples fusionnés et extrémités nettoyées, 60 caractères au plus.
 */
export function normalizeShareSlug(input: unknown, { typing = false }: { typing?: boolean } = {}): string {
  if (typeof input !== "string") return "";
  let s = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.toLowerCase();
  s = s.replace(/[\s_]+/g, "-");
  s = s.replace(/[^a-z0-9-]/g, "");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+/, "");
  s = s.slice(0, 60);
  // Pendant la frappe, un tiret final est gardé (sinon « demo- » perdrait son tiret et « demo-reel » serait impossible à taper) ;
  // il est retiré à la sortie du champ et côté serveur.
  return typing ? s : s.replace(/-+$/, "");
}
