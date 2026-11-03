/**
 * Pastilles de couleur du « Contour » d'une carte (lot 100, même règle que le cadre des images, lot 95) : module pur (aucun import).
 * Une pastille est la couleur EXACTE du contour qu'elle donne (jamais une variante recalculée), et n'est montrée que si ce contour se VOIT et diffère des autres :
 *  - doublon : deux jetons qui valent la même couleur dans le thème (au regard de « Par défaut », la couleur du texte de la carte) : on garde la première ;
 *  - confondue avec le fond de la page : le contour disparaîtrait contre le papier.
 * La valeur enregistrée n'est jamais touchée : le jeton enregistré reste affiché même s'il ferait doublon ou se confondrait.
 */
export type Rgb = { r: number; g: number; b: number };
export const CONTOUR_MIN_CONTRAST = 1.3;
export const CONTOUR_TWIN_TOLERANCE = 6;

const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = ({ r, g, b }: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const close = (a: Rgb, b: Rgb) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)) <= CONTOUR_TWIN_TOLERANCE;

/** Jetons à MASQUER. `order` : ordre d'affichage ; `colors` : couleur calculée de chaque jeton (absent : gardé) ; `def` : « Par défaut » ; `page` : fond de la page ; `stored` : choix enregistré (jamais masqué). */
export function hiddenContourSwatches(order: readonly string[], colors: Record<string, Rgb | undefined>, def: Rgb | undefined, page: Rgb | undefined, stored?: string): Set<string> {
  const kept: Rgb[] = def ? [def] : [];
  const hidden = new Set<string>();
  for (const key of order) {
    const rgb = colors[key];
    if (!rgb) continue;
    if (key === stored) {
      kept.push(rgb);
      continue;
    }
    if (kept.some((k) => close(k, rgb))) {
      hidden.add(key);
      continue;
    }
    if (page && contrast(rgb, page) < CONTOUR_MIN_CONTRAST) {
      hidden.add(key);
      continue;
    }
    kept.push(rgb);
  }
  return hidden;
}
