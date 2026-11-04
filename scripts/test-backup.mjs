#!/usr/bin/env node
/**
 * Lot 50 — sauvegardes automatiques : logique pure et archive sur une VRAIE base (dossier temporaire), sans serveur
 * (inclus dans npm test). Le test sur un vrai serveur est scripts/e2e-backup50.mjs.
 *  1. Réglages : défauts, secondes de test, valeurs invalides, WITH_BACKUP.
 *  2. Déclenchement, horloge simulée : rien sans modification, calme, délai maximal malgré l'activité, première sauvegarde,
 *     modification PENDANT une sauvegarde, échec (attente), état conservé d'un redémarrage à l'autre.
 *  3. Rotation : on garde les N plus récentes, tri par date, jamais tout supprimé.
 *  3c. Rétention (audit de sécurité P1/P6) : la plus récente de plus de 48 h toujours gardée, sauvegardes manuelles comptées à part,
 *     plafond de place ; et de bout en bout : « garder 1 » + deux « Sauvegarder maintenant » n'effacent pas l'archive d'avant.
 *  4. Détection par data_version (connexion lecture seule) : écriture vue, silence sans écriture.
 *  5. Archive : base cohérente et ouvrable, originaux seulement (variantes exclues), exceptions (original supprimé, seed),
 *     polices, BACKUP_MEDIA=0, noms longs (PAX), lecture par `tar`, aucun .tmp restant, rotation après écriture.
 *  5b. Audit de sécurité P2 : l'instantané n'a ni sessions, ni jetons de vérification, ni compteurs, ni jetons OAuth (la base du
 *     site, elle, les garde) ; cookie de déverrouillage du téléchargement (lié à la session, expiré, falsifié).
 *  6. Restauration (script) : base remplacée, ancien -wal rangé, archive tronquée refusée sans rien changer,
 *     liens symboliques sous le dossier de données refusés sans rien écrire dehors (S3),
 *     puis variantes manquantes remises en file au démarrage (healRestoredMedia).
 * Usage : node --import tsx scripts/test-backup.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { readBackupConfig, describeConfig } = await import("../src/lib/backup/config.ts");
const { Scheduler, dueReason, rotationPlan, retentionPlan, archiveDate, RETENTION, sortArchives, archiveName, failureCooldownMs } = await import("../src/lib/backup/schedule.ts");

/* ---- 1. réglages ---------------------------------------------------------------------------------------------------- */
{
  const d = readBackupConfig({});
  ok("réglages : absent = désactivé", d.enabled === false);
  const on = readBackupConfig({ WITH_BACKUP: "1" });
  ok("réglages : défauts (10 min, 6 h, 3 gardées, médias inclus)", on.enabled && on.quietMs === 600_000 && on.maxMs === 21_600_000 && on.keep === 3 && on.media === true && on.warnings.length === 0);
  ok("réglages : true accepté, 0 / false désactivent", readBackupConfig({ WITH_BACKUP: "true" }).enabled && !readBackupConfig({ WITH_BACKUP: "0" }).enabled && !readBackupConfig({ WITH_BACKUP: "false" }).enabled);
  const t = readBackupConfig({ WITH_BACKUP: "1", BACKUP_QUIET_SEC: "3", BACKUP_QUIET_MIN: "99", BACKUP_KEEP: "5", BACKUP_MAX_HOURS: "1.5", BACKUP_MEDIA: "0" });
  ok("réglages : secondes prioritaires, KEEP, heures décimales, BACKUP_MEDIA=0", t.quietMs === 3000 && t.keep === 5 && t.maxMs === 5_400_000 && t.media === false);
  const bad = readBackupConfig({ WITH_BACKUP: "1", BACKUP_KEEP: "0", BACKUP_QUIET_MIN: "abc", BACKUP_MAX_HOURS: "-2" });
  ok("réglages : valeurs invalides = défauts + avertissements", bad.keep === 3 && bad.quietMs === 600_000 && bad.maxMs === 21_600_000 && bad.warnings.length === 3, JSON.stringify(bad.warnings));
  ok("réglages : WITH_BACKUP incompris = désactivé + avertissement", readBackupConfig({ WITH_BACKUP: "peut-être" }).warnings.length === 1);
  ok("réglages : description lisible", describeConfig(on, "/data/backup").includes("10 min") && describeConfig(on, "/data/backup").includes("6 h"));
}

/* ---- 2. déclenchement, horloge simulée ------------------------------------------------------------------------------- */
{
  const cfg = { quietMs: 10 * 60_000, maxMs: 6 * 3_600_000 };
  const MIN = 60_000;
  const make = (init, extra = {}) => {
    const clock = { t: 1_000_000_000 };
    const ran = [];
    const persisted = [];
    let pending = false;
    const sched = new Scheduler(
      {
        config: cfg,
        now: () => clock.t,
        changed: () => {
          const c = pending;
          pending = false;
          return c;
        },
        run: async (reason) => {
          ran.push({ reason, at: clock.t });
          if (extra.run) await extra.run(reason, clock);
        },
        persist: (s) => persisted.push(s),
        onError: () => {},
      },
      { dirty: false, lastChangeAt: 0, lastBackupAt: clock.t, ...init },
    );
    return { clock, ran, persisted, sched, touch: () => (pending = true) };
  };

  let s = make({});
  for (let i = 0; i < 100; i++) {
    s.clock.t += 30 * MIN;
    await s.sched.tick();
  }
  ok("déclenchement : aucune modification = aucune sauvegarde (50 h de silence)", s.ran.length === 0);

  s = make({});
  s.touch();
  await s.sched.tick();
  s.clock.t += 9 * MIN;
  await s.sched.tick();
  ok("déclenchement : 9 min après la modification, pas encore", s.ran.length === 0);
  s.clock.t += 1 * MIN;
  await s.sched.tick();
  ok("déclenchement : 10 min sans modification = sauvegarde (calme)", eq(s.ran.map((r) => r.reason), ["calme"]));
  s.clock.t += 20 * MIN;
  await s.sched.tick();
  ok("déclenchement : une fois sauvegardé, plus rien tant que rien ne change", s.ran.length === 1);

  // activité continue : une modification toutes les 5 min, jamais 10 min de calme
  s = make({});
  let ticks = 0;
  for (; s.clock.t < 1_000_000_000 + 7 * 3_600_000 && !s.ran.length; ticks++) {
    s.clock.t += 5 * MIN;
    s.touch();
    await s.sched.tick();
  }
  ok("déclenchement : activité continue, sauvegarde au plus 6 h après la précédente (délai)", s.ran.length === 1 && s.ran[0].reason === "delai" && s.ran[0].at - 1_000_000_000 >= 6 * 3_600_000 && s.ran[0].at - 1_000_000_000 < 6 * 3_600_000 + 6 * MIN, JSON.stringify(s.ran));

  // première sauvegarde
  s = make({ lastBackupAt: null });
  await s.sched.tick();
  ok("déclenchement : aucune sauvegarde n'existe = une au premier passage, sans modification", eq(s.ran.map((r) => r.reason), ["premier"]));
  await s.sched.tick();
  ok("déclenchement : puis plus", s.ran.length === 1);

  // modification pendant la sauvegarde
  s = make({}, {
    run: async (_r, clock) => {
      clock.t += 2 * MIN;
      s.touch(); // un geste de l'artiste pendant la copie
      await s.sched.tick(); // vérification concurrente : ne lance pas une seconde sauvegarde
    },
  });
  s.touch();
  await s.sched.tick();
  s.clock.t += 10 * MIN;
  await s.sched.tick(); // sauvegarde n° 1, avec une modification qui arrive pendant
  ok("déclenchement : une seule sauvegarde à la fois (verrou)", s.ran.length === 1);
  ok("déclenchement : la modification arrivée pendant la copie reste à sauvegarder", s.sched.state.dirty === true);
  s.clock.t += 10 * MIN;
  await s.sched.tick();
  ok("déclenchement : et part à son tour après le calme", s.ran.length === 2);

  // échec
  let fail = true;
  s = make({}, { run: async () => { if (fail) throw new Error("disque plein"); } });
  s.touch();
  await s.sched.tick();
  s.clock.t += 10 * MIN;
  await s.sched.tick();
  ok("échec : une tentative, modifications gardées en attente", s.ran.length === 1 && s.sched.state.dirty === true && s.sched.state.lastBackupAt === 1_000_000_000);
  s.clock.t += 30_000;
  await s.sched.tick();
  ok("échec : pas de nouvel essai avant l'attente", s.ran.length === 1);
  fail = false;
  s.clock.t += failureCooldownMs(cfg);
  await s.sched.tick();
  ok("échec : nouvel essai après l'attente, qui réussit", s.ran.length === 2 && s.sched.state.dirty === false);

  // état persisté : écrit aux changements de situation seulement
  s = make({});
  s.touch();
  await s.sched.tick();
  s.touch();
  s.clock.t += MIN;
  await s.sched.tick();
  ok("état : « en attente » écrit une fois (pas à chaque modification)", s.persisted.length === 1 && s.persisted[0].dirty === true);
  s.clock.t += 10 * MIN;
  await s.sched.tick();
  ok("état : remis à zéro au début de la sauvegarde", s.persisted.at(-1).dirty === false);
  // redémarrage juste après une modification : l'état en attente survit
  const r = make({ dirty: true, lastChangeAt: 1_000_000_000 - 20 * MIN });
  await r.sched.tick();
  ok("état : modification d'avant un redémarrage sauvegardée sans attendre", eq(r.ran.map((x) => x.reason), ["calme"]));
  ok("déclenchement : dueReason pur", dueReason({ dirty: true, lastChangeAt: 0, lastBackupAt: 0, notBefore: 0 }, cfg.quietMs, cfg) === "calme" && dueReason({ dirty: false, lastChangeAt: 0, lastBackupAt: 0, notBefore: 0 }, 1e12, cfg) === null);
}

/* ---- 3. rotation ---------------------------------------------------------------------------------------------------- */
{
  const names = ["portfolio-20260101-120000.tar.gz", "portfolio-20260103-090000.tar.gz", "portfolio-20260102-235959.tar.gz", "portfolio-20260103-090000-1.tar.gz", "autre.tar.gz", "portfolio-20260104-000000.tar.gz.tmp"];
  ok("rotation : tri par date, suffixe après l'original, fichiers étrangers ignorés", eq(sortArchives(names), ["portfolio-20260101-120000.tar.gz", "portfolio-20260102-235959.tar.gz", "portfolio-20260103-090000.tar.gz", "portfolio-20260103-090000-1.tar.gz"]));
  ok("rotation : garde les 3 plus récentes (supprime la plus ancienne)", eq(rotationPlan(names, 3), ["portfolio-20260101-120000.tar.gz"]));
  ok("rotation : keep 1 garde la dernière seulement", rotationPlan(names, 1).length === 3);
  ok("rotation : jamais tout supprimer (keep 0 = 1)", rotationPlan(names, 0).length === 3);
  ok("rotation : moins d'archives que gardées = rien à supprimer", rotationPlan(names.slice(0, 2), 3).length === 0);
  ok("nom : portfolio-AAAAMMJJ-HHMMSS.tar.gz", archiveName(new Date(2026, 8, 5, 4, 3, 2)) === "portfolio-20260905-040302.tar.gz" && archiveName(new Date(2026, 8, 5, 4, 3, 2), 2) === "portfolio-20260905-040302-2.tar.gz");
}

/* ---- 3c. rétention : une session volée ne vide pas les sauvegardes (P1), place plafonnée (P6) ------------------------- */
{
  const H = 3_600_000;
  const at = (d) => archiveName(d);
  const t0 = new Date(2026, 8, 1, 10, 0, 0);
  const plus = (h) => new Date(t0.getTime() + h * H);
  const A = (h, manual = false, size = 100) => ({ name: at(plus(h)), size, manual });
  ok("rétention : date relue dans le nom (heure locale)", archiveDate(at(t0))?.getTime() === t0.getTime() && archiveDate(`${at(t0).slice(0, -7)}-2.tar.gz`)?.getTime() === t0.getTime() && archiveDate("autre.tar.gz") === null);
  ok("rétention : config par défaut 30 % du disque, valeur hors bornes refusée", readBackupConfig({}).maxDiskPct === 30 && readBackupConfig({ BACKUP_MAX_DISK_PCT: "200" }).maxDiskPct === 30 && readBackupConfig({ BACKUP_MAX_DISK_PCT: "200" }).warnings.length === 1 && readBackupConfig({ BACKUP_MAX_DISK_PCT: "50" }).maxDiskPct === 50);
  // scénario de l'audit : archive de la veille de l'intrusion, puis « garder 1 » et deux sauvegardes manuelles
  const list = [A(0), A(72), A(73, true), A(73.1, true)];
  const now = plus(73.2).getTime();
  ok("rétention : avant le correctif, keep 1 ne gardait que la dernière (référence)", rotationPlan(list.map((a) => a.name), 1).length === 3);
  const doomed = retentionPlan(list, { keep: 1, now });
  ok("rétention : keep 1 + deux manuelles : l'archive de plus de 48 h ET l'automatique restent", doomed.length === 0, JSON.stringify(doomed));
  ok("rétention : seule la PLUS RÉCENTE de plus de 48 h est protégée", eq(retentionPlan([A(0), A(10), A(72)], { keep: 1, now }), [at(plus(0))]));
  const spam = [A(0), A(72), ...[1, 2, 3, 4, 5].map((i) => A(72 + i / 10, true))];
  const sd = retentionPlan(spam, { keep: 1, now });
  ok(`rétention : « Sauvegarder maintenant » en boucle ne fait tourner que la réserve manuelle (${RETENTION.manualKeep})`, eq(sd, [at(plus(72.1)), at(plus(72.2))]), JSON.stringify(sd));
  ok("rétention : les manuelles ne poussent jamais dehors une automatique", eq(retentionPlan([A(70), A(71), A(72), A(72.5, true), A(72.6, true)], { keep: 3, now }), []));
  ok("rétention : sans archive de plus de 48 h, keep s'applique comme avant", eq(retentionPlan([A(60), A(61), A(62)], { keep: 2, now }), [at(plus(60))]));
  // plafond de place : les plus anciennes NON protégées partent d'abord, la dernière et la protégée jamais
  const big = [A(0, false, 400), A(50, false, 400), A(60, false, 400), A(70, false, 400)];
  ok("rétention : plafond de place, retire les plus anciennes non protégées", eq(retentionPlan(big, { keep: 30, now, maxBytes: 1000 }), [at(plus(50)), at(plus(60))]));
  ok("rétention : plafond trop bas, la dernière et la plus récente de plus de 48 h restent", eq(retentionPlan(big, { keep: 30, now, maxBytes: 1 }), [at(plus(50)), at(plus(60))]));
}

/* ---- 3b. lot 76 : réglages de l'admin, origine des valeurs, prochaine date, sauvegarde à la demande, téléchargement ------- */
{
  const { sanitizeOverrides } = await import("../src/lib/backup/config.ts");
  const { nextDueAt } = await import("../src/lib/backup/schedule.ts");
  const { parseRange, isArchiveName } = await import("../src/lib/backup/download.ts");
  const env = { WITH_BACKUP: "1", BACKUP_KEEP: "5", BACKUP_QUIET_SEC: "4" };
  const base = readBackupConfig(env);
  ok("admin76 origine : environnement et défauts dits", base.sources.enabled === "env" && base.sources.keep === "env" && base.sources.quietMin === "env" && base.sources.maxHours === "defaut" && base.sources.media === "defaut", JSON.stringify(base.sources));
  const over = readBackupConfig(env, { keep: 2, quietMin: 20, media: false, enabled: false });
  ok("admin76 un réglage de l'admin PRIME sur l'environnement", over.keep === 2 && over.quietMs === 1_200_000 && over.media === false && over.enabled === false, JSON.stringify(over));
  ok("admin76 origine : « réglé ici » pour ces champs seulement", over.sources.keep === "reglage" && over.sources.quietMin === "reglage" && over.sources.media === "reglage" && over.sources.enabled === "reglage" && over.sources.maxHours === "defaut");
  const only = readBackupConfig({}, { enabled: true });
  ok("admin76 activé depuis l'admin sans WITH_BACKUP", only.enabled === true && only.sources.enabled === "reglage" && only.keep === 3);
  ok("admin76 réglage retiré = retour à l'environnement", readBackupConfig(env, {}).keep === 5);
  ok("admin76 valeur d'env invalide : source « défaut »", readBackupConfig({ BACKUP_KEEP: "abc" }).sources.keep === "defaut");
  ok("admin76 données stockées abîmées ignorées", eq(sanitizeOverrides({ keep: -1, quietMin: "x", maxHours: 9999, enabled: "oui", media: true, intrus: 1 }), { media: true }) && eq(sanitizeOverrides(null), {}) && eq(sanitizeOverrides([1]), {}));
  ok("admin76 données stockées valides conservées", eq(sanitizeOverrides({ keep: 4, quietMin: 15, maxHours: 2, enabled: true, media: false }), { enabled: true, media: false, keep: 4, quietMin: 15, maxHours: 2 }));

  const c = { quietMs: 600_000, maxMs: 21_600_000 };
  const st = (o) => ({ dirty: false, lastChangeAt: 0, lastBackupAt: 1_000_000, notBefore: 0, ...o });
  ok("admin76 prochaine : aucune modification = rien de prévu", nextDueAt(st({}), c) === null);
  ok("admin76 prochaine : calme (dernière modif + quiétude)", nextDueAt(st({ dirty: true, lastChangeAt: 2_000_000 }), c) === 2_600_000);
  ok("admin76 prochaine : délai maximal si plus proche", nextDueAt(st({ dirty: true, lastChangeAt: 21_500_000, lastBackupAt: 1_000_000 }), c) === 22_600_000 || nextDueAt(st({ dirty: true, lastChangeAt: 21_500_000, lastBackupAt: 1_000_000 }), c) === 22_100_000);
  ok("admin76 prochaine : première sauvegarde = tout de suite", nextDueAt(st({ lastBackupAt: null }), c) === 0);
  ok("admin76 prochaine : après un échec, pas avant notBefore", nextDueAt(st({ dirty: true, lastChangeAt: 0, notBefore: 9_999_999 }), c) === 9_999_999);

  // « Sauvegarder maintenant » : sans attendre, même verrou, échec relancé à l'appelant et noté.
  let release;
  const ran = [];
  const errs = [];
  const sched = new Scheduler({ config: c, now: () => 5_000_000, changed: () => false, run: (r) => { ran.push(r); return new Promise((res) => (release = res)); }, onError: (e) => errs.push(e.message) }, { dirty: false, lastChangeAt: 0, lastBackupAt: 4_000_000 });
  const first = sched.runNow();
  ok("admin76 à la demande : part sans modification ni délai", ran.length === 1 && ran[0] === "manuel" && sched.busy);
  ok("admin76 à la demande : une seule à la fois (refusée pendant une sauvegarde)", (await sched.runNow()) === false && (await sched.tick()) === null && ran.length === 1);
  release();
  ok("admin76 à la demande : terminée, verrou libéré", (await first) === true && !sched.busy && sched.state.lastBackupAt === 5_000_000);
  const bad = new Scheduler({ config: c, now: () => 5_000_000, changed: () => false, run: async () => { throw new Error("disque plein"); }, onError: (e) => errs.push(e.message) }, { dirty: true, lastChangeAt: 1, lastBackupAt: 1 });
  let thrown = "";
  await bad.runNow().catch((e) => (thrown = e.message));
  ok("admin76 à la demande : échec noté ET relancé, modifications gardées en attente", thrown === "disque plein" && errs.includes("disque plein") && bad.state.dirty === true && !bad.busy);
  let enabledFlag = false;
  const ranOff = [];
  const off = new Scheduler({ config: c, now: () => 99_999_999_999, changed: () => true, enabled: () => enabledFlag, run: async (r) => void ranOff.push(r) }, { dirty: false, lastChangeAt: 0, lastBackupAt: 1 });
  await off.tick();
  ok("admin76 désactivé : modifications relevées, aucune sauvegarde", ranOff.length === 0 && off.state.dirty === true);
  enabledFlag = true;
  await off.tick();
  ok("admin76 réactivé : la sauvegarde en attente part", ranOff.length === 1);

  ok("admin76 nom d'archive : forme stricte seulement", isArchiveName("portfolio-20261024-101500.tar.gz") && isArchiveName("portfolio-20261024-101500-2.tar.gz") && !isArchiveName("../portfolio.db") && !isArchiveName("portfolio-20261024-101500.tar.gz/../x") && !isArchiveName("portfolio-20261024-101500.tar.gz.tmp") && !isArchiveName("state.json"));
  ok("admin76 Range : plage, fin ouverte, suffixe", eq(parseRange("bytes=0-99", 1000), { start: 0, end: 99 }) && eq(parseRange("bytes=900-", 1000), { start: 900, end: 999 }) && eq(parseRange("bytes=-100", 1000), { start: 900, end: 999 }) && eq(parseRange("bytes=10-5000", 1000), { start: 10, end: 999 }));
  ok("admin76 Range : hors fichier = 416, plusieurs plages ou absent = réponse complète", parseRange("bytes=1000-", 1000) === "unsatisfiable" && parseRange("bytes=-0", 1000) === "unsatisfiable" && parseRange("bytes=0-1,5-6", 1000) === null && parseRange(null, 1000) === null && parseRange("bytes=-", 1000) === null);
}

/* ---- 4 et 5. archive sur une vraie base --------------------------------------------------------------------------- */
const { runBackup, listArchives, storageToSave, BackupSkipped } = await import("../src/lib/backup/archive.ts");
const { extractAll, readManifest, restore, archiveWarnings, isNewer } = await import("./restore-backup.mjs");
const tmp = mkdtempSync(path.join(process.env.TEST_TMP ?? tmpdir(), "pf-test-backup-"));
try {
  const data = path.join(tmp, "data");
  mkdirSync(path.join(data, "media/originals"), { recursive: true });
  mkdirSync(path.join(data, "media/img/aaaaaaaaaaaaaaaa"), { recursive: true });
  mkdirSync(path.join(data, "media/vid/bbbbbbbbbbbbbbbb"), { recursive: true });
  mkdirSync(path.join(data, "fonts"), { recursive: true });
  mkdirSync(path.join(data, "cache/crops"), { recursive: true });
  mkdirSync(path.join(data, "tmp"), { recursive: true });
  const w = (rel, content) => writeFileSync(path.join(data, rel), content);
  const longName = `${"x".repeat(60)}-${"y".repeat(60)}.svg`; // > 100 octets avec le dossier : enregistrement PAX
  w("media/originals/orig1.png", Buffer.alloc(300_000, 1));
  w("media/img/aaaaaaaaaaaaaaaa/800.webp", "variante-regenerable");
  w("media/originals/orig2.mp4", "vieil-original");
  w("media/vid/bbbbbbbbbbbbbbbb/720.mp4", "video-convertie-sans-original");
  w("media/seed-logo.svg", "<svg/>");
  w(`media/${longName}`, "<svg id='long'/>");
  w("fonts/Inter-400.woff2", "police");
  // lot 85 : ce qui n'a pas de ligne dans la table media
  for (const d of ["media/kit", "media/icons/1-abcd1234", "media/icons-auto/fp1", "media/inconnu/sous-dossier", "cache/kits/manifests"]) mkdirSync(path.join(data, d), { recursive: true });
  w("media/kit/0123456789abcdef.svg", "<svg id='kit'/>");
  w("media/icons/1-abcd1234/512.png", "icone-image");
  w("media/icons-auto/fp1/32.png", "icone-auto");
  w("media/inconnu/sous-dossier/piece.bin", "dossier-imprevu");
  w("media/originals/reste.tmp", "ecriture-interrompue");
  w("cache/kits/manifests/export1.json", "{}");
  w("cache/crops/x.webp", "cache");
  w("tmp/envoi.part", "partiel");
  const main = new Database(path.join(data, "portfolio.db"));
  main.pragma("journal_mode = WAL");
  main.exec("create table media(id integer primary key, key text, variants text, status text); create table notes(v text);");
  const addMedia = (key, variants) => main.prepare("insert into media(key, variants) values (?, ?)").run(key, variants ? JSON.stringify(variants) : null);
  addMedia("originals/orig1.png", { v: 1, files: [{ key: "img/aaaaaaaaaaaaaaaa/800.webp", size: 20 }] });
  addMedia("originals/gone.mp4", { v: 1, originalRemoved: true, files: [{ key: "vid/bbbbbbbbbbbbbbbb/720.mp4", size: 29 }] });
  addMedia("seed-logo.svg", null);
  addMedia(longName, null);
  main.prepare("insert into notes values (?)").run("avant");
  // Audit P2 : tables de Better Auth avec des secrets reconnaissables (mêmes colonnes que src/lib/db/schema.ts).
  main.exec(`create table user(id text primary key, email text);
    create table session(id text primary key, token text, user_id text, created_at integer);
    create table account(id text primary key, user_id text, provider_id text, access_token text, refresh_token text, id_token text, access_token_expires_at integer, refresh_token_expires_at integer, password text);
    create table verification(id text primary key, identifier text, value text);
    create table rate_limit(id text primary key, key text, count integer, last_request integer);`);
  main.prepare("insert into user values ('u1', 'artiste@example.test')").run();
  main.prepare("insert into session values ('s1', 'JETON-DE-SESSION-SECRET-P2', 'u1', 1)").run();
  main.prepare("insert into account values ('a1', 'u1', 'authentik', 'ACCES-OAUTH-SECRET-P2', 'RAFRAICHI-OAUTH-SECRET-P2', 'ID-OAUTH-SECRET-P2', 5, 6, null), ('a2', 'u1', 'credential', null, null, null, null, null, 'sel:empreinte-scrypt')").run();
  main.prepare("insert into verification values ('v1', 'reset', 'JETON-DE-VERIFICATION-SECRET-P2')").run();
  main.prepare("insert into rate_limit values ('r1', '203.0.113.9/sign-in', 3, 1)").run();

  // 4. data_version
  const reader = new Database(path.join(data, "portfolio.db"), { readonly: true, fileMustExist: true });
  const v0 = reader.pragma("data_version", { simple: true });
  ok("modifications : stable sans écriture", reader.pragma("data_version", { simple: true }) === v0);
  main.prepare("insert into notes values (?)").run("pendant");
  const v1 = reader.pragma("data_version", { simple: true });
  ok("modifications : une écriture du site change data_version (connexion lecture seule)", v1 !== v0);
  ok("modifications : relue sans écriture, stable", reader.pragma("data_version", { simple: true }) === v1);

  // 5. archive
  const dir = path.join(data, "backup");
  const cfg = { media: true, keep: 3 };
  let stamp = new Date(2026, 8, 5, 10, 0, 0);
  const run = (over = {}) => runBackup({ dataDir: data, config: { ...cfg, ...over }, reason: "calme", reader, version: "9.9.9", now: () => stamp });
  const r1 = await run();
  ok("archive : fichier portfolio-AAAAMMJJ-HHMMSS.tar.gz", r1.name === "portfolio-20260905-100000.tar.gz" && existsSync(path.join(dir, r1.name)));
  ok("archive : aucun .tmp ni instantané restant", readdirSync(dir).every((n) => !n.endsWith(".tmp")), readdirSync(dir).join(","));
  const listing = spawnSync("tar", ["tzf", path.join(dir, r1.name)], { encoding: "utf8" });
  ok("archive : lisible par tar", listing.status === 0 && listing.stdout.includes("portfolio.db") && listing.stdout.includes(longName), listing.stderr);
  const out = path.join(tmp, "out1");
  mkdirSync(out);
  const files = await extractAll(path.join(dir, r1.name), out);
  const sorted = [...files].sort();
  ok("archive : manifest, base, originaux, original-orphelin et seed, police ; ni variantes régénérables ni cache ni tmp", eq(sorted, ["cache/kits/manifests/export1.json", "fonts/Inter-400.woff2", "manifest.json", `media/${longName}`, "media/icons/1-abcd1234/512.png", "media/inconnu/sous-dossier/piece.bin", "media/kit/0123456789abcdef.svg", "media/originals/orig1.png", "media/originals/orig2.mp4", "media/seed-logo.svg", "media/vid/bbbbbbbbbbbbbbbb/720.mp4", "portfolio.db"].sort()), sorted.join(","));
  ok("lot 85 archive par exclusion : kit/, icons/, dossier imprévu et fiches de kit y sont ; ni variantes d'un original présent, ni icons-auto/, cache/, tmp/, *.tmp", !sorted.some((f) => /^media\/(img|icons-auto)\//.test(f) || f.endsWith(".tmp") || f.startsWith("tmp/") || f.startsWith("cache/crops")));
  const snap = new Database(path.join(out, "portfolio.db"), { readonly: true });
  ok("archive : la base s'ouvre, intègre, avec les modifications faites avant la copie", snap.pragma("integrity_check", { simple: true }) === "ok" && snap.prepare("select count(*) n from notes").get().n === 2 && snap.prepare("select count(*) n from media").get().n === 4);
  ok("P2 instantané : sessions, vérifications et compteurs vidés", ["session", "verification", "rate_limit"].every((t) => snap.prepare(`select count(*) n from ${t}`).get().n === 0));
  const acc = snap.prepare("select * from account order by id").all();
  ok("P2 instantané : jetons OAuth effacés, empreinte du mot de passe et comptes gardés (restauration : on se reconnecte)", acc.length === 2 && acc.every((a) => a.access_token === null && a.refresh_token === null && a.id_token === null && a.access_token_expires_at === null && a.refresh_token_expires_at === null) && acc[1].password === "sel:empreinte-scrypt" && snap.prepare("select count(*) n from user").get().n === 1);
  snap.close();
  const rawDb = readFileSync(path.join(out, "portfolio.db"));
  ok("P2 instantané : aucun octet des secrets dans le fichier (VACUUM, secure_delete)", !/SECRET-P2/.test(rawDb.toString("latin1")));
  ok("P2 : la base du SITE garde ses sessions et jetons (seule la copie est nettoyée)", main.prepare("select count(*) n from session").get().n === 1 && main.prepare("select access_token t from account where id = 'a1'").get().t === "ACCES-OAUTH-SECRET-P2");
  ok("P2 : ni -wal ni -journal de l'instantané laissés dans backup/", readdirSync(dir).every((n) => !/snapshot/.test(n)), readdirSync(dir).join(","));
  ok("archive : original octet pour octet (flux)", readFileSync(path.join(out, "media/originals/orig1.png")).equals(Buffer.alloc(300_000, 1)));
  const man = await readManifest(path.join(dir, r1.name));
  ok("lot 85 manifest : catégories comptées, archive complète, rien de manquant", man.complete === true && man.storage?.kit?.files === 1 && man.storage?.icons?.files === 1 && man.storage?.kitManifests?.files === 1 && man.storage?.originals?.files === 2 && man.missingRefs?.count === 0 && man.regenerable?.variants?.files === 1 && man.regenerable?.iconsAuto?.files === 1, JSON.stringify(man));
  ok("manifest : version, date, nombre de médias, taille", man.version === "9.9.9" && man.createdAt === stamp.toISOString() && man.mediaCount === 4 && man.bytes > 300_000 && man.includesMedia === true, JSON.stringify(man));
  ok("archive : fichier vivant modifié pendant la copie impossible (originaux immuables) : aucun octet manquant", r1.shortfall === 0);

  // rotation à 3 avec 5 sauvegardes, la plus ancienne partie en dernier
  const made = [r1.name];
  for (let i = 1; i <= 4; i++) {
    main.prepare("insert into notes values (?)").run(`n${i}`);
    stamp = new Date(2026, 8, 5, 10, i, 0);
    const r = await run();
    made.push(r.name);
    ok(`rotation : après ${i + 1} sauvegarde(s), ${Math.min(3, i + 1)} gardée(s)`, r.kept === Math.min(3, i + 1) && (await listArchives(dir)).length === Math.min(3, i + 1));
  }
  ok("rotation : ce sont les 3 plus récentes", eq((await listArchives(dir)).map((a) => a.name), made.slice(2)));
  // même seconde : pas d'écrasement
  const dup = await run();
  ok("archive : deux sauvegardes dans la même seconde ne s'écrasent pas", dup.name === "portfolio-20260905-100400-1.tar.gz" && existsSync(path.join(dir, "portfolio-20260905-100400.tar.gz")), dup.name);

  // base seule
  stamp = new Date(2026, 8, 5, 11, 0, 0);
  const rd = await run({ media: false });
  const outDb = path.join(tmp, "out2");
  mkdirSync(outDb);
  const dbFiles = (await extractAll(path.join(dir, rd.name), outDb)).sort();
  ok("BACKUP_MEDIA=0 : base, manifest, polices, et (lot 85) kit/, icons/ et fiches de kit", eq(dbFiles, ["cache/kits/manifests/export1.json", "fonts/Inter-400.woff2", "manifest.json", "media/icons/1-abcd1234/512.png", "media/kit/0123456789abcdef.svg", "portfolio.db"]) && (await readManifest(path.join(dir, rd.name))).includesMedia === false, dbFiles.join(","));

  // échec : les archives existantes restent intactes
  const before = (await listArchives(dir)).map((a) => `${a.name}:${a.size}`);
  const closed = new Database(path.join(data, "portfolio.db"), { readonly: true });
  closed.close();
  let threw = false;
  try {
    stamp = new Date(2026, 8, 5, 12, 0, 0);
    await runBackup({ dataDir: data, config: cfg, reason: "calme", reader: closed, now: () => stamp });
  } catch {
    threw = true;
  }
  ok("échec : exception, archives existantes intactes, aucun .tmp", threw && eq((await listArchives(dir)).map((a) => `${a.name}:${a.size}`), before) && readdirSync(dir).every((n) => !n.endsWith(".tmp")));
  ok("échec : renoncement volontaire = classe BackupSkipped", new BackupSkipped("x") instanceof Error);
  const plan = await storageToSave([{ key: "originals/orig1.png", variants: "pas du json" }, { key: "originals/absent.png", variants: null }], path.join(data, "media"));
  ok("médias : variantes illisibles = dossier non prouvé régénérable, donc sauvegardé ; original absent sans erreur", plan.files.some((f) => f.key === "originals/orig1.png") && plan.files.some((f) => f.key === "img/aaaaaaaaaaaaaaaa/800.webp"));

  /* ---- 5b. cookie de déverrouillage du téléchargement (audit P2) ---- */
  {
    const { unlockValue, isUnlocked, isFreshSession, readCookie, UNLOCK_TTL_MS } = await import("../src/lib/backup/unlock.ts");
    const S = "secret-de-test-0123456789abcdef-0123456789";
    const t = 1_800_000_000_000;
    const v = unlockValue(S, "sess-1", t);
    ok("P2 déverrouillage : valable pour sa session, pendant 10 min", isUnlocked(S, "sess-1", v, t + 1000) && isUnlocked(S, "sess-1", v, t + UNLOCK_TTL_MS - 1));
    ok("P2 déverrouillage : expiré, autre session, autre secret, signature ou date falsifiée = refusé", !isUnlocked(S, "sess-1", v, t + UNLOCK_TTL_MS + 1) && !isUnlocked(S, "sess-2", v, t + 1000) && !isUnlocked("autre-secret-0123456789abcdef-0123456789", "sess-1", v, t + 1000) && !isUnlocked(S, "sess-1", `${v.slice(0, -2)}AA`, t + 1000) && !isUnlocked(S, "sess-1", `${t + 9e9}.${v.split(".")[1]}`, t + 1000) && !isUnlocked(S, "sess-1", null) && !isUnlocked(S, "sess-1", "x".repeat(500)));
    ok("P2 connexion récente : moins de 10 min oui, plus non, date future non", isFreshSession(t - 60_000, t) && !isFreshSession(t - 11 * 60_000, t) && !isFreshSession(t + 60_000, t) && !isFreshSession("pas une date", t));
    ok("P2 lecture du cookie dans l'en-tête brut", readCookie("a=1; pf-backup-unlock=abc.def; b=2", "pf-backup-unlock") === "abc.def" && readCookie("x-pf-backup-unlock=1", "pf-backup-unlock") === null && readCookie(null, "x") === null);
  }

  /* ---- 6. restauration ------------------------------------------------------------------------------------------ */
  const target = path.join(tmp, "restored");
  mkdirSync(path.join(target, "media"), { recursive: true });
  const old = new Database(path.join(target, "portfolio.db"));
  old.exec("create table notes(v text); insert into notes values ('ancienne-base');");
  old.close();
  writeFileSync(path.join(target, "portfolio.db-wal"), "wal-oublie");
  writeFileSync(path.join(target, "portfolio.db-shm"), "shm-oublie");
  const arch = path.join(dir, dup.name); // une archive avec médias
  // archive tronquée : refusée, rien ne change
  const cut = path.join(tmp, "cut.tar.gz");
  writeFileSync(cut, readFileSync(arch).subarray(0, Math.floor(statSync(arch).size / 2)));
  let cutFailed = false;
  try {
    await restore(cut, target);
  } catch {
    cutFailed = true;
  }
  const oldDb = new Database(path.join(target, "portfolio.db"), { readonly: true });
  ok("restauration : archive tronquée refusée, ancienne base et dossier de travail intacts", cutFailed && oldDb.prepare("select v from notes").get().v === "ancienne-base" && existsSync(path.join(target, "portfolio.db-wal")) && readdirSync(target).every((n) => !n.startsWith("restore-tmp")), readdirSync(target).join(","));
  oldDb.close();
  const res = await restore(arch, target);
  const noStale = !existsSync(path.join(target, "portfolio.db-wal")) && !existsSync(path.join(target, "portfolio.db-shm")); // avant d'ouvrir la base (l'ouverture en crée)
  const back = new Database(path.join(target, "portfolio.db"), { readonly: true });
  ok("restauration : base de l'archive en place, -wal et -shm anciens retirés", back.prepare("select count(*) n from media").get().n === 4 && noStale);
  back.close();
  ok("restauration : ancienne base rangée (pas effacée)", res.previous && existsSync(path.join(res.previous, "portfolio.db")) && existsSync(path.join(res.previous, "portfolio.db-wal")));
  ok("restauration : originaux, polices et manifest posés ; dossier de travail supprimé", existsSync(path.join(target, "media/originals/orig1.png")) && existsSync(path.join(target, "fonts/Inter-400.woff2")) && existsSync(path.join(target, "manifest.json")) && readdirSync(target).every((n) => !n.startsWith("restore-tmp")));

  /* liens symboliques dans le dossier de données (S3) : un site compromis remplace un dossier par un lien vers l'extérieur
     (ex. fonts → /etc) et attend une restauration en root. Refus net, rien d'écrit dans la cible du lien, ancienne base en place. */
  {
    const { assertNoSymlink } = await import("./restore-backup.mjs");
    const cases = [
      ["fonts", "fonts → dossier extérieur"],
      ["media/originals", "media/originals → dossier extérieur (lien sous un vrai dossier)"],
      ["cache", "cache → dossier extérieur (vidé de crops, puis chown)"],
      ["portfolio.db", "portfolio.db → fichier extérieur"],
    ];
    for (const [rel, label] of cases) {
      const dir = path.join(tmp, `lien-${rel.replace(/\W/g, "-")}`);
      const outside = path.join(tmp, `dehors-${rel.replace(/\W/g, "-")}`);
      mkdirSync(path.join(dir, "media"), { recursive: true });
      mkdirSync(path.join(outside, "crops"), { recursive: true });
      writeFileSync(path.join(outside, "crops", "temoin.txt"), "ne pas toucher");
      const db0 = new Database(path.join(dir, "portfolio.db"));
      db0.exec("create table notes(v text); insert into notes values ('base-avant-lien');");
      db0.close();
      if (rel === "portfolio.db") {
        renameSync(path.join(dir, "portfolio.db"), path.join(outside, "victime.db"));
        symlinkSync(path.join(outside, "victime.db"), path.join(dir, rel));
      } else {
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        symlinkSync(outside, path.join(dir, rel), "dir");
      }
      const before = readdirSync(outside).sort().join(",");
      const ownerBefore = statSync(outside).uid;
      let err = null;
      try {
        await restore(arch, dir);
      } catch (e) {
        err = e;
      }
      const left = readdirSync(dir);
      const dbStill = rel === "portfolio.db" ? existsSync(path.join(outside, "victime.db")) : new Database(path.join(dir, "portfolio.db"), { readonly: true }).prepare("select v from notes").get()?.v === "base-avant-lien";
      ok(
        `restauration S3 : lien symbolique ${label} refusé ; rien d'écrit dehors, ancienne base en place, aucun dossier de travail`,
        /lien symbolique/.test(err?.message ?? "") && readdirSync(outside).sort().join(",") === before && existsSync(path.join(outside, "crops", "temoin.txt")) && statSync(outside).uid === ownerBefore && dbStill && lstatSync(path.join(dir, rel)).isSymbolicLink() && left.every((n) => !n.startsWith("restore-tmp") && !n.startsWith("restore-previous")),
        `${err?.message} | dehors : ${readdirSync(outside).join(",")} | données : ${left.join(",")}`,
      );
    }
    // Le dossier de données lui-même peut être un lien (choix de celui qui restaure) : accepté, restauré dans sa cible réelle.
    const real = path.join(tmp, "donnees-reelles");
    mkdirSync(real, { recursive: true });
    const viaLink = path.join(tmp, "donnees-lien");
    symlinkSync(real, viaLink, "dir");
    const viaRes = await restore(arch, viaLink).then(
      () => true,
      (e) => e.message,
    );
    ok("restauration S3 : dossier de données donné par un lien accepté (restauré dans la cible réelle)", viaRes === true && existsSync(path.join(real, "portfolio.db")) && existsSync(path.join(real, "fonts/Inter-400.woff2")), String(viaRes));
    // assertNoSymlink : chemins sans lien ou pas encore créés acceptés ; lien en fin de chemin refusé.
    const plain = await assertNoSymlink(target, "media/originals/orig1.png").then(() => true, () => false);
    const absent = await assertNoSymlink(target, "nouveau/dossier/fichier").then(() => true, () => false);
    const lastIsLink = await assertNoSymlink(tmp, "donnees-lien").then(() => true, () => false);
    ok("restauration S3 : assertNoSymlink accepte un chemin réel ou à créer, refuse un lien même en dernier composant", plain && absent && !lastIsLink);
  }

  /* variantes manquantes → remises en file au démarrage (vraie base migrée) */
  const heal = path.join(tmp, "heal");
  mkdirSync(path.join(heal, "media/originals"), { recursive: true });
  process.env.DATA_DIR = heal;
  const log = console.log;
  console.log = () => {};
  const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
  await bootstrap();
  const { getDb, schema } = await import("../src/lib/db/index.ts");
  const { healRestoredMedia } = await import("../src/lib/backup/restore.ts");
  const { eq: dEq } = await import("drizzle-orm");
  const db = getDb();
  const mk = (name, variants, withOriginal) => {
    if (withOriginal) writeFileSync(path.join(heal, "media/originals", `${name}.png`), "png");
    return db.insert(schema.media).values({ key: `originals/${name}.png`, sha256: name.padEnd(64, "0"), kind: "image", mime: "image/png", originalName: `${name}.png`, size: 3, status: "ready", variants, alt: { fr: "", en: "" } }).returning({ id: schema.media.id }).get().id;
  };
  const missing = mk("manque", { v: 1, files: [{ key: "img/cccccccccccccccc/800.webp", size: 1, format: "webp", width: 800 }] }, true);
  const lost = mk("perdu", { v: 1, files: [{ key: "img/dddddddddddddddd/800.webp", size: 1, format: "webp", width: 800 }] }, false);
  mkdirSync(path.join(heal, "media/img/eeeeeeeeeeeeeeee"), { recursive: true });
  writeFileSync(path.join(heal, "media/img/eeeeeeeeeeeeeeee/800.webp"), "v");
  const fine = mk("complet", { v: 1, files: [{ key: "img/eeeeeeeeeeeeeeee/800.webp", size: 1, format: "webp", width: 800 }] }, true);
  await healRestoredMedia();
  ok("démarrage : sans manifest.json à la racine, rien ne bouge", db.select().from(schema.jobs).where(dEq(schema.jobs.mediaId, missing)).all().length === 0 && db.select().from(schema.media).where(dEq(schema.media.id, missing)).get().status === "ready");
  writeFileSync(path.join(heal, "manifest.json"), "{}");
  await healRestoredMedia();
  const st = (id) => db.select().from(schema.media).where(dEq(schema.media.id, id)).get().status;
  const jobs = (id) => db.select().from(schema.jobs).where(dEq(schema.jobs.mediaId, id)).all();
  console.log = log;
  ok("démarrage après restauration : média dont les variantes manquent remis en file", st(missing) === "processing" && jobs(missing).length === 1 && jobs(missing)[0].kind === "image" && jobs(missing)[0].status === "queued");
  ok("démarrage après restauration : média complet laissé tel quel, média sans original non touché", st(fine) === "ready" && jobs(fine).length === 0 && st(lost) === "ready" && jobs(lost).length === 0);
  ok("démarrage après restauration : manifest renommé (une seule fois)", !existsSync(path.join(heal, "manifest.json")) && existsSync(path.join(heal, "manifest.restored.json")));
  /* ligne de l'admin */
  const { ageLabel, backupSummary } = await import("../src/lib/backup/status.ts");
  ok("admin : âge lisible", ageLabel(30_000) === "à l'instant" && ageLabel(5 * 60_000) === "il y a 5 min" && ageLabel(2 * 3_600_000) === "il y a 2 h" && ageLabel(72 * 3_600_000) === "il y a 3 jours");
  delete process.env.WITH_BACKUP;
  process.env.DATA_DIR = data;
  ok("admin : sauvegardes désactivées = aucune ligne", backupSummary() === null);
  process.env.WITH_BACKUP = "1";
  const sum = backupSummary(Date.now() + 2 * 3_600_000 + 60_000);
  ok("admin : « il y a 2 h (3 gardées) »", sum === "il y a 2 h (3 gardées)", String(sum));
  /* lot 76 : le manifest se lit sans décompresser l'archive */
  {
    const { readArchiveManifest } = await import("../src/lib/backup/archive.ts");
    const r = await runBackup({ dataDir: data, config: { media: true, keep: 10 }, reason: "manuel", reader, version: "7.7.7" });
    const m = await readArchiveManifest(path.join(data, "backup", r.name));
    ok("admin76 manifest lu sans tout décompresser : version, raison, contenu", m?.version === "7.7.7" && m.reason === "manuel" && m.includesMedia === true && typeof m.mediaCount === "number" && !Number.isNaN(Date.parse(m.createdAt)), JSON.stringify(m));
    const r0 = await runBackup({ dataDir: data, config: { media: false, keep: 10 }, reason: "calme", reader });
    ok("admin76 manifest : base seule reconnue", (await readArchiveManifest(path.join(data, "backup", r0.name)))?.includesMedia === false);
    ok("admin76 manifest : fichier absent ou illisible = null", (await readArchiveManifest(path.join(data, "backup", "portfolio-19990101-000000.tar.gz"))) === null);
  }
  // audit de sécurité P1 : de bout en bout, sur un dossier à part (session volée : « garder 1 » puis « Sauvegarder maintenant » x2)
  {
    const d2 = path.join(tmp, "data-retention");
    mkdirSync(path.join(d2, "media/originals"), { recursive: true });
    const m2 = new Database(path.join(d2, "portfolio.db"));
    m2.pragma("journal_mode = WAL");
    m2.exec("create table media(id integer primary key, key text, variants text, status text); create table notes(v text);");
    const r2 = new Database(path.join(d2, "portfolio.db"), { readonly: true, fileMustExist: true });
    const go = (when, reason, keep) => runBackup({ dataDir: d2, config: { media: true, keep }, reason, reader: r2, now: () => when });
    const before = await go(new Date(2026, 8, 1, 10, 0, 0), "calme", 3);
    const recent = await go(new Date(2026, 8, 4, 9, 0, 0), "calme", 3);
    await go(new Date(2026, 8, 4, 10, 0, 0), "manuel", 1);
    const last = await go(new Date(2026, 8, 4, 10, 1, 0), "manuel", 1);
    const names = (await listArchives(path.join(d2, "backup"))).map((a) => a.name);
    ok("P1 : keep=1 + deux sauvegardes manuelles : l'archive de plus de 48 h est conservée", names.includes(before.name), names.join(","));
    ok("P1 : l'automatique la plus récente reste aussi (les manuelles ne comptent pas)", names.includes(recent.name) && names.includes(last.name) && names.length === 4 && last.kept === 4 && last.removed === 0, names.join(","));
    r2.close();
    m2.close();
  }
  // lot 85 : garde-fou et BACKUP_MEDIA=0
  {
    const { mediaRefsInDb, otherCitedNames, isRegenerableKey } = await import("../src/lib/backup/refs.ts");
    main.exec("create table themes(id text, data text); create table settings(key text primary key, value text);");
    main.prepare("insert into themes values ('t', ?)").run(JSON.stringify({ a: { svg: "/media/kit/0123456789abcdef.svg", b: "/media/kit/ffffffffffffffff.svg" }, ext: "https://exemple.test/media/pas-a-nous.png" }));
    main.prepare("insert into settings values ('seo', ?), ('fontLibrary', ?)").run(JSON.stringify({ favicon: { dir: "icons/1-abcd1234" } }), JSON.stringify({ f: "0123456789abcdef.woff2", g: "aaaaaaaaaaaaaaaa.woff2" }));
    const refs = mediaRefsInDb(main);
    ok("lot 85 garde-fou : adresses /media/… trouvées dans toute la base (pas les liens externes)", eq([...refs].sort(), ["kit/0123456789abcdef.svg", "kit/ffffffffffffffff.svg"]), [...refs].join(","));
    ok("lot 85 garde-fou : icône du site et polices citées", eq([...otherCitedNames(main)].sort(), ["fonts/0123456789abcdef.woff2", "fonts/aaaaaaaaaaaaaaaa.woff2", "media/icons/1-abcd1234/512.png"]));
    ok("lot 85 régénérable : variante d'un original présent oui, kit/ et icons/ non", isRegenerableKey("img/aaaaaaaaaaaaaaaa/800.webp", new Set(["img/aaaaaaaaaaaaaaaa"])) && !isRegenerableKey("kit/x.svg", new Set()) && !isRegenerableKey("icons/1/512.png", new Set()) && isRegenerableKey("icons-auto/x/32.png", new Set()));
    stamp = new Date(2026, 8, 5, 13, 0, 0);
    const rm = await run();
    const mm = await readManifest(path.join(dir, rm.name));
    ok("lot 85 : références manquantes (kit absent, deux polices absentes) signalées sans bloquer la sauvegarde", rm.missingRefs.length === 3 && rm.missingRefs.includes("kit/ffffffffffffffff.svg") && rm.missingRefs.includes("fonts/aaaaaaaaaaaaaaaa.woff2") && mm.missingRefs.count === 3, JSON.stringify(rm.missingRefs));
    stamp = new Date(2026, 8, 5, 13, 5, 0);
    const rb = await run({ media: false });
    const outB = path.join(tmp, "out3");
    mkdirSync(outB);
    const bFiles = (await extractAll(path.join(dir, rb.name), outB)).sort();
    ok("lot 85 BACKUP_MEDIA=0 : garde quand même kit/, icons/, fiches de kit et polices", eq(bFiles, ["cache/kits/manifests/export1.json", "fonts/Inter-400.woff2", "manifest.json", "media/icons/1-abcd1234/512.png", "media/kit/0123456789abcdef.svg", "portfolio.db"]), bFiles.join(","));
    // fichier qui rétrécit pendant la copie : la sauvegarde ÉCHOUE (jamais une archive de zéros qui a l'air bonne)
    const big = path.join(data, "media/originals/rapetisse.bin");
    writeFileSync(big, Buffer.alloc(3_000_000, 7));
    main.prepare("insert into media(key, variants) values ('originals/rapetisse.bin', null)").run();
    const { truncateSync } = await import("node:fs");
    stamp = new Date(2026, 8, 5, 14, 0, 0);
    let shrank = null;
    try {
      // le fichier rétrécit entre l'écriture de la liste et sa lecture : on le tronque au moment où l'archive arrive à lui
      await runBackup({ dataDir: data, config: cfg, reason: "calme", reader, now: () => stamp, onProgress: (p) => { if (p.phase === "ecriture" && p.done >= 1) try { truncateSync(big, 10); } catch {} } });
    } catch (e) {
      shrank = e;
    }
    ok("lot 85 : fichier raccourci pendant la copie = sauvegarde refusée (BackupSkipped), aucune archive de zéros, aucun .tmp", shrank instanceof BackupSkipped && readdirSync(dir).every((n) => !n.endsWith(".tmp")), String(shrank));
    rmSync(big, { force: true });
    main.prepare("delete from media where key = 'originals/rapetisse.bin'").run();
    // conversion vidéo à cheval : l'instantané la voit « processing », son original a été supprimé depuis
    main.prepare("insert into media(key, variants, status) values ('originals/video-en-cours.mp4', null, 'processing')").run();
    stamp = new Date(2026, 8, 5, 15, 0, 0);
    let raced = null;
    try {
      await run();
    } catch (e) {
      raced = e;
    }
    ok("lot 85 : conversion à cheval sur l'instantané (original disparu) = sauvegarde reportée, pas de vidéo perdue", raced instanceof BackupSkipped && /conversion/.test(String(raced.message)), String(raced));
    main.prepare("delete from media where key = 'originals/video-en-cours.mp4'").run();
    // isNewer / avertissements du script de restauration
    ok("lot 85 restauration : archive plus récente que l'image reconnue", isNewer("0.32.0", "0.31.1") && !isNewer("0.31.0", "0.31.0") && !isNewer("0.30.9", "0.31.0") && !isNewer("inconnue", "0.31.0") && isNewer("0.31.10", "0.31.9"));
    ok("lot 85 restauration : archive d'avant le lot = avertissement kit + cadres ; archive complète sans manque = rien", archiveWarnings({ includesMedia: true }).some((w) => /kit/.test(w) && /cadres/.test(w)) && archiveWarnings({ includesMedia: true, storage: {}, missingRefs: { count: 0, samples: [] } }).length === 0 && archiveWarnings({ includesMedia: true, storage: {}, missingRefs: { count: 2, samples: ["a"] } }).length === 1);
  }

  reader.close();
  main.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
