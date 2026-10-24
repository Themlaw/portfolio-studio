/**
 * Bibliothèque de cadres (lot 74), lectures de l'admin : les cadres importés, avec combien d'images les portent, et le « Cadre du
 * thème » (le cadre dessiné dans le kit du thème en ligne), listé avec eux sans rien perdre. Écritures : src/lib/edit/frames.ts.
 */
import { getLiveTheme } from "@/lib/admin";
import { frameUseCounts, readLibraryRow } from "@/lib/edit/frames";
import { frameWidths, type FrameEntry } from "@/themes/frame-library";

export type AdminFrame = FrameEntry & { uses: number; widths: [number, number, number, number] };

export function listFramesForAdmin(): AdminFrame[] {
  const uses = frameUseCounts();
  return readLibraryRow().map((e) => ({ ...e, uses: uses.get(e.id) ?? 0, widths: frameWidths(e) }));
}

export type ThemeFrameInfo = { thumb: string; w: number; h: number; slice: [number, number, number, number] } | null;

/** Le cadre du kit du thème en ligne, ou null si le thème n'en dessine pas. */
export function themeFrameInfo(): ThemeFrameInfo {
  const f = getLiveTheme()?.assets?.kit?.frame;
  if (!f) return null;
  return { thumb: f.image.svg ?? f.image.webp ?? "", w: f.image.w, h: f.image.h, slice: f.slice as [number, number, number, number] };
}
