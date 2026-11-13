/**
 * Ordre d'affichage des pages (écran admin « Pages » et sélecteur de
 * l'éditeur visuel), stocké comme réglage clé/valeur (`pagesAdminOrder`),
 * indépendamment de l'ordre du menu du site (`nav`).
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { isSpecialPage } from "@/lib/special-pages";
import { done, fail, type ActionResult } from "./result";
import { orderPages } from "@/lib/pages-order";

const KEY = "pagesAdminOrder";

export function readPagesAdminOrder(): number[] {
  const db = getDb();
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get();
  const parsed = z.array(z.number().int().positive()).safeParse(parseJson(row?.value));
  return parsed.success ? parsed.data : [];
}

export function reorderPages(input: unknown): ActionResult<null> {
  const parsed = z.array(z.number().int().positive()).max(100).safeParse(input);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) {
    return fail("Ordre des pages invalide. Recharge la page.");
  }
  const db = getDb();
  const live = db
    .select({ id: schema.pages.id, slug: schema.pages.slug, deletedAt: schema.pages.deletedAt })
    .from(schema.pages)
    .all()
    .filter((p) => !p.deletedAt && !isSpecialPage({ slug: p.slug }))
    .map((p) => p.id);
  const same = parsed.data.length === live.length && parsed.data.every((id) => live.includes(id));
  if (!same) return fail("La liste des pages a changé entre-temps. Recharge la page et recommence.");
  const value = JSON.stringify(parsed.data);
  db.insert(schema.settings).values({ key: KEY, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
  return done(null);
}

// Re-export for callers that want the pure helper alongside.
export { orderPages };
