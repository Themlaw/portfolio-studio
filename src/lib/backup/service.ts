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
 *
 * Lot 76 (écran Admin → Sauvegardes) : les réglages de l'admin priment sur l'environnement (bsettings.ts) et s'appliquent à
 * chaud (`applyBackupSettings`) ; « Sauvegarder maintenant » (`startBackupNow`) ; l'état lisible par l'écran (`getBackupStatus`).
 * Le service est créé paresseusement : sans WITH_BACKUP ni réglage de l'admin, aucun fichier n'est créé tant que personne
 * n'a demandé une sauvegarde.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { statfs } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

import { dataDir } from "@/lib/db";

import { backupDir, BackupSkipped, listArchives, readArchiveManifest, runBackup, type BackupProgress } from "./archive";
import { describeConfig, type BackupConfig, type BackupSources } from "./config";
import { effectiveBackupConfig, envBackupConfig } from "./settings";
import { nextDueAt, Scheduler, type DueReason } from "./schedule";

type Svc = {
  timer?: NodeJS.Timeout;
  scheduler?: Scheduler;
  reader?: Database.Database;
  config?: BackupConfig;
  init?: Promise<Svc | null>;
  lastError?: { message: string; at: number; skipped: boolean } | null;
  progress?: BackupProgress | null;
  startedAt?: number | null;
  lastRun?: { name: string; bytes: number; ms: number; reason: DueReason; at: number } | null;
};
const G = globalThis as typeof globalThis & { __portfolioBackup?: Svc };
const svc = (): Svc => (G.__portfolioBackup ??= {});

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

/** Réglages en vigueur, relus à chaque changement des réglages de l'admin. */
function current(): BackupConfig {
  const s = svc();
  return (s.config ??= effectiveBackupConfig());
}

/** Prépare la connexion de lecture et le déclencheur (idempotent). Crée backup/ : à n'appeler que si on sauvegarde pour de bon. */
function ensureService(): Promise<Svc | null> {
  const s = svc();
  s.init ??= (async () => {
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
      s.reader = reader;
      // Référence prise ICI, après les écritures du démarrage (migrations, nettoyage, file de traitements).
      let seen = reader.pragma("data_version", { simple: true }) as number;

      s.scheduler = new Scheduler(
        {
          // Lus à chaque vérification : les réglages de l'admin s'appliquent sans redémarrage.
          config: {
            get quietMs() {
              return current().quietMs;
            },
            get maxMs() {
              return current().maxMs;
            },
          },
          enabled: () => current().enabled,
          now: () => Date.now(),
          changed: () => {
            const v = reader.pragma("data_version", { simple: true }) as number;
            const changed = v !== seen;
            seen = v;
            return changed;
          },
          run: async (reason) => {
            const config = current();
            s.startedAt = Date.now();
            s.progress = { phase: "preparation", done: 0, total: 0 };
            try {
              const r = await runBackup({ dataDir: root, config, reason, reader, version: process.env.PORTFOLIO_VERSION, onProgress: (p) => (s.progress = p) });
              s.lastError = null;
              s.lastRun = { name: r.name, bytes: r.bytes, ms: r.ms, reason, at: Date.now() };
              console.log(
                `[backup] ${r.name} : ${mo(r.bytes)} en ${(r.ms / 1000).toFixed(1).replace(".", ",")} s (${reason} ; ${r.mediaCount} média(s), ${r.files} fichier(s)) ; ${r.kept} sauvegarde(s) gardée(s)${r.removed ? `, ${r.removed} ancienne(s) supprimée(s)` : ""}${r.shortfall ? ` ; ATTENTION : ${r.shortfall} octet(s) manquants (fichier modifié pendant la copie)` : ""}`,
              );
            } finally {
              s.progress = null;
              s.startedAt = null;
            }
          },
          persist: (st) => writeState(stateFile, st),
          onError: (error) => {
            const skipped = error instanceof BackupSkipped;
            s.lastError = { message: (error as Error)?.message ?? String(error), at: Date.now(), skipped };
            if (skipped) console.warn(`[backup] AVERTISSEMENT : ${(error as Error).message}`);
            else console.error("[backup] ÉCHEC de la sauvegarde :", error);
          },
        },
        { dirty: saved.dirty, lastChangeAt: saved.lastChangeAt, lastBackupAt },
      );

      const loop = (first = false) => {
        s.timer = setTimeout(
          async () => {
            try {
              await s.scheduler!.tick();
            } catch (error) {
              console.error("[backup] erreur inattendue :", error);
            }
            loop();
          },
          // Première vérification peu après le démarrage (la toute première sauvegarde ne concurrence pas le démarrage).
          first ? Math.min(current().pollMs, 10_000) : current().pollMs,
        );
        s.timer.unref();
      };
      loop(true);
      return s;
    } catch (error) {
      console.error("[backup] sauvegardes NON démarrées :", error);
      s.init = undefined;
      return null;
    }
  })();
  return s.init;
}

/** Démarre les sauvegardes si elles sont activées (WITH_BACKUP ou réglage de l'admin) ; ne lève jamais. */
export async function startBackups(): Promise<void> {
  const config = (svc().config = effectiveBackupConfig());
  for (const w of config.warnings) console.warn(`[backup] ${w}`);
  if (!config.enabled) return;
  if (await ensureService()) console.log(`[backup] ${describeConfig(config, backupDir(dataDir()))}`);
}

/** Appelée après l'enregistrement des réglages de l'admin : prise en compte immédiate, sans redémarrage. */
export async function applyBackupSettings(): Promise<void> {
  const s = svc();
  const was = s.config?.enabled ?? false;
  const config = (s.config = effectiveBackupConfig());
  if (config.enabled) {
    if (await ensureService()) console.log(`[backup] réglages mis à jour : ${describeConfig(config, backupDir(dataDir()))}`);
  } else if (was || s.init) {
    console.log("[backup] sauvegardes automatiques désactivées depuis l'admin (les sauvegardes existantes sont gardées)");
  }
}

export type StartResult = { ok: true } | { ok: false; message: string };

/**
 * « Sauvegarder maintenant » : lance la sauvegarde en fond et rend la main tout de suite (l'écran suit l'avancement par
 * getBackupStatus). Fonctionne aussi quand les sauvegardes automatiques sont désactivées.
 */
export async function startBackupNow(): Promise<StartResult> {
  const s = await ensureService();
  if (!s?.scheduler) return { ok: false, message: "Les sauvegardes n'ont pas pu démarrer. Regarde le journal du site." };
  if (s.scheduler.busy) return { ok: false, message: "Une sauvegarde est déjà en cours." };
  // L'échec est déjà noté (onError) : l'écran l'affiche, rien à faire de plus ici.
  void s.scheduler.runNow("manuel").catch(() => undefined);
  return { ok: true };
}

export type ArchiveRow = {
  name: string;
  size: number;
  /** Date de fin d'écriture (ms). */
  at: number;
  version: string | null;
  /** premier | calme | delai | manuel, ou null si le manifest est illisible. */
  reason: string | null;
  /** true : base et médias ; false : base seule ; null : inconnu. */
  withMedia: boolean | null;
  mediaCount: number | null;
};

export type BackupStatus = {
  /** Réglages en vigueur et d'où vient chaque valeur. */
  settings: { enabled: boolean; keep: number; quietMin: number; maxHours: number; media: boolean; sources: BackupSources };
  /** Valeurs sans les réglages de l'admin (environnement, sinon défauts) : pour « revenir à l'origine ». */
  base: { enabled: boolean; keep: number; quietMin: number; maxHours: number; media: boolean };
  running: boolean;
  progress: BackupProgress | null;
  startedAt: number | null;
  lastError: { message: string; at: number; skipped: boolean } | null;
  lastRun: { name: string; bytes: number; ms: number; reason: string; at: number } | null;
  archives: ArchiveRow[];
  /** prevue : `at` ; immediate : bientôt (première ou en retard) ; aucune : rien en attente ; desactivee. */
  next: { kind: "prevue" | "immediate" | "aucune" | "desactivee"; at: number | null };
  free: { bytes: number; total: number } | null;
  now: number;
};

const view = (c: BackupConfig) => ({ enabled: c.enabled, keep: c.keep, quietMin: c.quietMs / 60_000, maxHours: c.maxMs / 3_600_000, media: c.media });

export async function getBackupStatus(): Promise<BackupStatus> {
  const s = svc();
  const config = current();
  const root = dataDir();
  const dir = backupDir(root);
  const list = await listArchives(dir);
  const archives: ArchiveRow[] = [];
  for (const a of [...list].reverse()) {
    const m = await readArchiveManifest(path.join(/* turbopackIgnore: true */ dir, a.name));
    archives.push({ name: a.name, size: a.size, at: a.mtimeMs, version: m?.version ?? null, reason: m?.reason ?? null, withMedia: m?.includesMedia ?? null, mediaCount: m?.mediaCount ?? null });
  }
  const now = Date.now();
  let next: BackupStatus["next"] = { kind: "desactivee", at: null };
  if (config.enabled) {
    const at = s.scheduler ? nextDueAt(s.scheduler.state, config) : now;
    next = at === null ? { kind: "aucune", at: null } : at <= now ? { kind: "immediate", at } : { kind: "prevue", at };
  }
  let free: BackupStatus["free"] = null;
  try {
    const fs = await statfs(dir).catch(() => statfs(root));
    free = { bytes: Number(fs.bavail) * Number(fs.bsize), total: Number(fs.blocks) * Number(fs.bsize) };
  } catch {
    free = null;
  }
  return {
    settings: { ...view(config), sources: config.sources },
    base: view(envBackupConfig()),
    running: s.scheduler?.busy ?? false,
    progress: s.progress ?? null,
    startedAt: s.startedAt ?? null,
    lastError: s.lastError ?? null,
    lastRun: s.lastRun ?? null,
    archives,
    next,
    free,
    now,
  };
}
