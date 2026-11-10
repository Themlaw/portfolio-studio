/** Langue d'interface choisie par chaque compte d'admin (lot 130) : une ligne `adminLang.<id>` dans `settings`, sans migration SQL. */
import { eq } from "drizzle-orm";

import { parseAdminLang, type AdminLang } from "@/i18n/admin-lang";
import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";

const key = (userId: string) => `adminLang.${userId}`;

export function readUserAdminLang(userId: string): AdminLang | null {
  try {
    const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, key(userId))).get();
    return parseAdminLang(parseJson(row?.value));
  } catch {
    return null;
  }
}

export function writeUserAdminLang(userId: string, lang: AdminLang): void {
  const value = JSON.stringify(lang);
  getDb().insert(schema.settings).values({ key: key(userId), value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
}
