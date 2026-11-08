/**
 * IP du client derrière N proxys de confiance (AUTH_TRUSTED_PROXY_HOPS).
 *
 * Chaque proxy AJOUTE à droite de X-Forwarded-For l'adresse qu'il voit : les
 * N dernières entrées viennent de nos proxys, tout ce qui est à gauche peut
 * être inventé par le client. L'IP client est donc l'entrée n°N en partant de
 * la droite. Avec N = 1 (un proxy : Pangolin/Newt), « faux, vrai » → « vrai ».
 *
 * L'IP calculée est transmise à Better Auth par un en-tête interne (jamais
 * accepté tel quel depuis l'extérieur : le gestionnaire l'écrase).
 */
export const CLIENT_IP_HEADER = "x-portfolio-client-ip";
/** Clé commune quand aucune IP n'est connue (accès direct, sans proxy). */
export const UNKNOWN_IP = "0.0.0.0";

export function clientIpFromForwarded(xff: string | null, hops: number): string | null {
  if (!xff || hops < 1) return null;
  const entries = xff
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;
  const index = Math.max(0, entries.length - hops);
  const ip = entries[index];
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}

/**
 * Clé des compteurs de connexion pour une IP (docs/SECURITE.md §2.4) : une IPv4 telle quelle, une IPv6 réduite à son préfixe
 * /64 (un seul abonné en a 2^64 : compter adresse par adresse ne freinait rien). Une IPv4 écrite en IPv6 (::ffff:1.2.3.4)
 * redevient l'IPv4. Forme illisible : la chaîne telle quelle (jamais d'exception).
 */
export function ipBucket(ip: string): string {
  const raw = ip.trim().toLowerCase();
  if (!raw.includes(":")) return raw;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped) return mapped[1];
  const halves = raw.split("::");
  if (halves.length > 2) return raw;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  // Une IPv4 en fin d'adresse compte pour deux groupes.
  if (tail.length && tail[tail.length - 1].includes(".")) tail.splice(tail.length - 1, 1, "0", "0");
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return raw;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return raw;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}
