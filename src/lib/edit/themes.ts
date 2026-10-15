/**
 * Écritures des thèmes (admin). Toujours revalidé côté serveur : schéma zod
 * ET contraste AA (même logique que la CI), jamais de confiance au client.
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { slugify } from "@/lib/slug";
import { normalizePalette } from "@/themes/palette";
import { ThemeSchema, type Theme } from "@/themes/schema";

import { done, fail, zodFieldErrors, type ActionResult } from "./result";

function readTheme(id: string): { row: typeof schema.themes.$inferSelect; theme: Theme } | null {
  const row = getDb().select().from(schema.themes).where(eq(schema.themes.id, id)).get();
  if (!row) return null;
  const parsed = ThemeSchema.safeParse(parseJson(row.data));
  return parsed.success ? { row, theme: parsed.data } : null;
}

function activeThemeId(): string {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, "activeThemeId")).get();
  const value = parseJson(row?.value);
  return typeof value === "string" ? value : "";
}

export function getThemeForEdit(id: string): Theme | null {
  return readTheme(id)?.theme ?? null;
}

export function duplicateTheme(sourceId: string): ActionResult<{ id: string }> {
  const source = readTheme(sourceId);
  if (!source) return fail("Ce thème n'existe plus. Recharge la page.");
  const db = getDb();
  const baseName = source.theme.name.replace(/ \(copie(?: \d+)?\)$/, "");
  const base = `${slugify(baseName) || "theme"}-copie`;
  let id = base;
  let n = 1;
  while (db.select().from(schema.themes).where(eq(schema.themes.id, id)).get()) id = `${base}-${++n}`;
  const name = n === 1 ? `${baseName} (copie)` : `${baseName} (copie ${n})`;
  const theme: Theme = { ...source.theme, id, name, preset: false };
  db.insert(schema.themes).values({ id, name: theme.name, preset: false, data: JSON.stringify(theme) }).run();
  return done({ id });
}

export function saveTheme(id: string, input: unknown, confirmLive = false): ActionResult<null> {
  const current = readTheme(id);
  if (!current) return fail("Ce thème n'existe plus. Recharge la page.");
  if (current.row.preset) return fail("Un thème livré ne se modifie pas : duplique-le, puis modifie la copie.");
  // Le thème en ligne est vu par les visiteurs dès l'enregistrement : la confirmation se vérifie ici, pas seulement dans l'interface.
  if (activeThemeId() === id && confirmLive !== true) {
    return fail("Ce thème est en ligne : l'enregistrer le publie aussitôt pour tes visiteurs. Confirme la mise en ligne, puis enregistre de nouveau.");
  }
  const candidate = { ...(input as object), id, preset: false };
  const parsed = ThemeSchema.safeParse(candidate);
  if (!parsed.success) {
    return fail("Certains réglages sont invalides : corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  }
  // Nuances « auto » recalculées depuis leurs bases (jamais la valeur du client).
  const data: Theme = { ...parsed.data, tokens: { ...parsed.data.tokens, color: normalizePalette(parsed.data.tokens.color, parsed.data.tokens.palette) } };
  // Contraste insuffisant : avertissement dans l'éditeur seulement, l'enregistrement passe (v0.21.1).
  getDb()
    .update(schema.themes)
    .set({ name: data.name, data: JSON.stringify(data), updatedAt: new Date() })
    .where(eq(schema.themes.id, id))
    .run();
  return done(null);
}

export function activateTheme(id: string): ActionResult<null> {
  if (!readTheme(id)) return fail("Ce thème n'existe plus ou est invalide.");
  getDb()
    .insert(schema.settings)
    .values({ key: "activeThemeId", value: JSON.stringify(id) })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: JSON.stringify(id) } })
    .run();
  return done(null);
}

export function deleteTheme(id: string): ActionResult<null> {
  const current = readTheme(id);
  if (!current) return fail("Ce thème n'existe plus.");
  if (current.row.preset) return fail("Un thème livré ne se supprime pas.");
  if (activeThemeId() === id) return fail("Ce thème est en ligne : mets-en un autre en ligne avant de le supprimer.");
  getDb().delete(schema.themes).where(eq(schema.themes.id, id)).run();
  return done(null);
}
