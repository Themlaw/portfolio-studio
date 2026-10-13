#!/usr/bin/env node
/**
 * Lot 17b — grandes images, tailles affichées, worker (inclus dans npm test) :
 *  1. mémoire de décodage : PNG entrelacé / JPEG progressif lourds refusés
 *     avec un message qui dit quoi faire, flux (PNG classique) accepté ;
 *  2. `sizes` d'une image rognée : largeur réelle = cadre × part rognée × zoom ;
 *  3. variantes d'un panorama (3600 et 4800 px en plus) et traitement réel ;
 *  4. worker : jamais « en traitement » pour toujours (image illisible →
 *     échec lisible ; job `running` oublié → échec ; image qui a déjà coupé
 *     le serveur → échec lisible ; autres jobs interrompus → remis en file).
 * Usage : node --import tsx scripts/test-image-jobs.mjs
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import sharp from "sharp";

const DIR = mkdtempSync(path.join(process.env.TEST_TMP ?? tmpdir(), "pf-image-jobs-"));
process.env.DATA_DIR = DIR;
process.env.IMAGE_DECODE_BUDGET_MB = "400";

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
};
const wait = async (fn, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true;
  return false;
};

try {
  /* ---- 1. mémoire de décodage ------------------------------------------------ */
  const { decodeProblem, decodeMemoryMb } = await import("../src/lib/images/budget.ts");
  const interlaced = { format: "png", width: 20000, height: 5000, channels: 4, depth: "ushort", isProgressive: true };
  ok("PNG 16 bits entrelacé de 100 Mpx (800 Mo) refusé, avec la marche à suivre", /trop lourde/.test(decodeProblem(interlaced) ?? "") && /entrelacé/.test(decodeProblem(interlaced) ?? ""), String(decodeProblem(interlaced)));
  ok("PNG 8 bits entrelacé 20000×4000 RGBA (320 Mo) accepté", decodeProblem({ ...interlaced, height: 4000, depth: "uchar" }) === null);
  ok("PNG non entrelacé de 100 Mpx (lu en flux) accepté", decodeProblem({ ...interlaced, isProgressive: false }) === null && decodeMemoryMb({ ...interlaced, isProgressive: false }) === 0);
  ok("JPEG progressif de 100 Mpx refusé, JPEG de base accepté", decodeProblem({ format: "jpeg", width: 12000, height: 8000, channels: 3, depth: "uchar", isProgressive: true }) !== null && decodeProblem({ format: "jpeg", width: 12000, height: 8000, channels: 3, depth: "uchar", isProgressive: false }) === null);

  /* ---- 2. sizes d'une image rognée ---------------------------------------------- */
  const { coverFactor, parseRatio, scaleSizes } = await import("../src/lib/images/sizes.ts");
  ok("ratio « 4:5 » → 0,8 ; auto → null", parseRatio("4:5") === 0.8 && parseRatio("auto") === null && parseRatio(undefined) === null);
  const factor = coverFactor(20000 / 4000, parseRatio("4:5"), 1.5);
  ok("panorama 5:1 dans un cadre 4:5 zoomé ×1,5 : affichée 9,4 fois plus large que le cadre", Math.abs(factor - 9.375) < 1e-9, String(factor));
  ok("image plus haute que le cadre, sans zoom : facteur 1 (sizes inchangé)", coverFactor(0.5, 1, 1) === 1 && scaleSizes("100vw", 1) === "100vw");
  const scaled = scaleSizes("(min-width: 1236px) 400px, 33.3vw, 100vw", 6.25);
  ok("sizes : chaque longueur multipliée (px et vw)", scaled === "(min-width: 1236px) calc(400px * 6.250), calc(33.3vw * 6.250), calc(100vw * 6.250)", scaled);

  /* ---- 3. variantes d'un panorama ----------------------------------------------- */
  const { variantBoxes } = await import("../src/lib/images/variants.ts");
  ok("panorama 20000×4000 : boîtes jusqu'à 4800 px", variantBoxes(20000, 4000).join() === "480,960,1600,2400,3600,4800", variantBoxes(20000, 4000).join());
  ok("image ordinaire 6000×4000 : inchangé (jusqu'à 2400)", variantBoxes(6000, 4000).join() === "480,960,1600,2400" && variantBoxes(3000).join() === "480,960,1600,2400");
  ok("petit panorama 3000×1000 : sa propre taille en dernier", variantBoxes(3000, 1000).join() === "480,960,1600,2400,3000");

  /* ---- 4. worker ------------------------------------------------------------------ */
  const migrations = new URL("../drizzle/", import.meta.url).pathname;
  const raw = new Database(path.join(DIR, "portfolio.db"));
  for (const f of readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(migrations + f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) raw.exec(stmt);
  }
  raw.close();
  const { getDb, schema } = await import("../src/lib/db/index.ts");
  const { eq } = await import("drizzle-orm");
  const db = getDb();
  const { processImage } = await import("../src/lib/images/process.ts");
  const { startWorker, wakeWorker, reapStalled } = await import("../src/lib/jobs/worker.ts");

  // Traitement réel d'un panorama : variantes de 4800 px, jamais plus que l'original.
  mkdirSync(path.join(DIR, "media", "originals"), { recursive: true });
  const pano = await sharp({ create: { width: 7000, height: 1200, channels: 3, background: "#a0522d" } }).png().toBuffer();
  writeFileSync(path.join(DIR, "media", "originals", "aaaaaaaaaaaaaaaa.png"), pano);
  const out = await processImage("originals/aaaaaaaaaaaaaaaa.png", "aaaaaaaaaaaaaaaa");
  const widths = [...new Set(out.variants.files.map((f) => f.w))].sort((a, b) => a - b);
  ok("panorama 7000×1200 traité : variantes 480…4800 px", widths.join() === "480,960,1600,2400,3600,4800", widths.join());

  const media = (name, status) => db.insert(schema.media).values({ key: `originals/${name}.png`, sha256: name.padEnd(64, "0"), kind: "image", mime: "image/png", originalName: `${name}.png`, size: 1, status, alt: { fr: "", en: "" } }).returning({ id: schema.media.id }).get().id;
  const job = (mediaId, status, attempts, updatedAt = new Date()) => db.insert(schema.jobs).values({ kind: "image", mediaId, status, attempts, updatedAt }).returning({ id: schema.jobs.id }).get().id;
  const mediaOf = (id) => db.select().from(schema.media).where(eq(schema.media.id, id)).get();
  const jobOf = (id) => db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();

  // a. image qui a déjà interrompu le serveur une fois (2e essai en cours) ; b. première interruption ; c. job oublié.
  const mCrash = media("bbbbbbbbbbbbbbbb", "processing");
  const jCrash = job(mCrash, "running", 2);
  const mFirst = media("cccccccccccccccc", "processing");
  const jFirst = job(mFirst, "running", 1);
  await startWorker();
  ok("image dont le traitement a déjà coupé le serveur : échec lisible (pas de boucle de plantages)", jobOf(jCrash)?.status === "failed" && mediaOf(mCrash)?.status === "failed" && /arrêté pendant le traitement/.test(mediaOf(mCrash)?.error ?? ""), JSON.stringify([jobOf(jCrash), mediaOf(mCrash)?.status]));
  ok("première interruption : remise en file (reprise au démarrage)", ["queued", "running", "failed"].includes(jobOf(jFirst)?.status) && mediaOf(mFirst) !== undefined && jobOf(jFirst)?.status !== "done");
  // Les originaux n'existent pas : le job repris échoue vite, proprement (jamais « processing » pour toujours).
  wakeWorker();
  // (la reprise attend 10 s ; on force l'échéance)
  db.update(schema.jobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(schema.jobs.id, jFirst)).run();
  ok("original introuvable : le job reprend puis échoue avec un message, média en échec", await wait(() => jobOf(jFirst)?.status === "failed" && mediaOf(mFirst)?.status === "failed" && Boolean(mediaOf(mFirst)?.error)), JSON.stringify([jobOf(jFirst)?.status, mediaOf(mFirst)?.status]));

  const mStale = media("dddddddddddddddd", "processing");
  const jStale = job(mStale, "running", 1, new Date(Date.now() - 3600_000));
  reapStalled("light");
  ok("job « running » oublié depuis une heure : mis en échec avec « Réessayer » possible (média en échec)", jobOf(jStale)?.status === "failed" && mediaOf(mStale)?.status === "failed" && /ne répond plus/.test(mediaOf(mStale)?.error ?? ""), JSON.stringify([jobOf(jStale)?.status, mediaOf(mStale)?.status]));
  const mFresh = media("eeeeeeeeeeeeeeee", "processing");
  const jFresh = job(mFresh, "running", 1);
  reapStalled("light");
  ok("job récent : laissé tranquille", jobOf(jFresh)?.status === "running");
} catch (error) {
  failures++;
  console.log("FAIL  exception :", error);
} finally {
  rmSync(DIR, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
