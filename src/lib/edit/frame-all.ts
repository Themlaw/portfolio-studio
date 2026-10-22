/**
 * Réglage du site « Cadre du thème sur toutes les photos » (lot 62, réglage `themeFrameAll`) : un booléen, NON par défaut (absent = non,
 * y compris pour les sites qui avaient le cadre du kit sur toutes leurs photos). Une photo sans choix explicite (menu « Cadre » de sa barre)
 * suit ce réglage ; un choix explicite passe toujours avant.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { readThemeFrameAll } from "@/lib/look";

import { done, fail, type ActionResult } from "./result";

const Input = z.boolean();

/** Lecture directe (admin, sans cache). */
export function getThemeFrameAllSetting(): boolean {
  return readThemeFrameAll(parseJson(getDb().select().from(schema.settings).where(eq(schema.settings.key, "themeFrameAll")).get()?.value));
}

/** `false` retire le réglage (même rendu que jamais posé). */
export function saveThemeFrameAll(input: unknown): ActionResult<null> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return fail("Réglage invalide.");
  const db = getDb();
  if (!parsed.data) {
    db.delete(schema.settings).where(eq(schema.settings.key, "themeFrameAll")).run();
    return done(null);
  }
  const value = JSON.stringify(true);
  db.insert(schema.settings).values({ key: "themeFrameAll", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
  return done(null);
}
