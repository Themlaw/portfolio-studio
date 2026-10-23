/**
 * Polices récemment choisies (lot 70) : les 6 dernières, la plus récente en tête, sans doublon. Mémorisées côté serveur dans
 * les réglages du site (`recentFonts`, liste de références de police), jamais dans le navigateur : l'artiste les retrouve sur
 * n'importe quel appareil. Aucun effet sur le rendu du site (ni cache public, ni brouillon) : c'est une commodité de l'éditeur.
 */
import { eq } from "drizzle-orm";

import { getDb, getSqlite, schema } from "../db";
import { parseJson } from "../json";
import { isFontRef } from "../look";

export const RECENT_FONTS_MAX = 6;

/** Liste lue telle que stockée ; une valeur illisible ou une police qui n'existe plus est écartée. */
export function readRecentFonts(): string[] {
  const raw = parseJson(getDb().select().from(schema.settings).where(eq(schema.settings.key, "recentFonts")).get()?.value);
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) if (typeof v === "string" && isFontRef(v) && !out.includes(v)) out.push(v);
  return out.slice(0, RECENT_FONTS_MAX);
}

/** Place `ref` en tête de la liste (déjà présente : elle remonte). Retourne la nouvelle liste, ou null si la référence est inconnue. */
export function pushRecentFont(ref: unknown): string[] | null {
  if (typeof ref !== "string" || ref.length > 80 || !isFontRef(ref)) return null;
  return getSqlite()
    .transaction(() => {
      const next = [ref, ...readRecentFonts().filter((r) => r !== ref)].slice(0, RECENT_FONTS_MAX);
      const v = JSON.stringify(next);
      getDb().insert(schema.settings).values({ key: "recentFonts", value: v }).onConflictDoUpdate({ target: schema.settings.key, set: { value: v } }).run();
      return next;
    })
    .immediate();
}
