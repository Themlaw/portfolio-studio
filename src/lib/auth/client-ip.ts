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
