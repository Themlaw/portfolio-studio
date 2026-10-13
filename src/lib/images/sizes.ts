/**
 * Attribut `sizes` d'une image rognée par son cadre (module pur).
 *
 * Une image tenue en « cover » dans un cadre plus étroit qu'elle (panorama dans
 * une case portrait), éventuellement zoomée par un cadrage, est affichée bien
 * plus large que le cadre : le navigateur choisit la variante d'après `sizes`,
 * donc `sizes` doit annoncer la largeur RÉELLE de l'image affichée
 * (largeur du cadre × part rognée × zoom), pas celle du cadre.
 */

/** « 4:5 », « 16:9 » → nombre (l/h), ou null (auto, inconnu). */
export function parseRatio(ratio: string | undefined | null): number | null {
  const m = /^(\d{1,3}):(\d{1,3})$/.exec(ratio ?? "");
  return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null;
}

/**
 * Rapport entre la largeur affichée de l'image et celle de son cadre : le
 * format du cadre impose `imageRatio / boxRatio` si l'image est plus large, et
 * le zoom du cadrage multiplie le tout.
 */
export function coverFactor(imageRatio: number, boxRatio: number | null, zoom = 1): number {
  const wider = boxRatio && imageRatio > boxRatio ? imageRatio / boxRatio : 1;
  return wider * Math.max(1, zoom);
}

/** `sizes` mis à l'échelle : chaque longueur (px ou vw) est multipliée par `factor`. */
export function scaleSizes(sizes: string, factor: number): string {
  if (factor <= 1.005) return sizes;
  const f = factor.toFixed(3);
  return sizes
    .split(",")
    .map((entry) => entry.trim().replace(/(\d+(?:\.\d+)?)(px|vw)\s*$/, (_, n: string, unit: string) => `calc(${n}${unit} * ${f})`))
    .join(", ");
}
