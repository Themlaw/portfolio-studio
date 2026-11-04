#!/usr/bin/env node
/**
 * Lot 118 (urgent) : fiabilité des sauvegardes automatiques. Logique pure, horloge simulée (inclus dans npm test).
 *  1. Rafales + creux sur 12 h simulées : une sauvegarde « calme » après chaque creux de 10 min, jamais deux de suite sans modification.
 *  2. Le bruit : la base change sans cesse SANS geste de l'artiste (traitements de fond) : sauvegarde « bruit » au plus toutes les 15 min.
 *  3. Modification continue AVEC gestes de l'artiste : pas de « bruit », sauvegarde « delai » au plus 6 h après la précédente.
 *  4. Une sauvegarde qui ne se termine jamais ne garde pas le verrou ; reprise ; exception de la détection : reprise.
 *  5. Horloge reculée : lastChangeAt dans le futur ne repousse pas la sauvegarde.
 *  6. Surveillance : retard, minuterie arrêtée, sauvegarde bloquée ; rien à signaler en fonctionnement normal.
 *  7. nextDueAt et dueReason s'accordent (au tirage, 300 états).
 *  8. Chaque action d'écriture de l'admin (server action, route) est enveloppée par le journal, donc marque l'activité de l'artiste ;
 *     seules les lectures de la liste ci-dessous ne le sont pas.
 *  9. Restes d'instantané (`snapshot-N.db.tmp-shm/-wal`) reconnus par le nettoyage.
 * Usage : node --import tsx scripts/test-backup118.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
};

const { Scheduler, dueReason, nextDueAt, noiseGapMs } = await import("../src/lib/backup/schedule.ts");
const { noteUserActivity, lastUserActivityAt } = await import("../src/lib/backup/activity.ts");
const { SNAPSHOT_LEFTOVER_RE } = await import("../src/lib/backup/archive.ts");

const keepAlive = setInterval(() => {}, 1000); // le délai de la sauvegarde bloquée est une minuterie unref
const MIN = 60_000;
const HOUR = 3_600_000;
const cfg = { quietMs: 10 * MIN, maxMs: 6 * HOUR };
const T0 = 1_000_000_000_000;

/** Banc : changes = modifications de la base vues par la détection ; user = geste de l'artiste. */
function bench(init = {}, extra = {}) {
  const clock = { t: T0 };
  const ran = [];
  let pendingChange = false;
  let userAt = 0;
  const sched = new Scheduler(
    {
      config: cfg,
      now: () => clock.t,
      changed: () => {
        if (extra.changedThrows?.()) throw new Error("base occupée");
        const c = pendingChange;
        pendingChange = false;
        return c;
      },
      userActivity: () => userAt,
      run: async (reason) => {
        ran.push({ reason, at: clock.t });
        if (extra.run) await extra.run(reason, clock);
      },
      runTimeoutMs: extra.runTimeoutMs,
      persist: () => {},
      onError: (e) => extra.errors?.push(e.message),
    },
    { dirty: false, lastChangeAt: 0, lastBackupAt: clock.t, ...init },
  );
  return {
    clock,
    ran,
    sched,
    change: () => (pendingChange = true),
    user: () => (userAt = clock.t),
    /** avance de `ms` par pas de 30 s (la minuterie du site), `each` appelé à chaque pas. */
    async run(ms, each) {
      const end = clock.t + ms;
      while (clock.t < end) {
        clock.t += 30_000;
        each?.();
        await sched.tick();
      }
    },
  };
}

/* ---- 1. rafales + creux, 12 h ------------------------------------------------------------------------------------------------ */
{
  const b = bench();
  // Toutes les heures : 20 min de travail (geste + modification toutes les 30 s), puis 40 min de silence.
  for (let h = 0; h < 12; h++) {
    await b.run(20 * MIN, () => {
      b.change();
      b.user();
    });
    await b.run(40 * MIN);
  }
  const reasons = b.ran.map((r) => r.reason);
  ok("rafales + creux (12 h) : une sauvegarde « calme » par creux, pas une de plus", reasons.length === 12 && reasons.every((r) => r === "calme"), JSON.stringify(reasons));
  const gaps = b.ran.map((r, i) => (r.at - (T0 + i * HOUR + 20 * MIN)) / MIN);
  ok("rafales + creux : chaque sauvegarde part 10 min (à 30 s près) après la dernière modification", gaps.every((g) => g >= 10 && g <= 10.6), JSON.stringify(gaps));
}

/* ---- 2. le bruit ------------------------------------------------------------------------------------------------------------- */
{
  const b = bench();
  b.user(); // un dernier geste de l'artiste, puis plus rien
  await b.run(3 * HOUR, () => b.change()); // mais la base change toutes les 30 s (traitements de fond)
  const reasons = b.ran.map((r) => r.reason);
  const gap = noiseGapMs(cfg);
  ok("bruit : l'écart minimal est de 15 min avec les réglages d'origine", gap === 15 * MIN);
  ok("bruit : la base change sans cesse sans geste de l'artiste = sauvegarde « bruit » (jamais « calme »)", reasons.length > 0 && reasons.every((r) => r === "bruit"), JSON.stringify(reasons));
  const spacing = b.ran.slice(1).map((r, i) => r.at - b.ran[i].at);
  ok("bruit : jamais plus d'une sauvegarde par 15 min", spacing.every((s) => s >= gap) && b.ran.length >= 10 && b.ran.length <= 12, `${b.ran.length} sauvegardes, écarts min ${Math.min(...spacing) / MIN} min`);
}

/* ---- 3. modification continue avec gestes de l'artiste ------------------------------------------------------------------------- */
{
  const b = bench();
  await b.run(7 * HOUR, () => {
    b.change();
    b.user();
  });
  const first = b.ran[0];
  ok("continu avec gestes : pas de « bruit » ; sauvegarde « delai » au plus 6 h après la précédente", b.ran.length >= 1 && b.ran.every((r) => r.reason === "delai") && first.at - T0 >= 6 * HOUR && first.at - T0 <= 6 * HOUR + MIN, JSON.stringify(b.ran));
}

/* ---- 4. sauvegarde bloquée, exception ---------------------------------------------------------------------------------------- */
{
  const errors = [];
  let hang = true;
  const b = bench({}, { runTimeoutMs: 5 * MIN, errors, run: async () => (hang ? new Promise(() => {}) : undefined) });
  b.change();
  b.user();
  await b.sched.tick();
  b.clock.t += 10 * MIN;
  const started = b.sched.tick(); // part « calme », ne se termine jamais
  // La minuterie de la promesse est réelle : on laisse passer le délai simulé via un délai réel court.
  await new Promise((r) => setTimeout(r, 20));
  ok("bloquée : la sauvegarde en cours tient le verrou", b.sched.busy === true);
  // Délai réel : 5 min simulées ne passent pas ; on vérifie avec un délai de 150 ms.
  const b2 = bench({}, { runTimeoutMs: 150, errors, run: async () => (hang ? new Promise(() => {}) : undefined) });
  b2.change();
  await b2.sched.tick();
  b2.clock.t += 10 * MIN;
  await b2.sched.tick();
  ok("bloquée : le délai libère le verrou et note l'échec", b2.sched.busy === false && errors.some((m) => /ne se termine pas/.test(m)), JSON.stringify(errors));
  ok("bloquée : les modifications restent à sauvegarder", b2.sched.state.dirty === true);
  hang = false;
  b2.clock.t += 20 * MIN;
  await b2.sched.tick();
  ok("bloquée : reprise, la sauvegarde part au prochain essai", b2.ran.length === 2 && b2.sched.state.dirty === false, JSON.stringify(b2.ran));
  void started;

  let boom = false;
  const c = bench({}, { changedThrows: () => boom });
  c.change();
  await c.sched.tick();
  boom = true;
  let threw = false;
  try {
    await c.sched.tick();
  } catch {
    threw = true;
  }
  boom = false;
  c.clock.t += 11 * MIN;
  await c.sched.tick();
  ok("exception de la détection : la vérification suivante repart, la sauvegarde a lieu", threw && c.ran.length === 1 && c.ran[0].reason === "calme");
}

/* ---- 5. horloge reculée ------------------------------------------------------------------------------------------------------ */
{
  const b = bench({ dirty: true, lastChangeAt: T0 + 5 * HOUR });
  b.clock.t += 11 * MIN;
  await b.sched.tick();
  ok("horloge : une dernière modification « dans le futur » est ramenée à maintenant, la sauvegarde part après la quiétude", b.sched.state.lastChangeAt <= b.clock.t && b.ran.length === 0);
  b.clock.t += 10 * MIN;
  await b.sched.tick();
  ok("horloge : la sauvegarde a lieu", b.ran.length === 1 && b.ran[0].reason === "calme");
}

/* ---- 6. surveillance --------------------------------------------------------------------------------------------------------- */
{
  const grace = 2 * MIN;
  const b = bench();
  b.change();
  await b.sched.tick();
  ok("surveillance : rien à signaler en fonctionnement normal", b.sched.health(b.clock.t, grace) === null);
  b.clock.t += 10 * MIN + grace + 30_000; // plus aucune vérification : la minuterie est arrêtée
  ok("surveillance : minuterie arrêtée détectée", b.sched.health(b.clock.t, grace)?.kind === "minuterie");
  await b.sched.tick();
  ok("surveillance : une vérification a lieu, la sauvegarde part, plus d'alerte", b.ran.length === 1 && b.sched.health(b.clock.t, grace) === null);

  const r = bench({ dirty: true, lastChangeAt: T0 });
  r.clock.t += 30 * MIN; // jamais vérifié (lastTickAt = 0) mais une sauvegarde est due depuis 20 min
  const h = r.sched.health(r.clock.t, grace);
  ok("surveillance : sauvegarde due qui ne part pas = retard, avec la date prévue", h?.kind === "retard" && h.since === T0 + 10 * MIN, JSON.stringify(h));

  let release;
  const s = bench({}, { runTimeoutMs: 60 * MIN, run: () => new Promise((res) => (release = res)) });
  s.change();
  await s.sched.tick();
  s.clock.t += 10 * MIN;
  const pending = s.sched.tick();
  s.clock.t += 70 * MIN;
  ok("surveillance : sauvegarde en cours depuis plus que le délai = bloquée", s.sched.health(s.clock.t, grace)?.kind === "bloquee");
  release();
  await pending;
  ok("surveillance : désactivées = jamais d'alerte", (() => {
    const d = new Scheduler({ config: cfg, now: () => T0, changed: () => false, run: async () => {}, enabled: () => false }, { dirty: true, lastChangeAt: 0, lastBackupAt: 0 });
    return d.health(T0 + 100 * HOUR, grace) === null;
  })());
}

/* ---- 6b. échecs en boucle ---------------------------------------------------------------------------------------------------- */
{
  const errors = [];
  const b = bench({}, { errors, run: async () => { throw new Error("dossier en lecture seule"); } });
  b.change();
  b.user();
  await b.sched.tick();
  b.clock.t += 10 * MIN;
  await b.sched.tick(); // échec, attente avant le nouvel essai
  await b.run(5 * MIN); // la minuterie tourne : elle ne trouve rien à faire pendant l attente
  const h = b.sched.health(b.clock.t, 2 * MIN);
  ok("échecs en boucle : la sauvegarde due et jamais faite est signalée pendant l'attente avant le nouvel essai", h?.kind === "retard" && errors.length === 1, JSON.stringify(h));
}

/* ---- 7. nextDueAt et dueReason s'accordent ---------------------------------------------------------------------------------- */
{
  let seed = 118;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let bad = 0;
  for (let i = 0; i < 300; i++) {
    const lastBackupAt = T0 + Math.floor(rnd() * 5 * HOUR);
    const st = { dirty: true, lastChangeAt: lastBackupAt + Math.floor(rnd() * 3 * HOUR), lastBackupAt, notBefore: 0, lastUserAt: lastBackupAt + Math.floor(rnd() * 3 * HOUR) };
    const at = nextDueAt(st, cfg);
    if (at === null || dueReason(st, at, cfg) === null || (at > T0 && dueReason(st, at - 1, cfg) !== null)) bad++;
  }
  ok("nextDueAt : la sauvegarde est due à la date annoncée, et pas une milliseconde avant (300 états)", bad === 0, `${bad} écarts`);
}

/* ---- 8. chaque action d'écriture marque l'activité --------------------------------------------------------------------------- */
{
  noteUserActivity(12345);
  ok("activité : noteUserActivity est lue par lastUserActivityAt", lastUserActivityAt() === 12345);
  const root = path.resolve(import.meta.dirname, "../src/app");
  const files = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.ts$/.test(n)) files.push(f);
    }
  })(root);
  // Lectures : n'écrivent rien en base (aucun geste de l'artiste à noter).
  const READ_ONLY = new Set([
    "frameUsesAction", "listFramesAction", "backupStatusAction", "wallpaperUsesAction", "listWallpapersAction", "mediaStatusAction",
    "mediaUsesAction", "pendingUploadsAction", "listTagsAction", "previewFaviconAction",
  ]);
  // Routes d'écriture sans journal : sans effet sur le contenu (aperçus, journal du navigateur, contact public, interne) ou notées à la main.
  const ROUTES_OK = new Set(["apercu/route.ts", "apercu/quitter/route.ts", "theme-kit/[id]/route.ts", "fonts/recent/route.ts", "api/contact/route.ts", "api/internal/revalidate/route.ts", "api/log/route.ts"]);
  const NOTED_BY_HAND = ["admin/api/upload/[id]/chunk/route.ts", "admin/api/upload/init/route.ts"];
  const unwrapped = [];
  const notNoted = [];
  let seen = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const rel = path.relative(root, f);
    if (/^\s*["']use server["']/m.test(src.slice(0, 400)) || /actions?\.ts$/.test(rel)) {
      for (const m of src.matchAll(/^export (?:async function|const) (\w+Action)\b(.*)$/gm)) {
        seen++;
        const wrapped = /audited\(/.test(m[2]);
        if (!wrapped && !READ_ONLY.has(m[1])) unwrapped.push(`${rel}:${m[1]}`);
      }
    }
    for (const m of src.matchAll(/^export (?:async function|const) (POST|PUT|DELETE|PATCH)\b(.*)$/gm)) {
      seen++;
      const wrapped = /auditedRoute\(/.test(m[2]);
      if (wrapped) continue;
      const known = [...ROUTES_OK].some((k) => rel.endsWith(k));
      if (NOTED_BY_HAND.some((k) => rel.endsWith(k))) {
        if (!/noteUserActivity\(/.test(src)) notNoted.push(rel);
      } else if (!known) unwrapped.push(`${rel}:${m[1]}`);
    }
  }
  ok("actions : toutes les server actions et routes d'écriture sont enveloppées par le journal (donc marquent l'activité), sauf les lectures connues", unwrapped.length === 0 && seen > 60, `${seen} vues ; non enveloppées : ${unwrapped.join(", ")}`);
  ok("actions : les routes d'envoi par morceaux marquent l'activité à la main", notNoted.length === 0, notNoted.join(", "));
  // Le journal appelle noteUserActivity au début et à la fin de chaque enveloppe.
  const audit = readFileSync(path.resolve(import.meta.dirname, "../src/lib/journal/audit.ts"), "utf8");
  ok("actions : audited et auditedRoute notent l'activité (début et fin)", (audit.match(/noteUserActivity\(\)/g) ?? []).length === 4);
}

/* ---- 9. restes d'instantané --------------------------------------------------------------------------------------------------- */
{
  ok("instantané : les restes -shm, -wal et -journal sont reconnus, pas les archives", ["snapshot-6.db.tmp-shm", "snapshot-7.db.tmp-wal", "snapshot-8.db.tmp-journal"].every((n) => SNAPSHOT_LEFTOVER_RE.test(n)) && !SNAPSHOT_LEFTOVER_RE.test("portfolio-20261104-190802.tar.gz") && !SNAPSHOT_LEFTOVER_RE.test("snapshot-6.db.tmp"));
}

clearInterval(keepAlive);
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
