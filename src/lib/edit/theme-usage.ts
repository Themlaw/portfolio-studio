/**
 * Dernier usage des thèmes (lot 63) : le menu « Thème » de l'éditeur classe les thèmes par dernier usage
 * (en ligne, puis les derniers préparés). Réglage `themeUsage` = { <id du thème>: date en ms }, écrit au
 * moment où un thème est préparé (aperçu admin) ou mis en ligne. Absent ou illisible = aucun usage connu :
 * aucune migration, les thèmes sont alors classés par nom.
 */
import { eq, isNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";

const KEY = "themeUsage";
const KEEP = 40;

export function readThemeUsage(): Record<string, number> {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, KEY)).get();
  const value = parseJson(row?.value);
  const out: Record<string, number> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [id, at] of Object.entries(value as Record<string, unknown>)) if (typeof at === "number" && Number.isFinite(at)) out[id] = at;
  }
  return out;
}

/** Note « utilisé maintenant ». Jamais fatal : un échec ne doit pas bloquer la préparation ni la mise en ligne. */
export function touchThemeUsage(id: string): void {
  try {
    const usage = { ...readThemeUsage(), [id]: Date.now() };
    const kept = Object.fromEntries(Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, KEEP));
    const v = JSON.stringify(kept);
    getDb().insert(schema.settings).values({ key: KEY, value: v }).onConflictDoUpdate({ target: schema.settings.key, set: { value: v } }).run();
  } catch (e) {
    console.error("[theme] dernier usage non noté", e);
  }
}

export type ThemeChoice = { id: string; name: string; live: boolean };

/** Thèmes du menu de l'éditeur : le thème en ligne d'abord, puis du plus récemment utilisé au plus ancien, puis par nom. */
export function sortThemeChoices(themes: { id: string; name: string }[], liveId: string, usage: Record<string, number>): ThemeChoice[] {
  return themes
    .map((t) => ({ id: t.id, name: t.name, live: t.id === liveId }))
    .sort((a, b) => Number(b.live) - Number(a.live) || (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.name.localeCompare(b.name, "fr"));
}

/** Page à ouvrir pour « travailler au brouillon » : la dernière modifiée (brouillon ou publication), sinon l'accueil. */
export function lastEditedPageId(): number | null {
  const rows = getDb()
    .select({ id: schema.pages.id, slug: schema.pages.slug, updatedAt: schema.pages.updatedAt, draftUpdatedAt: schema.pages.draftUpdatedAt })
    .from(schema.pages)
    .where(isNull(schema.pages.deletedAt))
    .all()
    .filter((p) => !String((p.slug as { fr?: string })?.fr ?? "").startsWith("_"));
  const at = (p: (typeof rows)[number]) => Math.max(p.updatedAt?.getTime() ?? 0, p.draftUpdatedAt?.getTime() ?? 0);
  const touched = rows.filter((p) => p.draftUpdatedAt).sort((a, b) => at(b) - at(a))[0];
  if (touched) return touched.id;
  const home = rows.find((p) => !(p.slug as { fr?: string })?.fr);
  return home?.id ?? rows.sort((a, b) => at(b) - at(a))[0]?.id ?? null;
}
