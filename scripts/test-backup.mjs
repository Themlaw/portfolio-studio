#!/usr/bin/env node
/**
 * Lot 50 — sauvegardes automatiques : logique pure et archive sur une VRAIE base (dossier temporaire), sans serveur
 * (inclus dans npm test). Le test sur un vrai serveur est scripts/e2e-backup50.mjs.
 *  1. Réglages : défauts, secondes de test, valeurs invalides, WITH_BACKUP.
 *  2. Déclenchement, horloge simulée : rien sans modification, calme, délai maximal malgré l'activité, première sauvegarde,
 *     modification PENDANT une sauvegarde, échec (attente), état conservé d'un redémarrage à l'autre.
 *  3. Rotation : on garde les N plus récentes, tri par date, jamais tout supprimé.
 *  4. Détection par data_version (connexion lecture seule) : écriture vue, silence sans écriture.
 *  5. Archive : base cohérente et ouvrable, originaux seulement (variantes exclues), exceptions (original supprimé, seed),
 *     polices, BACKUP_MEDIA=0, noms longs (PAX), lecture par `tar`, aucun .tmp restant, rotation après écriture.
 *  6. Restauration (script) : base remplacée, ancien -wal rangé, archive tronquée refusée sans rien changer,
 *     puis variantes manquantes remises en file au démarrage (healRestoredMedia).
 * Usage : node --import tsx scripts/test-backup.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
const { Scheduler, dueReason, rotationPlan, sortArchives, archiveName, failureCooldownMs } = await import("../src/lib/backup/schedule.ts");

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

/* ---- 4 et 5. archive sur une vraie base --------------------------------------------------------------------------- */
const { runBackup, listArchives, mediaKeysToSave, BackupSkipped } = await import("../src/lib/backup/archive.ts");
const { extractAll, readManifest, restore } = await import("./restore-backup.mjs");
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
  w("cache/crops/x.webp", "cache");
  w("tmp/envoi.part", "partiel");
  const main = new Database(path.join(data, "portfolio.db"));
  main.pragma("journal_mode = WAL");
  main.exec("create table media(id integer primary key, key text, variants text); create table notes(v text);");
  const addMedia = (key, variants) => main.prepare("insert into media(key, variants) values (?, ?)").run(key, variants ? JSON.stringify(variants) : null);
  addMedia("originals/orig1.png", { v: 1, files: [{ key: "img/aaaaaaaaaaaaaaaa/800.webp", size: 20 }] });
  addMedia("originals/gone.mp4", { v: 1, originalRemoved: true, files: [{ key: "vid/bbbbbbbbbbbbbbbb/720.mp4", size: 29 }] });
  addMedia("seed-logo.svg", null);
  addMedia(longName, null);
  main.prepare("insert into notes values (?)").run("avant");

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
  ok("archive : manifest, base, originaux, original-orphelin et seed, police ; ni variantes régénérables ni cache ni tmp", eq(sorted, ["fonts/Inter-400.woff2", "manifest.json", `media/${longName}`, "media/originals/orig1.png", "media/seed-logo.svg", "media/vid/bbbbbbbbbbbbbbbb/720.mp4", "portfolio.db"].sort()), sorted.join(","));
  const snap = new Database(path.join(out, "portfolio.db"), { readonly: true });
  ok("archive : la base s'ouvre, intègre, avec les modifications faites avant la copie", snap.pragma("integrity_check", { simple: true }) === "ok" && snap.prepare("select count(*) n from notes").get().n === 2 && snap.prepare("select count(*) n from media").get().n === 4);
  snap.close();
  ok("archive : original octet pour octet (flux)", readFileSync(path.join(out, "media/originals/orig1.png")).equals(Buffer.alloc(300_000, 1)));
  const man = await readManifest(path.join(dir, r1.name));
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
  ok("BACKUP_MEDIA=0 : base, manifest et polices seulement", eq(dbFiles, ["fonts/Inter-400.woff2", "manifest.json", "portfolio.db"]) && (await readManifest(path.join(dir, rd.name))).includesMedia === false, dbFiles.join(","));

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
  const keys = await mediaKeysToSave([{ key: "originals/orig1.png", variants: "pas du json" }, { key: "originals/absent.png", variants: null }], path.join(data, "media"));
  ok("médias : variantes illisibles ou original absent = ignorés sans erreur", eq(keys.map((k) => k.key), ["originals/orig1.png"]));

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
  reader.close();
  main.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
