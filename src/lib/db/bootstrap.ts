/**
 * Démarrage du serveur : migrations versionnées (./drizzle) puis seed unique.
 * Appelé une fois par src/instrumentation.ts (runtime nodejs).
 *
 * Concurrence : plusieurs processus peuvent démarrer sur une base vide. La
 * lecture de __drizzle_migrations, l'application des migrations, le test
 * `seededAt` et le seed tiennent dans UNE transaction BEGIN IMMEDIATE : le
 * second processus attend le verrou (busy_timeout) puis constate que tout
 * est fait. Le migrateur reproduit celui de drizzle-orm (même table, même
 * règle folderMillis), dont la lecture de la dernière migration se fait
 * hors transaction.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";

import { dataDir, getDb, getSqlite } from "./index";
import { isSeeded, prepareSeedFiles, seedRows, type SeedFiles } from "./seed";
import { upgradeContent } from "./upgrade";

const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * Migrations de CONTENU (JSON des blocs, réglages) qui suivent une migration
 * SQL, par étiquette du journal : jouées juste après son SQL, dans la même
 * transaction, une seule fois (même règle folderMillis). Idempotentes.
 */
const DATA_MIGRATIONS: Record<string, () => void> = {
  "0014_containers": () => {
    const pages = upgradeContent(getSqlite());
    console.log(`[db] 0014 : conteneurs, grilles et menu — ${pages} page(s) convertie(s)`);
  },
};

/** Étiquette (tag) de chaque migration du journal, par date (folderMillis). */
function journalTags(folder: string): Map<number, string> {
  try {
    const journal = JSON.parse(readFileSync(path.join(/* turbopackIgnore: true */ folder, "meta", "_journal.json"), "utf8")) as { entries: { when: number; tag: string }[] };
    return new Map(journal.entries.map((e) => [e.when, e.tag]));
  } catch {
    return new Map();
  }
}

function applyMigrations(migrations: MigrationMeta[], tags: Map<number, string>): number {
  const sqlite = getSqlite();
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
  );
  const last = sqlite
    .prepare(`SELECT created_at FROM "${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`)
    .get() as { created_at: number } | undefined;
  let applied = 0;
  for (const migration of migrations) {
    if (last && Number(last.created_at) >= migration.folderMillis) continue;
    for (const statement of migration.sql) if (statement.trim()) sqlite.exec(statement);
    const tag = tags.get(migration.folderMillis);
    if (tag && Object.hasOwn(DATA_MIGRATIONS, tag)) DATA_MIGRATIONS[tag]();
    sqlite
      .prepare(`INSERT INTO "${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES (?, ?)`)
      .run(migration.hash, migration.folderMillis);
    applied++;
  }
  return applied;
}

export async function bootstrap(): Promise<void> {
  const started = Date.now();
  const db = getDb();
  const sqlite = getSqlite();
  const folder = path.resolve(process.cwd(), "drizzle");
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const tags = journalTags(folder);

  // Fichiers du seed hors transaction (asynchrones, idempotents), seulement
  // si la base n'est pas déjà seedée.
  const files: SeedFiles | null = isSeeded(db) ? null : await prepareSeedFiles();

  const outcome = sqlite
    .transaction(() => {
      const applied = applyMigrations(migrations, tags);
      if (isSeeded(db)) return { applied, seeded: false };
      if (!files) throw new Error("seed requis mais fichiers non préparés");
      seedRows(db, files);
      return { applied, seeded: true };
    })
    .immediate();

  console.log(
    `[db] ${path.join(/* turbopackIgnore: true */ dataDir(), "portfolio.db")} : ${outcome.applied} migration(s) appliquée(s), ` +
      (outcome.seeded ? `seed initial effectué` : "déjà seedée : seed ignoré") +
      ` (${Date.now() - started} ms)`,
  );
}
