#!/usr/bin/env node
/**
 * Lot 118 (urgent) : fiabilité des sauvegardes automatiques. Logique pure, horloge simulée (inclus dans npm test).
 *  1. Rafales + creux sur 12 h simulées : une sauvegarde « calme » après chaque creux de 10 min, jamais deux de suite sans modification.
 *  2. Écritures de fond SANS geste de l'artiste : aucune sauvegarde (pas de « bruit » : retiré) ; avec un seul geste : une « delai ».
 *  3. Modification continue AVEC gestes de l'artiste : sauvegarde « delai » quand les modifications attendent depuis 1 h, puis toutes les heures.
 *  4. Une sauvegarde qui ne se termine jamais ne garde pas le verrou ; reprise ; exception de la détection : reprise.
 *  5. Horloge reculée : lastChangeAt dans le futur ne repousse pas la sauvegarde.
 *  6. Surveillance : retard, minuterie arrêtée, sauvegarde bloquée ; rien à signaler en fonctionnement normal.
 *  7. nextDueAt et dueReason s'accordent (au tirage, 300 états).
 *  8. Chaque action d'écriture de l'admin (server action, route) est enveloppée par le journal, donc marque l'activité de l'artiste ;
 *     seules les lectures de la liste ci-dessous ne le sont pas.
 *  9. Restes d'instantané (`snapshot-N.db.tmp-shm/-wal`) reconnus par le nettoyage.
 * 10. Conservation : les 3 dernières + la dernière de chaque jour (Paris) sur 7 jours, sur 10 jours simulés (horloge injectable).
 * Usage : node --import tsx scripts/test-backup118.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
};

const { Scheduler, dueReason, nextDueAt, retentionPlan, rotationPlan, parisDay, archiveName, archiveInstant } = await import("../src/lib/backup/schedule.ts");
const { noteUserActivity, lastUserActivityAt } = await import("../src/lib/backup/activity.ts");
const { SNAPSHOT_LEFTOVER_RE } = await import("../src/lib/backup/archive.ts");

const keepAlive = setInterval(() => {}, 1000); // le délai de la sauvegarde bloquée est une minuterie unref
const MIN = 60_000;
const HOUR = 3_600_000;
const cfg = { quietMs: 10 * MIN, maxMs: 1 * HOUR };
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

/* ---- 2. écritures de fond sans geste de l'artiste ---------------------------------------------------------------------------- */
{
  const b = bench();
  await b.run(6 * HOUR, () => b.change()); // la base change toutes les 30 s, l'artiste n'a rien touché
  ok("fond seul : 6 h d'écritures de fond sans geste de l'artiste = aucune sauvegarde (plus de « bruit », pas de « delai »)", b.ran.length === 0, JSON.stringify(b.ran));
  await b.run(11 * MIN); // le fond s'arrête : la règle de calme reprend
  ok("fond seul : le fond s'arrête, une « calme » ferme la marche", b.ran.length === 1 && b.ran[0].reason === "calme", JSON.stringify(b.ran));
  const c = bench();
  c.user(); // un geste de l'artiste, puis plus rien que du fond
  await c.run(3 * HOUR, () => c.change());
  ok("fond après un geste : une seule sauvegarde « delai » (les modifications de l'artiste attendaient depuis 1 h), puis plus", c.ran.length === 1 && c.ran[0].reason === "delai" && c.ran[0].at - T0 >= HOUR && c.ran[0].at - T0 <= HOUR + 2 * MIN, JSON.stringify(c.ran));
}

/* ---- 3. modification continue avec gestes de l'artiste ------------------------------------------------------------------------- */
{
  const b = bench();
  await b.run(3.5 * HOUR, () => {
    b.change();
    b.user();
  });
  const at = b.ran.map((r) => (r.at - T0) / MIN);
  ok("continu avec gestes : une « delai » à 1 h, 2 h, 3 h (jamais de « calme » : il n'y a pas de pause)", b.ran.length === 3 && b.ran.every((r) => r.reason === "delai") && at.every((m, i) => m >= 60 * (i + 1) && m <= 60 * (i + 1) + 3 * (i + 1)), JSON.stringify(at));
  const d = bench();
  await d.run(70 * MIN, () => {
    d.change();
    d.user();
  });
  const before = d.ran.length;
  await d.run(11 * MIN);
  ok("continu : l'artiste s'arrête, la « calme » prend la suite", before === 1 && d.ran.length === 2 && d.ran[1].reason === "calme", JSON.stringify(d.ran));
  const e = bench();
  await e.run(55 * MIN, () => {
    e.change();
    e.user();
  });
  ok("continu : 55 min de travail ne déclenchent rien (le plafond est de 1 h)", e.ran.length === 0);
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
    const lastChangeAt = lastBackupAt + Math.floor(rnd() * 3 * HOUR);
    const st = { dirty: true, lastChangeAt, dirtySince: lastChangeAt - Math.floor(rnd() * 2 * HOUR), lastBackupAt, notBefore: 0, lastUserAt: rnd() < 0.5 ? lastChangeAt - Math.floor(rnd() * 90 * MIN) : 0 };
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
    "mediaUsesAction", "pendingUploadsAction", "listTagsAction", "previewFaviconAction", "backfillTakenAction",
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

/* ---- 10. conservation : 3 dernières + une par jour sur 7 jours (heure de Paris) --------------------------------------------------- */
{
  const parisNoon = (y, m, d) => Date.UTC(y, m - 1, d, 10); // 12 h à Paris en été (UTC+2)
  const names = (instants) => instants.map((t) => archiveName(new Date(t)));

  // 10 jours (en été), 6 sauvegardes par jour à des heures variées, dont 23 h 30 et 0 h 30 heure de Paris ; rotation à chaque sauvegarde.
  const hoursUtc = [0.2, 6, 9.5, 14, 19, 21.5]; // 21 h 30 UTC = 23 h 30 Paris
  const all = [];
  let present = [];
  for (let d = 1; d <= 10; d++) {
    for (const h of hoursUtc) {
      const t = Date.UTC(2026, 6, d, 0) + Math.round(h * HOUR);
      all.push(t);
      present.push(archiveName(new Date(t)));
      const doomed = rotationPlan(present, 3, 7, t);
      present = present.filter((n) => !doomed.includes(n));
    }
  }
  const now = Date.UTC(2026, 6, 10, 21, 40);
  // Attendu, calculé à part : les 3 dernières + la dernière de chaque jour de Paris des 7 derniers jours.
  const sorted = [...all].sort((x, y) => x - y);
  const expected = new Set(sorted.slice(-3));
  const today = parisDay(now);
  const lastByDay = new Map();
  for (const t of sorted) lastByDay.set(parisDay(t), t);
  for (let i = 0; i < 7; i++) {
    const day = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) - i, 12)).toISOString().slice(0, 10);
    if (lastByDay.has(day)) expected.add(lastByDay.get(day));
  }
  const got = new Set(present.map((n) => archiveInstant(n)));
  ok("conservation : après 10 jours simulés, exactement les 3 dernières + la dernière de chacun des 7 derniers jours", got.size === expected.size && [...expected].every((t) => got.has(t)), `${got.size} gardées contre ${expected.size} attendues`);
  ok("conservation : au plus 3 + 7 = 10 archives, jamais plus", present.length <= 10 && present.length >= 7, String(present.length));
  const plan = retentionPlan(present, 3, 7, now);
  ok("conservation : trois « récentes », le reste « du jour », une par jour", plan.kept.filter((k) => k.kind === "recente").length === 3 && plan.kept.filter((k) => k.kind === "jour").every((k, _i, arr) => arr.filter((o) => o.day === k.day).length === 1), JSON.stringify(plan.kept.map((k) => [k.kind, k.day])));
  ok("conservation : la dernière sauvegarde est toujours gardée et rien d'une autre nature n'est effacé", plan.doomed.length === 0 && present.includes(archiveName(new Date(sorted.at(-1)))));

  // Minuit à Paris : 23 h 30 et 0 h 30 sont deux jours différents.
  const mid = names([Date.UTC(2026, 6, 1, 21, 30), Date.UTC(2026, 6, 1, 22, 30), Date.UTC(2026, 6, 2, 8)]);
  const pm = retentionPlan(mid, 1, 2, Date.UTC(2026, 6, 2, 10));
  ok("conservation : le jour est celui de Paris (23 h 30 et 0 h 30 de Paris sont deux jours)", pm.kept.length === 2 && pm.doomed.length === 1 && pm.doomed[0] === mid[1] && pm.kept[0].day === "2026-07-01" && pm.kept[0].kind === "jour", JSON.stringify(pm));

  // Une sauvegarde manuelle compte comme les autres (le nom ne dit pas la raison) ; la dernière de la journée l'emporte, manuelle ou non.
  const day = names([Date.UTC(2026, 6, 5, 7), Date.UTC(2026, 6, 5, 8), Date.UTC(2026, 6, 5, 9)]);
  const pd = retentionPlan(day, 1, 7, Date.UTC(2026, 6, 5, 12));
  ok("conservation : trois sauvegardes le même jour, avec keep 1 : seule la dernière reste", pd.kept.length === 1 && pd.kept[0].name === day[2] && pd.doomed.length === 2);

  // Au-delà de 7 jours : supprimées, sauf les 3 dernières.
  const old = names([Date.UTC(2026, 5, 1, 8), Date.UTC(2026, 5, 2, 8), Date.UTC(2026, 6, 10, 8)]);
  const po = retentionPlan(old, 1, 7, Date.UTC(2026, 6, 10, 12));
  ok("conservation : une archive de plus de 7 jours est supprimée (hors dernières)", po.doomed.length === 2 && po.kept.length === 1 && po.kept[0].name === old[2]);
  ok("conservation : days = 0 garde seulement les dernières (comportement d'avant), keep 0 = 1, noms invalides ignorés", rotationPlan(old, 2, 0, Date.UTC(2026, 6, 10, 12)).length === 1 && rotationPlan(old, 0, 7, Date.UTC(2026, 6, 10, 12)).length === 2 && rotationPlan(["autre.tar.gz", "x"], 3, 7).length === 0);
  ok("conservation : jamais tout supprimer, même dans un futur lointain", rotationPlan(old, 3, 7, Date.UTC(2030, 0, 1)).length === 0 && rotationPlan(old.slice(0, 1), 1, 7, Date.UTC(2030, 0, 1)).length === 0);
}

clearInterval(keepAlive);
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
