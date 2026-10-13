#!/usr/bin/env node
/**
 * v0.17 (audit) — exclusion mémoire entre kit et image lourde (inclus dans npm test) :
 *  1. image lourde ? (pixels ou mémoire de décodage) : seuil, JPEG progressif, petite image légère ;
 *  2. porte mémoire (src/lib/jobs/memory-gate.ts) : jamais un kit et une image lourde en même temps,
 *     ordre d'arrivée, libération sur erreur, pas de famine ;
 *  3. worker réel : une image légère passe pendant qu'un kit tient la porte, une image lourde attend
 *     la fin du kit, puis aboutit ; un kit attend la fin d'une image lourde.
 * Usage : node --import tsx scripts/test-memory-gate.mjs
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import sharp from "sharp";

const DIR = mkdtempSync(path.join(process.env.TEST_TMP ?? tmpdir(), "pf-memgate-"));
process.env.DATA_DIR = DIR;
process.env.IMAGE_HEAVY_MPX = "10";

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await fn()) return true;
  return false;
};

try {
  /* ---- 1. image lourde ? ------------------------------------------------------------ */
  const { isHeavyImage } = await import("../src/lib/images/budget.ts");
  ok("seuil de pixels : 12 Mpx lourde, 8 Mpx légère (IMAGE_HEAVY_MPX = 10)", isHeavyImage({ format: "jpeg", width: 4000, height: 3000 }) && !isHeavyImage({ format: "jpeg", width: 4000, height: 2000 }));
  ok("miniature et vignette : légères", !isHeavyImage({ format: "png", width: 300, height: 300 }));
  ok("image sans dimensions lisibles : lourde par prudence", isHeavyImage({ width: 0, height: 0 }));

  /* ---- 2. porte mémoire ---------------------------------------------------------------- */
  const { createMemoryGate } = await import("../src/lib/jobs/memory-gate.ts");
  const gate = createMemoryGate();
  const log = [];
  let live = { kit: 0, image: 0 };
  let overlap = 0;
  const task = (kind, name, ms, fail = false) => () =>
    (async () => {
      live[kind]++;
      if (live.kit && live.image) overlap++;
      log.push(`+${name}`);
      await sleep(ms);
      log.push(`-${name}`);
      live[kind]--;
      if (fail) throw new Error("boom");
      return name;
    })();
  const runs = [
    gate.run("kit", task("kit", "k1", 80)),
    gate.run("image", task("image", "i1", 40)),
    gate.run("kit", task("kit", "k2", 30)),
    gate.run("image", task("image", "i2", 30, true)).catch((e) => e.message),
    gate.run("image", task("image", "i3", 20)),
  ];
  const res = await Promise.all(runs);
  ok("kit et image lourde ne se chevauchent jamais", overlap === 0, log.join(" "));
  ok("ordre d'arrivée respecté (pas de famine)", log.join(" ") === "+k1 -k1 +i1 -i1 +k2 -k2 +i2 -i2 +i3 -i3", log.join(" "));
  ok("une erreur libère la porte et remonte à l'appelant", res[3] === "boom" && res[4] === "i3");
  ok("porte libre à la fin", gate.holder() === null && gate.waiting().length === 0);

  /* ---- 3. worker réel -------------------------------------------------------------------- */
  const migrations = new URL("../drizzle/", import.meta.url).pathname;
  const raw = new Database(path.join(DIR, "portfolio.db"));
  for (const f of readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(migrations + f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) raw.exec(stmt);
  }
  raw.close();
  const { getDb, schema } = await import("../src/lib/db/index.ts");
  const { eq } = await import("drizzle-orm");
  const db = getDb();
  const { memoryGate } = await import("../src/lib/jobs/memory-gate.ts");
  const { wakeWorker } = await import("../src/lib/jobs/worker.ts");
  mkdirSync(path.join(DIR, "media", "originals"), { recursive: true });
  const put = async (name, w, h) => {
    writeFileSync(path.join(DIR, "media", "originals", `${name}.png`), await sharp({ create: { width: w, height: h, channels: 3, background: "#336699" } }).png().toBuffer());
    const id = db.insert(schema.media).values({ key: `originals/${name}.png`, sha256: name.padEnd(64, "0"), kind: "image", mime: "image/png", originalName: `${name}.png`, size: 1, status: "processing", alt: { fr: "", en: "" } }).returning({ id: schema.media.id }).get().id;
    const job = db.insert(schema.jobs).values({ kind: "image", mediaId: id, status: "queued", attempts: 0 }).returning({ id: schema.jobs.id }).get().id;
    return { id, job };
  };
  const statusOf = (m) => db.select().from(schema.media).where(eq(schema.media.id, m.id)).get()?.status;

  const held = memoryGate().run("kit", () => new Promise((resolve) => (globalThis.__releaseKit = resolve)));
  await sleep(50);
  const heavy = await put("a1a1a1a1a1a1a1a1", 4000, 3500); // 14 Mpx
  const light = await put("b2b2b2b2b2b2b2b2", 800, 600);
  wakeWorker();
  ok("kit en cours : l'image légère passe", await wait(() => statusOf(light) === "ready"), statusOf(light));
  await sleep(1500);
  ok("kit en cours : l'image lourde attend (toujours en traitement)", statusOf(heavy) === "processing", String(statusOf(heavy)));
  globalThis.__releaseKit();
  await held;
  ok("kit terminé : l'image lourde est traitée", await wait(() => statusOf(heavy) === "ready"), statusOf(heavy));

  // Image lourde en cours : un kit attend. On retient la porte « image » par un faux traitement.
  const heldImg = memoryGate().run("image", () => new Promise((resolve) => (globalThis.__releaseImg = resolve)));
  await sleep(50);
  let kitRan = false;
  const kit = memoryGate().run("kit", async () => {
    kitRan = true;
  });
  await sleep(300);
  ok("image lourde en cours : un kit attend", !kitRan && memoryGate().waiting().join() === "kit");
  globalThis.__releaseImg();
  await heldImg;
  await kit;
  ok("image lourde terminée : le kit démarre", kitRan);
} catch (error) {
  failures++;
  console.log("FAIL  exception :", error);
} finally {
  rmSync(DIR, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
