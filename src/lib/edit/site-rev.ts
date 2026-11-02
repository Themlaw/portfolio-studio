/**
 * Version du brouillon du site (lot 96) : compteur propre au brouillon COMMUN, réglage `siteDraftRev`. Il ne retombe
 * jamais à zéro (même quand le brouillon disparaît) : un onglet resté sur un ancien état ne peut pas retomber sur
 * la même version par hasard. Une v0.31.x l'ignore.
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";

const KEY = "siteDraftRev";

export function readSiteRev(): number {
  const v = parseJson(getDb().select().from(schema.settings).where(eq(schema.settings.key, KEY)).get()?.value);
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
}

/** Incrémente (dans la transaction de l'appelant) et renvoie la nouvelle version. */
export function bumpSiteRev(): number {
  const next = readSiteRev() + 1;
  const value = JSON.stringify(next);
  getDb().insert(schema.settings).values({ key: KEY, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
  return next;
}
