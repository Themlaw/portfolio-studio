/**
 * Connexion SQLite unique du processus (better-sqlite3, synchrone).
 * Fichier : ${DATA_DIR}/portfolio.db — DATA_DIR vaut /data en production,
 * ./data en développement. Réservé à src/lib/ : aucun composant n'importe ceci.
 */
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export function dataDir(): string {
  const configured = process.env.DATA_DIR;
  if (configured) return path.resolve(/* turbopackIgnore: true */ configured);
  // En dev, ./data : exclu du contexte Docker (.dockerignore), donc jamais
  // tracé dans l'image (garde-fou dans le Dockerfile).
  return process.env.NODE_ENV === "production" ? "/data" : path.resolve(/* turbopackIgnore: true */ process.cwd(), "data");
}

const globalForDb = globalThis as unknown as { __portfolioDb?: Db; __portfolioSqlite?: Database.Database };

/** Poignée better-sqlite3 brute (transactions BEGIN IMMEDIATE du démarrage). */
export function getSqlite(): Database.Database {
  getDb();
  return globalForDb.__portfolioSqlite!;
}

export function getDb(): Db {
  if (globalForDb.__portfolioDb) return globalForDb.__portfolioDb;
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  // busy_timeout d'abord : le passage en WAL demande un verrou, qu'un autre
  // processus peut tenir au même instant (démarrages concurrents).
  const sqlite = new Database(path.join(/* turbopackIgnore: true */ dir, "portfolio.db"), { timeout: 5000 });
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  const db = drizzle(sqlite, { schema });
  globalForDb.__portfolioSqlite = sqlite;
  globalForDb.__portfolioDb = db;
  return db;
}

export { schema };
