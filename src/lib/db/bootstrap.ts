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
import { isSeeded, prepareSeedFiles, seedRows, syncPresets, type SeedFiles } from "./seed";
import { collectionPages, dropEmptyTextFields, pinImageFit, renameVideoLook, siteNameI18n, upgradeContent } from "./upgrade";
import { mergeBlocks } from "./blocs";
import { unwrapContainers } from "./unwrap";
import { seedProjectLayouts } from "./project-layout";
import { seedFrameChoices } from "./frame-choice";
import { seedVideoModes } from "./video-mode";

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
  "0016_video_variant": () => {
    const rows = renameVideoLook(getSqlite());
    console.log(`[db] 0016 : présentation du bloc Vidéo (look → variant) — ${rows} ligne(s) réécrite(s)`);
  },
  "0018_site_name_i18n": () => {
    const rows = siteNameI18n(getSqlite());
    console.log(`[db] 0018 : nom du site fr / en — ${rows} réglage(s) réécrit(s)`);
  },
  "0019_image_fit_cover": () => {
    const rows = pinImageFit(getSqlite());
    console.log(`[db] 0019 : images pleine largeur à format imposé figées en « cover » — ${rows} ligne(s) réécrite(s)`);
  },
  "0022_page_collection": () => {
    const rows = collectionPages(getSqlite());
    console.log(`[db] 0022 : collection de page, entrées automatiques si la liste suit les pages, en-têtes de collection → Titre — ${rows} ligne(s) réécrite(s)`);
  },
  "0020_text_fields": () => {
    const rows = dropEmptyTextFields(getSqlite());
    console.log(`[db] 0020 : titres et étiquettes vides des blocs Texte retirés — ${rows} ligne(s) réécrite(s)`);
  },
  "0023_blocs_fusion": () => {
    const r = mergeBlocks(getSqlite());
    console.log(
      `[db] 0023 : « Formulaire de contact » fusionné dans « Contact » (${r.forms}), champs facultatifs vides retirés (Grille, Contact, Profil, CV : ${r.emptied} rubrique(s) de plus), ` +
        `${r.published} ligne(s) publiée(s) et ${r.drafts} brouillon(s) réécrits` +
        (r.legacy ? `, ${r.legacy} ancienne(s) rubrique(s) laissée(s) en lecture (page de plus de 40 rubriques une fois déballée)` : ""),
    );
  },
  "0025_project_layout": () => {
    const rows = seedProjectLayouts(getSqlite());
    console.log(`[db] 0025 : contenu de planche — ${rows} projet(s) reçoivent la bande « Images qui défilent » (rendu inchangé)`);
  },
  "0027_video_mode": () => {
    const r = seedVideoModes(getSqlite());
    console.log(`[db] 0027 : lecture des vidéos (Boucle / Lecteur) — ${r.published} bloc(s) publié(s), ${r.drafts} brouillon(s), ${r.layouts} planche(s) et ${r.draftLayouts} brouillon(s) de planche réécrits`);
  },
  "0029_cadre_choix": () => {
    const r = seedFrameChoices(getSqlite());
    console.log(`[db] 0029 : cadre des photos en un seul choix (Aucun / Cadre du thème / Bande de couleur) — ${r.published} bloc(s) publié(s), ${r.drafts} brouillon(s), ${r.layouts} planche(s) et ${r.draftLayouts} brouillon(s) de planche réécrits`);
  },
  // 0024_corbeille : SQL seul (colonnes deleted_at / trashed_in_menu), aucune migration de contenu.
  "0021_unwrap_containers": () => {
    const r = unwrapContainers(getSqlite());
    console.log(
      `[db] 0021 : conteneurs « Projet mis en avant » déballés — ${r.unwrapped} conteneur(s), ${r.pages} page(s) (${r.published} publiée(s), ${r.drafts} brouillon(s))` +
        (r.kept ? `, ${r.kept} laissé(s) en place (page de plus de 40 blocs une fois déballée)` : ""),
    );
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
      // Base déjà seedée : les thèmes livrés suivent le code (syncPresets, seed.ts ;
      // un thème personnel au même identifiant n'est jamais écrasé).
      if (isSeeded(db)) {
        const [added, updated] = syncPresets(db);
        return { applied, seeded: false, presetsAdded: added, presetsUpdated: updated };
      }
      if (!files) throw new Error("seed requis mais fichiers non préparés");
      seedRows(db, files);
      // Lot 31 : les projets du seed reçoivent leur suite de composants (la bande d'images), comme ceux que migre 0025.
      seedProjectLayouts(sqlite);
      return { applied, seeded: true, presetsAdded: 0, presetsUpdated: 0 };
    })
    .immediate();

  console.log(
    `[db] ${path.join(/* turbopackIgnore: true */ dataDir(), "portfolio.db")} : ${outcome.applied} migration(s) appliquée(s), ` +
      (outcome.seeded ? `seed initial effectué` : "déjà seedée : seed ignoré") +
      (outcome.presetsAdded || outcome.presetsUpdated ? `, thèmes livrés : ${outcome.presetsAdded} ajouté(s), ${outcome.presetsUpdated} mis à jour` : "") +
      ` (${Date.now() - started} ms)`,
  );
}
