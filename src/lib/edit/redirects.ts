/**
 * Anciennes adresses d'une page renommée (lot 51, PAGES-06) : réglage `slugRedirects`, liste de
 * { locale, from, pageId }. Le proxy (src/lib/pages-index.ts) ne la consulte que pour une adresse
 * inconnue ; la cible est toujours l'adresse ACTUELLE de la page (renommages en chaîne sans bout cassé).
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";

export type SlugRedirect = { locale: string; from: string; pageId: number };

const LOCALES = ["fr", "en"] as const;
const MAX = 300;

export function readRedirects(): SlugRedirect[] {
  const raw = parseJson(getDb().select().from(schema.settings).where(eq(schema.settings.key, "slugRedirects")).get()?.value);
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is SlugRedirect => Boolean(r) && typeof r.locale === "string" && typeof r.from === "string" && Number.isInteger(r.pageId));
}

function writeRedirects(list: SlugRedirect[]): void {
  const value = JSON.stringify(list.slice(-MAX));
  getDb().insert(schema.settings).values({ key: "slugRedirects", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
}

/**
 * Retient les adresses quittées (par langue) de la page, et oublie les redirections qui pointeraient
 * sur une adresse désormais vivante. Retourne le nombre d'adresses gardées.
 */
export function rememberOldAddresses(pageId: number, oldSlug: { fr: string; en: string }, newSlug: { fr: string; en: string }): number {
  let list = readRedirects();
  let added = 0;
  for (const l of LOCALES) {
    // L'adresse reprise par cette page n'a plus besoin de redirection.
    list = list.filter((r) => !(r.locale === l && r.from === newSlug[l]));
    if (!oldSlug[l] || oldSlug[l] === newSlug[l]) continue;
    list = list.filter((r) => !(r.locale === l && r.from === oldSlug[l]));
    list.push({ locale: l, from: oldSlug[l], pageId });
    added++;
  }
  if (added || list.length !== readRedirects().length) writeRedirects(list);
  return added;
}
