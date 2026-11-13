/**
 * Curseurs dessinés (kit PSD, lot 4) : contrôle de visibilité sur les fonds du
 * thème. Module pur : utilisé par l'import (pixels lus par sharp) et par
 * l'éditeur de thème (pixels lus dans un canvas).
 *
 * Mesure : parmi les pixels assez opaques (alpha ≥ 128), part de ceux qui
 * atteignent 3:1 (WCAG 1.4.11, éléments graphiques) contre le fond. Un curseur
 * du système (flèche noire au contour blanc) en a toujours plus de 30 % sur un
 * fond clair comme sur un fond sombre ; sous 15 % il se perd (avertissement).
 */
import { contrastRatio, toHex } from "./palette";

/** Pixels assez visibles exigés (part des pixels opaques). */
export const CURSOR_MIN_VISIBLE = 0.15;
/** Contraste d'un pixel « visible » (éléments graphiques, WCAG 1.4.11). */
export const CURSOR_PIXEL_CONTRAST = 3;

export type CursorVisibility = { ground: string; visible: number; opaque: number };

/** `rgba` : RVBA 8 bits (largeur × hauteur × 4). */
export function cursorVisibility(rgba: ArrayLike<number>, grounds: string[]): CursorVisibility[] {
  return grounds.map((ground) => {
    let opaque = 0;
    let visible = 0;
    const cache = new Map<number, boolean>();
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] < 128) continue;
      opaque++;
      const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
      let ok = cache.get(key);
      if (ok === undefined) {
        ok = contrastRatio(toHex([rgba[i], rgba[i + 1], rgba[i + 2]]), ground) >= CURSOR_PIXEL_CONTRAST;
        cache.set(key, ok);
      }
      if (ok) visible++;
    }
    return { ground, opaque, visible: opaque ? visible / opaque : 0 };
  });
}

/** Message d'avertissement si le curseur se perd sur un des fonds, sinon null. */
export function cursorProblem(rgba: ArrayLike<number>, grounds: { hex: string; label: string }[], t?: (key: string, values?: Record<string, string | number>) => string): string | null {
  const res = cursorVisibility(
    rgba,
    grounds.map((g) => g.hex),
  );
  if (res.every((r) => r.opaque === 0)) return t ? t("cursorEmpty") : "Curseur vide.";
  const bad = res.map((r, i) => ({ ...r, label: grounds[i].label })).filter((r) => r.visible < CURSOR_MIN_VISIBLE);
  if (!bad.length) return null;
  const labels = bad.map((b) => b.label).join(", ");
  const percent = Math.round(bad[0].visible * 100);
  if (t) return t("cursorProblem", { labels, percent });
  return `Curseur presque invisible sur ${labels} (${percent} % de ses pixels ressortent à ${CURSOR_PIXEL_CONTRAST}:1) : ajoute un contour clair ou foncé.`;
}
