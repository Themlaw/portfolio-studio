#!/usr/bin/env node
/**
 * v0.17 (audit) — préchauffage des recadrages (inclus dans npm test) :
 *  1. lecture des URLs `/media/crop/…` d'une page rendue (signées, dédoublonnées, ordre des largeurs courantes d'abord) ;
 *  2. job « crop-warm » (file image, basse priorité) : une page publiée est rendue par le serveur, ses variantes
 *     recadrées sont générées sur disque ; un doublon n'est pas remis en file ;
 *  3. une image à traiter passe AVANT la suite du préchauffage (le job se remet en file et cède la place) ;
 *  4. au démarrage : un job par page publiée.
 * Usage : node --import tsx scripts/test-crop-warm.mjs
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import sharp from "sharp";

const DIR = mkdtempSync(path.join(process.env.TEST_TMP ?? tmpdir(), "pf-crop-warm-"));
process.env.DATA_DIR = DIR;
process.env.BETTER_AUTH_SECRET = "test-secret-0123456789abcdef-0123456789abcdef";

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, ms = 30000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await fn()) return true;
  return false;
};
let server;

try {
  const crop = await import("../src/lib/images/crop.ts");
  const cache = await import("../src/lib/images/crop-cache.ts");
  const warm = await import("../src/lib/jobs/crop-warm.ts");

  /* ---- 1. lecture des URLs ------------------------------------------------------------ */
  const units = crop.toUnits({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  const sig = cache.signCrop(7, crop.rectKey(units));
  const url = (w, f) => `/media/${crop.cropKey(7, units, sig, w, f)}`;
  const forged = `/media/${crop.cropKey(7, units, "0".repeat(20), 480, "webp")}`;
  const html = `<picture><source type="image/avif" srcSet="${url(480, "avif")} 480w, ${url(960, "avif")} 960w, ${url(1600, "avif")} 1600w"/><source srcSet="${url(480, "webp")} 480w, ${url(960, "webp")} 960w"/><img src="${url(960, "webp")}"/></picture><a href="${forged}">x</a><img src="/media/img/abc/480.webp">`;
  const keys = warm.cropKeysIn(html);
  ok("6 variantes distinctes lues (doublon et URL qui n'est pas un recadrage ignorés)", keys.length === 6, String(keys.length));
  ok("signature falsifiée : gardée par la lecture (vérifiée plus tard par la route)", keys.some((k) => k.sig === "0".repeat(20)));
  const order = keys.filter((k) => k.sig === sig).map((k) => `${k.width}.${k.format}`).join();
  ok("largeurs courantes d'abord (960, 1600 avant 480), AVIF avant WebP", order.startsWith("960.avif,1600.avif") && order.endsWith("480.webp"), order);

  /* ---- 2. job de préchauffage ------------------------------------------------------------ */
  const migrations = new URL("../drizzle/", import.meta.url).pathname;
  const raw = new Database(path.join(DIR, "portfolio.db"));
  for (const f of readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(migrations + f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) raw.exec(stmt);
  }
  raw.close();
  const { getDb, schema } = await import("../src/lib/db/index.ts");
  const { eq } = await import("drizzle-orm");
  const db = getDb();
  mkdirSync(path.join(DIR, "media", "originals"), { recursive: true });
  const original = (name, w, h) => sharp({ create: { width: w, height: h, channels: 3, background: "#aa5533" } }).png().toBuffer().then((b) => writeFileSync(path.join(DIR, "media", "originals", `${name}.png`), b));
  await original("aaaaaaaaaaaaaaaa", 3000, 2000);
  const variants = { v: 1, files: [{ key: "img/aaaaaaaaaaaaaaaa/480.webp", w: 480, h: 320, format: "webp", size: 1 }] };
  const mediaId = db.insert(schema.media).values({ key: "originals/aaaaaaaaaaaaaaaa.png", sha256: "a".repeat(64), kind: "image", mime: "image/png", originalName: "a.png", size: 1, status: "ready", width: 3000, height: 2000, variants, alt: { fr: "", en: "" } }).returning({ id: schema.media.id }).get().id;
  const pageId = db.insert(schema.pages).values({ slug: { fr: "decors", en: "scenery" }, title: { fr: "Décors", en: "Scenery" }, published: true }).returning({ id: schema.pages.id }).get().id;
  db.insert(schema.pages).values({ slug: { fr: "brouillon", en: "draft" }, title: { fr: "B", en: "B" }, published: false }).run();

  // 8 recadrages, toutes largeurs et formats : la page rendue par le « serveur » de test.
  const rects = Array.from({ length: 8 }, (_, i) => crop.toUnits({ x: 0.02 * i, y: 0.05, w: 0.5, h: 0.6 }));
  const all = [];
  let page = "";
  for (const u of rects) {
    const s = cache.signCrop(mediaId, crop.rectKey(u));
    const px = crop.rectPixels(u, 3000, 2000);
    for (const w of crop.cropWidths(px.w, px.h)) for (const f of ["avif", "webp"]) {
      const key = crop.cropKey(mediaId, u, s, w, f);
      all.push(cache.cropFile(mediaId, u, w, f));
      page += `<img srcset="/media/${key} ${w}w">`;
    }
  }
  const hits = [];
  server = createServer((req, res) => {
    hits.push(req.url);
    if (req.url === "/fr/decors") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html>${page}</html>`);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.PORT = String(server.address().port);

  const { startWorker, wakeWorker } = await import("../src/lib/jobs/worker.ts");
  ok("enqueueCropWarm : un job en file", warm.enqueueCropWarm(pageId, 0) === true);
  ok("doublon : pas de second job en file", warm.enqueueCropWarm(pageId, 0) === false && db.select().from(schema.jobs).where(eq(schema.jobs.kind, "crop-warm")).all().length === 1);

  // Une image à traiter, ajoutée une fois le préchauffage commencé : elle doit passer avant la fin.
  await original("bbbbbbbbbbbbbbbb", 800, 600);
  const imgMedia = db.insert(schema.media).values({ key: "originals/bbbbbbbbbbbbbbbb.png", sha256: "b".repeat(64), kind: "image", mime: "image/png", originalName: "b.png", size: 1, status: "processing", alt: { fr: "", en: "" } }).returning({ id: schema.media.id }).get().id;
  wakeWorker();
  ok("le serveur est interrogé pour la page publiée", await wait(() => hits.includes("/fr/decors")), hits.join());
  ok("premières variantes écrites sur disque", await wait(() => all.some((f) => existsSync(f))));
  db.insert(schema.jobs).values({ kind: "image", mediaId: imgMedia }).run();
  wakeWorker();
  ok("image à traiter : prête avant la fin du préchauffage (file image, priorité)", await wait(() => db.select().from(schema.media).where(eq(schema.media.id, imgMedia)).get()?.status === "ready") && all.some((f) => !existsSync(f)), `${all.filter((f) => existsSync(f)).length}/${all.length}`);
  ok("toutes les variantes de la page sont générées", await wait(() => all.every((f) => existsSync(f)), 120000), `${all.filter((f) => existsSync(f)).length}/${all.length}`);
  ok("job terminé et retiré de la table", await wait(() => db.select().from(schema.jobs).where(eq(schema.jobs.kind, "crop-warm")).all().length === 0));

  /* ---- 3. démarrage : un job par page publiée -------------------------------------------- */
  const queued = warm.enqueueCropWarmAll(0);
  ok("démarrage : un job pour la page publiée, aucun pour le brouillon", queued === 1, String(queued));
  ok("démarrage : relancé, pas de doublon", warm.enqueueCropWarmAll(0) === 0);
  void startWorker;
} catch (error) {
  failures++;
  console.log("FAIL  exception :", error);
} finally {
  server?.close();
  rmSync(DIR, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
