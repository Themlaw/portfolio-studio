/**
 * Réglages des sauvegardes posés depuis l'admin (lot 76) : ligne `backup` de la table settings, JSON
 * { enabled?, keep?, quietMin?, maxHours?, media? }. Un champ présent PRIME sur l'environnement ; absent, c'est
 * l'environnement (puis le défaut) qui décide. Aucune migration : une ligne absente = aucun réglage.
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";

import { readBackupConfig, sanitizeOverrides, type BackupConfig, type BackupOverrides } from "./config";

const KEY = "backup";

export function readBackupOverrides(): BackupOverrides {
  try {
    const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, KEY)).get();
    return sanitizeOverrides(parseJson(row?.value));
  } catch (error) {
    // Base illisible : on retombe sur l'environnement, les sauvegardes ne doivent jamais empêcher le site de vivre.
    console.warn("[backup] réglages de l'admin illisibles :", (error as Error).message);
    return {};
  }
}

/** Remplace l'ensemble des réglages de l'admin (objet vide = tout retombe sur l'environnement). */
export function writeBackupOverrides(overrides: BackupOverrides): void {
  const clean = sanitizeOverrides(overrides);
  if (Object.keys(clean).length === 0) {
    getDb().delete(schema.settings).where(eq(schema.settings.key, KEY)).run();
    return;
  }
  const value = JSON.stringify(clean);
  getDb().insert(schema.settings).values({ key: KEY, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
}

/** Réglages en vigueur : environnement + réglages de l'admin. */
export function effectiveBackupConfig(): BackupConfig {
  return readBackupConfig(process.env, readBackupOverrides());
}

/** Réglages venant de l'environnement seul (« revenir à l'origine »). */
export function envBackupConfig(): BackupConfig {
  return readBackupConfig(process.env, {});
}
