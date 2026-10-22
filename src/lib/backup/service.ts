/**
 * Sauvegardes automatiques (lot 50) : câblage du déclenchement (schedule.ts) sur la vraie base et le vrai disque.
 *
 * Détection des modifications : `PRAGMA data_version` sur une connexion LECTURE SEULE à part. SQLite incrémente cette valeur
 * à chaque validation faite par une AUTRE connexion que celle qui la lit : toute écriture du site (pages, brouillons, médias,
 * réglages, thèmes, messages…) est vue, sans qu'aucun appel d'écriture ait à signaler quoi que ce soit (un compteur dans
 * chaque action serait à tenir à jour pour toujours, et un oubli = une modification jamais sauvegardée). Coût : une lecture
 * d'un entier par vérification. Les écritures de fond (file de traitements, sessions) comptent aussi : elles suivent presque
 * toujours un geste de l'artiste ; le pire cas est une sauvegarde de trop, jamais une de moins.
 * L'état « modifications en attente » est écrit dans backup/state.json : un redémarrage juste après une session de travail
 * (mise à jour du conteneur) n'oublie rien.
 *
 * Légèreté : minuterie dans le processus du site (aucune requête bloquée : la copie de la base est par pages, l'archive est
 * écrite en flux, gzip tourne dans le pool de threads de Node et cède la main entre deux blocs) ; une sauvegarde à la fois ;
 * pas de sauvegarde sans place sur le disque. Pas de priorité système plus basse : Node ne sait baisser que celle de tout le
 * processus, ce qui ralentirait aussi le site.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { dataDir } from "@/lib/db";

import { backupDir, BackupSkipped, listArchives, runBackup } from "./archive";
import { describeConfig, readBackupConfig } from "./config";
import { Scheduler } from "./schedule";

type G = typeof globalThis & { __portfolioBackup?: { started: boolean; timer?: NodeJS.Timeout; scheduler?: Scheduler; reader?: Database.Database } };
const G = globalThis as G;

const mo = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} Ko` : `${(b / 1048576).toFixed(1).replace(".", ",")} Mo`);

type Persisted = { dirty: boolean; lastChangeAt: number };

function readState(file: string): Persisted | null {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    if (typeof v?.dirty === "boolean" && typeof v?.lastChangeAt === "number") return v;
  } catch {
    // absent ou illisible : traité comme inconnu
  }
  return null;
}

function writeState(file: string, s: Persisted) {
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s));
    renameSync(tmp, file);
  } catch (error) {
    console.warn("[backup] état non écrit :", (error as Error).message);
  }
}

/** Démarre les sauvegardes si WITH_BACKUP les active ; ne lève jamais (une sauvegarde ne doit pas empêcher le site de démarrer). */
export async function startBackups(): Promise<void> {
  const config = readBackupConfig();
  for (const w of config.warnings) console.warn(`[backup] ${w}`);
  const g = (G.__portfolioBackup ??= { started: false });
  if (!config.enabled || g.started) return;
  g.started = true;
  try {
    const root = dataDir();
    const dir = backupDir(root);
    const stateFile = path.join(/* turbopackIgnore: true */ dir, "state.json");
    mkdirSync(dir, { recursive: true, mode: 0o750 });
    const archives = await listArchives(dir);
    const lastBackupAt = archives.length ? archives[archives.length - 1].mtimeMs : null;
    // Sans état connu mais avec des archives : on suppose des modifications en attente (une sauvegarde de plus, une fois).
    const saved = readState(stateFile) ?? { dirty: archives.length > 0, lastChangeAt: 0 };

    const reader = new Database(path.join(/* turbopackIgnore: true */ root, "portfolio.db"), { readonly: true, fileMustExist: true, timeout: 5000 });
    reader.pragma("busy_timeout = 5000");
    g.reader = reader;
    // Référence prise ICI, après les écritures du démarrage (migrations, nettoyage, file de traitements).
    let seen = reader.pragma("data_version", { simple: true }) as number;

    const scheduler = new Scheduler(
      {
        config,
        now: () => Date.now(),
        changed: () => {
          const v = reader.pragma("data_version", { simple: true }) as number;
          const changed = v !== seen;
          seen = v;
          return changed;
        },
        run: async (reason) => {
          const r = await runBackup({ dataDir: root, config, reason, reader, version: process.env.PORTFOLIO_VERSION });
          console.log(
            `[backup] ${r.name} : ${mo(r.bytes)} en ${(r.ms / 1000).toFixed(1).replace(".", ",")} s (${reason} ; ${r.mediaCount} média(s), ${r.files} fichier(s)) ; ${r.kept} sauvegarde(s) gardée(s)${r.removed ? `, ${r.removed} ancienne(s) supprimée(s)` : ""}${r.shortfall ? ` ; ATTENTION : ${r.shortfall} octet(s) manquants (fichier modifié pendant la copie)` : ""}`,
          );
        },
        persist: (s) => writeState(stateFile, s),
        onError: (error) => {
          if (error instanceof BackupSkipped) console.warn(`[backup] AVERTISSEMENT : ${error.message}`);
          else console.error("[backup] ÉCHEC de la sauvegarde :", error);
        },
      },
      { dirty: saved.dirty, lastChangeAt: saved.lastChangeAt, lastBackupAt },
    );
    g.scheduler = scheduler;
    console.log(`[backup] ${describeConfig(config, dir)}`);

    const loop = () => {
      g.timer = setTimeout(async () => {
        try {
          await scheduler.tick();
        } catch (error) {
          console.error("[backup] erreur inattendue :", error);
        }
        loop();
      }, config.pollMs);
      g.timer.unref();
    };
    // Première vérification peu après le démarrage (la toute première sauvegarde ne concurrence pas le démarrage).
    g.timer = setTimeout(async () => {
      try {
        await scheduler.tick();
      } catch (error) {
        console.error("[backup] erreur inattendue :", error);
      }
      loop();
    }, Math.min(config.pollMs, 10_000));
    g.timer.unref();
  } catch (error) {
    console.error("[backup] sauvegardes NON démarrées :", error);
  }
}
