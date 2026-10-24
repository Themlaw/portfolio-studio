/**
 * Téléchargement d'une sauvegarde (lot 76) : validation du nom demandé et lecture de l'en-tête Range. Purs, testés sans serveur.
 */
import { ARCHIVE_RE } from "./schedule";

/** Seul un nom exactement de la forme portfolio-AAAAMMJJ-HHMMSS[-n].tar.gz est servi : jamais de chemin, jamais de « .. ». */
export const isArchiveName = (name: string) => name.length <= 64 && ARCHIVE_RE.test(name);

export type ByteRange = { start: number; end: number };

/**
 * Plage demandée : ByteRange, "unsatisfiable" (416), ou null (en-tête absent, plusieurs plages ou syntaxe inconnue :
 * réponse complète).
 */
export function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, a, b] = match;
  if (a === "" && b === "") return null;
  let start: number;
  let end: number;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
