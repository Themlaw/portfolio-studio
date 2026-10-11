/**
 * Écritures des thèmes (admin). Toujours revalidé côté serveur : schéma zod
 * ET contraste AA (même logique que la CI), jamais de confiance au client.
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { slugify } from "@/lib/slug";
import { AA, contrastReport } from "@/themes/contrast";
import { contrastRatio, normalizePalette, resolvePalette } from "@/themes/palette";
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

export function saveTheme(id: string, input: unknown): ActionResult<null> {
  const current = readTheme(id);
  if (!current) return fail("Ce thème n'existe plus. Recharge la page.");
  if (current.row.preset) return fail("Un thème livré ne se modifie pas : duplique-le, puis modifie la copie.");
  const candidate = { ...(input as object), id, preset: false };
  const parsed = ThemeSchema.safeParse(candidate);
  if (!parsed.success) {
    return fail("Certains réglages sont invalides : corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  }
  // Nuances « auto » recalculées depuis leurs bases (jamais la valeur du client).
  const data: Theme = { ...parsed.data, tokens: { ...parsed.data.tokens, color: normalizePalette(parsed.data.tokens.color, parsed.data.tokens.palette) } };
  const resolved = resolvePalette(data.tokens.color, data.tokens.palette);
  const scrimRatio = contrastRatio(resolved.onScrim, resolved.scrim);
  if (scrimRatio < AA) {
    return fail(`Contraste insuffisant sur le voile de la visionneuse (${scrimRatio.toFixed(2)}:1, il faut ${AA}:1).`, { "tokens.color.onScrim": `Texte sur le voile : ${scrimRatio.toFixed(2)}:1, il faut au moins ${AA}:1.` });
  }
  const failing = contrastReport(data.tokens.color).filter((p) => !p.ok);
  if (failing.length > 0) {
    const errors: Record<string, string> = {};
    for (const p of failing) {
      const key = `tokens.color.${p.fg === "eyebrow" && !data.tokens.color.eyebrow ? "secondary" : p.fg}`;
      errors[key] ??= `${p.label} : ${p.ratio.toFixed(2)}:1, il faut au moins ${AA}:1.`;
    }
    return fail(
      `Contraste insuffisant (${failing.length} couple${failing.length > 1 ? "s" : ""} sous ${AA}:1). Utilise « Ajuster » sur les couleurs signalées.`,
      errors,
    );
  }
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
