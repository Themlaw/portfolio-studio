#!/usr/bin/env node
/**
 * Lot 85 « sauvegarde complète » : une archive restaure TOUT ce qui n'est pas régénérable (dessins du kit, cadres importés,
 * logo, icônes, archive de thème importée, brouillons…), sur de vrais serveurs standalone et des données SYNTHÉTIQUES.
 *
 * Le test lance ses PROPRES serveurs (le serveur de la batterie ne sert pas) :
 *  A  données neuves, WITH_BACKUP=1 : on y range un jeu complet (envois, thèmes à kit par archive, Mon thème + versions, cadres importés,
 *     logo, icône du site en mode image puis en mode kit, pages et projet avec brouillons, corbeille, message, réglages), plus
 *     une référence volontairement orpheline et un dossier de stockage « inconnu ». Une sauvegarde automatique part.
 *  A2 mêmes données, redémarré (caches neufs) : référence de comparaison (octets de chaque URL /media/…, pages publiques, éditeur).
 *  B  volume NEUF + restauration PAR LE SCRIPT restore-backup.mjs : sommes de contrôle de la base par table, mêmes URL (200, mêmes octets),
 *     mêmes pages. C  « archive d'avant le lot 85 » (sans kit/ ni icons/ ni champs du manifest) : restaurée, avertissement dans le script
 *     et dans le journal du site.
 * Mode start obligatoire (BATT_SERVER=start : serveur standalone du build).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… BETTER_AUTH_SECRET=… PORT=… node scripts/e2e-backup85.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

import Database from "better-sqlite3";
import sharp from "sharp";

import { loadPreset } from "./lib/presets.mjs";
import { extractAll, readManifest } from "./restore-backup.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { writeZip } = await import("../src/lib/themes/zip.ts");
const { tarChunks } = await import("../src/lib/backup/tar.ts");

const PORT = Number(process.env.PORT ?? 3880);
const QUIET_S = 4;
const SA = process.env.STANDALONE_DIR ?? path.join(ROOT, ".next/standalone");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 60000, step = 400) => {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(step)) if (await fn()) return true;
  return false;
};
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${String(detail).slice(0, 700)}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label} : ${typeof v === "string" ? v : JSON.stringify(v)}`);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const mo = (b) => `${(b / 1048576).toFixed(2).replace(".", ",")} Mo`;

if (process.env.BATT_SERVER !== "start" && process.env.FORCE_START !== "1") {
  console.log("INFO backup85 exige le mode start (BATT_SERVER=start) : suite ignorée");
  process.exit(0);
}
for (const k of ["ADMIN_EMAIL", "ADMIN_PASSWORD"]) if (!process.env[k]) throw new Error(`Définir ${k}`);
if (!existsSync(path.join(SA, "server.js"))) throw new Error(`standalone absent : ${SA}`);

const tmpRoot = mkdtempSync(path.join(process.env.TEST_TMP ?? tmpdir(), "pf-e2e-backup85-"));
const dataA = path.join(tmpRoot, "data-a");
mkdirSync(dataA, { recursive: true });
const servers = [];

function startServer(port, dataDir, extraEnv = {}) {
  const env = { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), DATA_DIR: dataDir, PUBLIC_BASE_URL: `http://localhost:${port}` };
  for (const k of Object.keys(env)) if (k === "WITH_BACKUP" || k.startsWith("BACKUP_")) delete env[k];
  Object.assign(env, extraEnv);
  const out = [];
  const child = spawn("node", ["server.js"], { cwd: SA, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => out.push(String(d)));
  child.stderr.on("data", (d) => out.push(String(d)));
  const s = {
    port,
    base: `http://localhost:${port}`,
    log: () => out.join(""),
    stop: async () => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      await waitFor(() => child.exitCode !== null || child.signalCode !== null, 15000, 200);
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    },
  };
  servers.push(s);
  return s;
}
const ready = (s) => waitFor(async () => (await fetch(`${s.base}/fr`).catch(() => null))?.status === 200, 120000);

async function login(base) {
  const res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`connexion refusée (${res.status})`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const dbOf = (dir, readonly = true) => new Database(path.join(dir, "portfolio.db"), { readonly, fileMustExist: true });
const q = (dir, sql, ...args) => {
  const db = dbOf(dir);
  try {
    db.pragma("busy_timeout = 5000");
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};
const exec = (dir, sql, ...args) => {
  const db = dbOf(dir, false);
  try {
    db.pragma("busy_timeout = 5000");
    return db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
};
const tsx = (dir, code) => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8", env: { ...process.env, DATA_DIR: dir } });
  if (r.status !== 0) throw new Error(`tsx : ${r.stderr.slice(-1500)}`);
  return r.stdout.trim().split("\n").pop();
};

/* ---- Données synthétiques (aucune image ni donnée réelle) ------------------------------------------------------------- */

/** Image synthétique déterministe (dégradés + bruit lissé) : un poids réaliste après compression. */
async function art(w, h, seed, fmt, opts = {}) {
  const raw = Buffer.alloc(w * h * 3);
  let s = seed * 2654435761 >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = (x * 255 / w + seed * 37 + rnd() * 70) & 255;
      raw[i + 1] = (y * 255 / h + seed * 91 + rnd() * 70) & 255;
      raw[i + 2] = ((x + y) * 127 / (w + h) + seed * 13 + rnd() * 70) & 255;
    }
  let img = sharp(raw, { raw: { width: w, height: h, channels: 3 } }).blur(1.2);
  if (opts.alpha) img = img.ensureAlpha().composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="none"/><rect x="${w * 0.2}" y="${h * 0.2}" width="${w * 0.6}" height="${h * 0.6}" fill="black"/></svg>`), blend: "dest-out" }]);
  if (fmt === "avif") return img.avif({ quality: 45, effort: 1 }).toBuffer();
  if (fmt === "webp") return img.webp({ quality: 70 }).toBuffer();
  return img.png().toBuffer();
}
const svgOf = (seed) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><path d="M4 ${20 + seed}C30 4 60 40 116 8" fill="none" stroke="#000" stroke-width="6"/></svg>`);
const h16 = (data) => sha(data).slice(0, 16);

/** Kit complet de synthèse : { kit (assets.kit), files: [{name, data}] }. `n` varie le contenu. */
async function syntheticKit(n, scale = 1) {
  const files = [];
  const put = (data, ext) => {
    files.push({ name: `assets/${h16(data)}.${ext}`, data });
    return `/media/kit/${h16(data)}.${ext}`;
  };
  const pair = async (w, h, seed, opts) => ({ avif: put(await art(w, h, seed + n * 100, "avif", opts), "avif"), webp: put(await art(w, h, seed + n * 100, "webp", opts), "webp"), w, h });
  const plans = [];
  for (let i = 0; i < 5; i++) plans.push({ ...(await pair(Math.round(1400 * scale), Math.round(700 * scale), 10 + i)), x: 100 * i, y: 50 * i });
  const kit = {
    plans,
    signature: { ...(await pair(600, 200, 20)), colors: true },
    icon: { svg: put(svgOf(n), "svg"), w: 512, h: 512 },
    paper: { image: await pair(512, 512, 30), overHero: 0.3 },
    frame: { image: await pair(256, 256, 40, { alpha: true }), slice: [48, 48, 48, 48] },
    stroke: { svg: put(svgOf(n + 3), "svg"), w: 120, h: 40 },
    icons: { arrowLeft: await pair(96, 96, 50), arrowRight: await pair(96, 96, 51), close: { svg: put(svgOf(n + 5), "svg"), w: 120, h: 40 }, play: { svg: put(svgOf(n + 6), "svg"), w: 120, h: 40 } },
    tape: await pair(400, 120, 60),
    cursors: { default: { png: put(await art(32, 32, 70 + n, "png"), "png"), png2x: put(await art(64, 64, 71 + n, "png"), "png"), x: 2, y: 3 } },
  };
  return { kit, files };
}
async function themePackage(name, n, scale) {
  const base = await loadPreset("galerie-lumineuse");
  const { kit, files } = await syntheticKit(n, scale);
  const theme = { ...base, name, assets: { ...base.assets, kit } };
  return { zip: writeZip([{ name: "theme.json", data: Buffer.from(JSON.stringify({ format: "portfolio-theme", version: 1, theme })) }, ...files]), files };
}

async function main() {
  /* ================= A : données neuves, sauvegardes automatiques ================= */
  const A = startServer(PORT + 1, dataA, { WITH_BACKUP: "1", BACKUP_QUIET_SEC: String(QUIET_S), BACKUP_KEEP: "3", BACKUP_MAX_HOURS: "6" });
  ok("A. serveur sur des données neuves démarré", await ready(A), A.log().slice(-500));
  const cookie = await login(A.base);
  const post = async (url, form) => {
    const res = await fetch(`${A.base}${url}`, { method: "POST", headers: { cookie, origin: A.base }, body: form });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const formOf = (data, name, type) => {
    const f = new FormData();
    f.set("file", new Blob([data], { type }), name);
    return f;
  };

  // Envois (médiathèque) : trois images ; l'une ira à la corbeille.
  const mediaIds = [];
  for (let i = 0; i < 3; i++) {
    const r = await post("/admin/api/upload", formOf(await art(900 + i * 100, 600, 200 + i, "png"), `synthese85-${i}.png`, "image/png"));
    if (!r.body?.ok) throw new Error(`envoi refusé : ${JSON.stringify(r)}`);
    mediaIds.push(r.body.media.id);
  }
  ok("A. trois images envoyées et traitées", await waitFor(() => q(dataA, "select count(*) n from media where status = 'ready'")[0].n >= 3, 120000), JSON.stringify(q(dataA, "select id, status, error from media")));

  // Thèmes à kit complet par archive de thème : un thème à part (ancien thème), puis Mon thème (2 versions).
  const pkgs = [
    ["Ancien thème à kit (synthèse)", "apart", await themePackage("Ancien thème à kit (synthèse)", 1, 1)],
    ["Mon thème v1", "version", await themePackage("Kit pour Mon thème 1", 2, 1)],
    ["Mon thème v2", "version", await themePackage("Kit pour Mon thème 2", 3, 1)],
  ];
  const kitFiles = new Set();
  for (const [label, mode, p] of pkgs) {
    const r = await post(`/admin/api/themes/import?mode=${mode}`, formOf(p.zip, `${label}.zip`, "application/zip"));
    ok(`A. archive de thème importée : ${label}`, r.body?.ok === true, JSON.stringify(r));
    for (const f of p.files) kitFiles.add(f.name.replace("assets/", "kit/"));
  }
  const mineId = q(dataA, "select id from themes where mine = 1")[0]?.id;
  ok("A. Mon thème existe, avec deux versions", !!mineId && q(dataA, "select count(*) n from theme_versions where theme_id = ?", mineId)[0].n >= 2, String(mineId));

  // Cadres importés (bibliothèque) : un PNG à bord transparent, un SVG.
  const frameSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5 5H95V95H5Z M20 20V80H80V20Z" fill="#334" fill-rule="evenodd"/></svg>');
  const framePng = await sharp({ create: { width: 160, height: 160, channels: 4, background: { r: 120, g: 60, b: 30, alpha: 1 } } })
    .composite([{ input: Buffer.from('<svg width="96" height="96"><rect width="96" height="96" fill="black"/></svg>'), left: 32, top: 32, blend: "dest-out" }])
    .png()
    .toBuffer();
  for (const [data, name, type] of [[framePng, "cadre85.png", "image/png"], [frameSvg, "cadre85.svg", "image/svg+xml"]]) {
    const r = await post("/admin/api/cadres", formOf(data, name, type));
    ok(`A. cadre importé : ${name}`, r.body?.ok === true, JSON.stringify(r));
  }

  // Logo du thème depuis une image (kit/…), posé sur Mon thème ; Mon thème mis en ligne ; icône du site : image, puis kit.
  const logo = tsx(dataA, `
    import { logoFromMedia } from "./src/lib/kit/logo.ts"; import { getThemeForEdit, saveTheme, activateTheme } from "./src/lib/edit/themes.ts";
    const r = await logoFromMedia(${mediaIds[1]}); if (!r.ok) { console.log(JSON.stringify(r)); process.exit(0); }
    const t = getThemeForEdit(${JSON.stringify(mineId)}); t.assets = { ...t.assets, kit: { ...(t.assets.kit ?? {}), signature: r.data.signature } };
    const s = saveTheme(${JSON.stringify(mineId)}, t, true); const a = activateTheme(${JSON.stringify(mineId)});
    console.log(JSON.stringify({ ok: s.ok && a.ok, s: s.ok ? null : s.message, a: a.ok ? null : a.message, sig: r.data.signature }));`);
  const logoRes = JSON.parse(logo);
  ok("A. logo importé (kit/…) posé sur Mon thème, thème mis en ligne", logoRes.ok === true, logo);
  for (const k of ["avif", "webp"]) if (logoRes.sig?.[k]) kitFiles.add(logoRes.sig[k].replace("/media/", ""));
  const fav = (mode, mediaId) => tsx(dataA, `import { saveFavicon } from "./src/lib/edit/seo.ts"; const r = await saveFavicon(${JSON.stringify({ mode, mediaId, mono: { letters: null, shape: "round", bg: "primary", ink: "onPrimary" }, crop: null })}); console.log(JSON.stringify(r.ok ? { ok: true } : r));`);
  ok("A. icône du site en mode image (dossier icons/…)", JSON.parse(fav("image", mediaIds[2])).ok === true);
  const iconDirs = () => {
    const base = path.join(dataA, "media/icons");
    return existsSync(base) ? readdirSync(base) : [];
  };
  ok("A. … un dossier icons/ existe", iconDirs().length >= 1, iconDirs().join(","));
  const iconUrls = ["/site-icon/32.png", "/site-icon/192.png", "/site-icon/512.png", "/favicon.ico"];
  for (const u of iconUrls) await fetch(`${A.base}${u}`).catch(() => null); // icône image servie (cache de l'ancien état)
  ok("A. icône du site en mode kit (calque « Icône » du thème en ligne)", JSON.parse(fav("kit", null)).ok === true);
  for (const u of iconUrls) await fetch(`${A.base}${u}`).catch(() => null); // icons-auto/<empreinte>/… fabriqué à la première requête
  const autoDirs = existsSync(path.join(dataA, "media/icons-auto")) ? readdirSync(path.join(dataA, "media/icons-auto")) : [];
  info("icons-auto", autoDirs.join(",") || "aucun");

  // Contenu : page publiée avec brouillon non publié, nouvelle page jamais publiée, projet avec texte en brouillon, corbeille, message, réglages.
  const L = (fr, en) => ({ fr, en });
  const pageRow = q(dataA, "select id from pages where published = 1 and deleted_at is null and slug != ? order by id limit 1", JSON.stringify(L("", "")))[0];
  const draftOf = (extra) => JSON.stringify({ title: L("Brouillon synthèse", "Synthetic draft"), slug: L("brouillon-synthese", "synthetic-draft"), meta: { title: L("", ""), description: L("", "") }, published: false, inMenu: false, accent: null, blocks: extra });
  const imgBlock = (uid, id) => ({ uid, type: "image", props: { mediaId: id, width: "wide" } });
  if (pageRow) {
    const cur = q(dataA, "select title, slug, meta, published, nav_order from pages where id = ?", pageRow.id)[0];
    const draft = { title: JSON.parse(cur.title), slug: JSON.parse(cur.slug), meta: cur.meta ? JSON.parse(cur.meta) : { title: L("", ""), description: L("", "") }, published: Boolean(cur.published), inMenu: cur.nav_order !== null, accent: null, blocks: [imgBlock("b0", mediaIds[0]), imgBlock("b1", mediaIds[1])] };
    exec(dataA, "update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?", JSON.stringify(draft), pageRow.id);
  }
  exec(dataA, "insert into pages(slug, title, published, draft, draft_updated_at, draft_rev) values (?, ?, 0, ?, unixepoch(), 1)", JSON.stringify(L("brouillon-synthese", "synthetic-draft")), JSON.stringify(L("Brouillon synthèse", "Synthetic draft")), draftOf([imgBlock("b0", mediaIds[2])]));
  const draftPageId = q(dataA, "select id from pages where draft is not null and published = 0 order by id desc limit 1")[0].id;
  exec(dataA, "insert into projects(slug, title, context, description, year, position, draft_text, draft_text_page_id) values ('projet-synthese85', ?, ?, ?, '2026', 99, ?, ?)", JSON.stringify(L("Projet synthèse", "Synthetic project")), JSON.stringify(L("Contexte", "Context")), JSON.stringify(L("Texte", "Text")), JSON.stringify({ title: L("Titre brouillon", "Draft title"), context: L("c", "c"), description: L("d", "d"), year: "2027" }), draftPageId);
  exec(dataA, "update media set deleted_at = unixepoch() where id = ?", mediaIds[0]);
  exec(dataA, "insert into pages(slug, title, published, deleted_at) values (?, ?, 0, unixepoch())", JSON.stringify(L("page-corbeille85", "trashed-page85")), JSON.stringify(L("Page à la corbeille", "Trashed page")));
  exec(dataA, "insert into messages(subject, fields, reply_to, ip_hash) values ('Message de synthèse', ?, 'visiteur@example.test', 'hash-synthese')", JSON.stringify([{ label: "Message", value: "Bonjour, ceci est un message synthétique." }]));
  exec(dataA, "insert into settings(key, value) values ('synthese85', ?) on conflict(key) do update set value = excluded.value", JSON.stringify({ note: "réglage de synthèse", n: 85 }));
  // Garde-fou : une référence /media/… dont le fichier n'existe pas et n'est pas régénérable ; un dossier de stockage que personne n'a prévu.
  const GHOST = "fantome85/oublie.png";
  exec(dataA, "insert into settings(key, value) values ('synthese85-orpheline', ?) on conflict(key) do update set value = excluded.value", JSON.stringify({ image: `/media/${GHOST}` }));
  const strayRel = "inconnu85/nouveau-dossier/piece.bin";
  mkdirSync(path.join(dataA, "media/inconnu85/nouveau-dossier"), { recursive: true });
  writeFileSync(path.join(dataA, "media", strayRel), Buffer.from("octets-non-prevus-85".repeat(100)));
  // Fiche d'un kit exporté (cache/kits/manifests) : exception à l'exclusion de cache/.
  mkdirSync(path.join(dataA, "cache/kits/manifests"), { recursive: true });
  writeFileSync(path.join(dataA, "cache/kits/manifests/export85.json"), JSON.stringify({ exportId: "export85", synthese: true }));
  mkdirSync(path.join(dataA, "cache/crops/1/x"), { recursive: true });
  writeFileSync(path.join(dataA, "cache/crops/1/x/100.webp"), "cache-a-vider");
  const seedDone = Date.now();
  info("jeu de données", { medias: mediaIds.length, fichiersKit: kitFiles.size, cadres: JSON.parse(q(dataA, "select value from settings where key = 'frameLibrary'")[0]?.value ?? '{"frames":[]}').frames?.length });

  /* ---- la sauvegarde automatique part après la quiétude ---- */
  const BK = path.join(dataA, "backup");
  const archives = () => (existsSync(BK) ? readdirSync(BK).filter((n) => /^portfolio-\d{8}-\d{6}(-\d+)?\.tar\.gz$/.test(n)).sort() : []);
  const newest = () => archives().at(-1);
  ok("A. une sauvegarde part après la quiétude", await waitFor(() => newest() && statSync(path.join(BK, newest())).mtimeMs > seedDone, (QUIET_S + 90) * 1000), archives().join(","));
  for (let prev = ""; prev !== newest(); ) {
    prev = newest();
    await sleep((QUIET_S + 4) * 1000);
  }
  const archive = path.join(BK, newest());
  info("archive", { nom: newest(), taille: mo(statSync(archive).size) });

  /* ---- contenu de l'archive ---- */
  const exA = path.join(tmpRoot, "extrait-a");
  mkdirSync(exA);
  const listed = await extractAll(archive, exA);
  const man = await readManifest(archive);
  info("manifest", man);
  const media = listed.filter((f) => f.startsWith("media/")).map((f) => f.slice(6));
  ok("archive : tous les fichiers de kit/ (archives de thème, logo) y sont", [...kitFiles].every((k) => media.includes(k)), [...kitFiles].filter((k) => !media.includes(k)).join(","));
  const frames = JSON.parse(q(dataA, "select value from settings where key = 'frameLibrary'")[0].value).frames;
  const frameKeys = JSON.stringify(frames).match(/\/media\/(kit\/[0-9a-f]{16}\.[a-z]+)/g)?.map((s) => s.slice(7)) ?? [];
  ok("archive : les cadres importés (frameLibrary) y sont", frameKeys.length >= 2 && frameKeys.every((k) => media.includes(k)), frameKeys.filter((k) => !media.includes(k)).join(","));
  ok("archive : le dossier icons/ de l'icône en mode image y est", iconDirs().length >= 1 && iconDirs().every((d) => media.some((m) => m.startsWith(`icons/${d}/`))), media.filter((m) => m.startsWith("icons")).join(","));
  ok("archive : la fiche du kit exporté (cache/kits/manifests) y est, pas le cache des recadrages", listed.includes("cache/kits/manifests/export85.json") && !listed.some((f) => f.startsWith("cache/crops")), listed.filter((f) => f.startsWith("cache")).join(","));
  ok("archive : un dossier de stockage inconnu est sauvegardé par défaut", media.includes(strayRel));
  ok("archive : les originaux y sont, pas les variantes régénérables (img/, vid/, doc/) ni icons-auto/ ni cache/", media.some((m) => m.startsWith("originals/")) && media.every((m) => !/^(img|doc|icons-auto|cache|tmp|kit-imports|backup)\//.test(m)), media.filter((m) => /^(img|doc|icons-auto|cache)\//.test(m)).join(","));
  ok("manifest : archive déclarée complète, avec le détail par catégorie", man.complete === true && man.storage?.kit?.files >= kitFiles.size && man.storage?.originals?.files >= 3 && man.storage?.icons?.files >= 1 && man.regenerable?.variants?.files >= 1, JSON.stringify(man));
  ok("manifest : la référence orpheline est signalée, et elle seule", man.missingRefs?.count === 1 && man.missingRefs.samples?.[0] === GHOST, JSON.stringify(man.missingRefs));
  ok("journal : avertissement nommant le fichier manquant", new RegExp(`\\[backup\\].*AVERTISSEMENT.*${GHOST.replace(".", "\\.")}`).test(A.log()), A.log().split("\n").filter((l) => l.includes("[backup]")).slice(-4).join(" | "));
  const tarList = spawnSync("tar", ["tzf", archive], { encoding: "utf8" });
  ok("archive lisible par tar (restauration « à la main »)", tarList.status === 0 && tarList.stdout.includes("media/kit/"), tarList.stderr);
  const panel = await (await fetch(`${A.base}/admin/sauvegardes`, { headers: { cookie } })).text();
  ok("écran Sauvegardes : avertissement affiché", panel.includes('data-testid="avertissement-sauvegarde"') && panel.includes(GHOST), panel.match(/data-testid="[^"]*sauvegarde[^"]*"/g)?.join(",") ?? "aucun repère");
  const sizeNew = statSync(archive).size;

  await A.stop();
  info("A arrêté", "ok");

  /* ================= Références de comparaison : A2 (mêmes données, caches neufs) ================= */
  // Références /media/… trouvées dans TOUTE la base (calcul indépendant de celui du site).
  const refsOf = (dir) => {
    const db = dbOf(dir);
    const found = new Set();
    try {
      for (const { name } of db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '\\_\\_%' escape '\\'").all()) {
        if (["session", "account", "verification", "rate_limit", "auth_throttle"].includes(name)) continue;
        const cols = db.prepare(`pragma table_info("${name}")`).all().filter((c) => !/^(integer|real|numeric|boolean)/i.test(c.type));
        for (const c of cols) for (const row of db.prepare(`select "${c.name}" v from "${name}" where "${c.name}" like '%/media/%'`).all()) {
          for (const m of String(row.v).matchAll(/(?<![A-Za-z0-9._~-])\/media\/((?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*)/g)) found.add(m[1]);
        }
      }
    } finally {
      db.close();
    }
    return [...found].sort();
  };
  const refs = refsOf(dataA).filter((k) => k !== GHOST);
  ok("références /media/… dans la base : kit, cadres, logo et images de thème comptés", refs.some((k) => k.startsWith("kit/")) && refs.length >= kitFiles.size, `${refs.length} références`);
  // Somme de contrôle par table (hors tables qui bougent toutes seules).
  const VOLATILE = new Set(["session", "rate_limit", "auth_throttle", "verification", "jobs"]);
  const checksums = (dir) => {
    const db = dbOf(dir);
    const out = {};
    try {
      for (const { name } of db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all()) {
        if (VOLATILE.has(name)) continue;
        const h = createHash("sha256");
        let n = 0;
        let rows;
        try {
          rows = db.prepare(`select * from "${name}" order by rowid`).iterate();
        } catch {
          rows = db.prepare(`select * from "${name}"`).iterate();
        }
        for (const row of rows) {
          h.update(JSON.stringify(row, (_, v) => (Buffer.isBuffer(v) ? v.toString("base64") : v)));
          n++;
        }
        out[name] = `${n}:${h.digest("hex").slice(0, 16)}`;
      }
    } finally {
      db.close();
    }
    return out;
  };
  const sumsA = checksums(dataA);

  const pagesToCompare = () => {
    const slugs = q(dataA, "select slug from pages where published = 1 and deleted_at is null").map((r) => JSON.parse(r.slug));
    const out = ["/fr", "/en"];
    for (const s of slugs) if (s.fr) out.push(`/fr/${s.fr}`);
    return [...new Set(out)];
  };
  const adminPages = ["/admin/cadres", "/admin/themes", `/admin/pages/${draftPageId}/editer`, ...(pageRow ? [`/admin/pages/${pageRow.id}/editer`] : [])];
  // Le flux RSC (<script>self.__next_f.push…) arrive dans un ordre qui varie d'une requête à l'autre : on compare le HTML sans lui, et
  // les données de la page (styles du thème, texte) par le HTML rendu.
  const normalize = (html) =>
    html
      .replace(/<script>self\.__next_f\.push\([^]*?\)<\/script>/g, "")
      .replace(/nonce="[^"]*"/g, "")
      .replace(/"nonce":"[^"]*"/g, "")
      .replace(/\\"nonce\\":\\"[^\\]*\\"/g, "")
      .replace(/\b(il y a|dans) [^<"]{1,24}/g, "~")
      .replace(/\d{8}-\d{6}/g, "AAAAMMJJ-HHMMSS")
      .replace(/localhost:\d+/g, "localhost:PORT")
      .replace(/\b\d{13}\b/g, "TS")
      .replace(/<meta name="next-size-adjust"[^>]*>/g, "")
      .replace(/\\"free\\":\{[^}]*\}/g, "")
      .replace(/\$undefined|<!--\$-->|<!--\/\$-->/g, "");
  const snapshot = async (S, ck) => {
    const out = { urls: {}, pages: {}, admin: {}, icons: {} };
    for (const k of refs) {
      const r = await fetch(`${S.base}/media/${k}`).catch(() => null);
      out.urls[k] = r ? { status: r.status, sha: sha(Buffer.from(await r.arrayBuffer())) } : { status: 0, sha: "" };
    }
    out.urls[strayRel] = { status: 0, sha: "" };
    for (const u of iconUrls) {
      const r = await fetch(`${S.base}${u}`).catch(() => null);
      out.icons[u] = r ? { status: r.status, sha: sha(Buffer.from(await r.arrayBuffer())) } : { status: 0, sha: "" };
    }
    for (const u of pagesToCompare()) {
      const r = await fetch(`${S.base}${u}`);
      out.pages[u] = { status: r.status, html: normalize(await r.text()) };
    }
    for (const u of adminPages) {
      const r = await fetch(`${S.base}${u}`, { headers: { cookie: ck } });
      out.admin[u] = { status: r.status, html: normalize(await r.text()) };
    }
    return out;
  };

  const A2 = startServer(PORT + 2, dataA);
  ok("A2. serveur de référence redémarré sur les mêmes données", await ready(A2), A2.log().slice(-400));
  const cookieA2 = await login(A2.base);
  const refA = await snapshot(A2, cookieA2);
  const refA2b = await snapshot(A2, cookieA2);
  const unstable = [...Object.keys(refA.pages).filter((u) => refA.pages[u].html !== refA2b.pages[u].html), ...Object.keys(refA.admin).filter((u) => refA.admin[u].html !== refA2b.admin[u].html)];
  for (const u of unstable.slice(0, 2)) {
    const x = (refA.pages[u] ?? refA.admin[u]).html;
    const y = (refA2b.pages[u] ?? refA2b.admin[u]).html;
    let i = 0;
    while (i < x.length && x[i] === y[i]) i++;
    info(`différence ${u}`, `${x.slice(Math.max(0, i - 60), i + 80)} <<>> ${y.slice(Math.max(0, i - 60), i + 80)}`);
  }
  if (unstable.length) info("pages instables entre deux lectures du MÊME serveur (exclues de la comparaison)", unstable.join(", "));
  const refKeys = Object.keys(refA.urls).filter((k) => k !== strayRel);
  ok("A2. toutes les URL /media/… référencées répondent 200 (source)", refKeys.every((k) => refA.urls[k].status === 200), refKeys.filter((k) => refA.urls[k].status !== 200).slice(0, 5).join(","));
  ok("A2. pages publiques et éditeur lisibles (200)", Object.values(refA.pages).filter((p) => p.status === 200).length >= 3 && Object.values(refA.admin).filter((p) => p.status === 200).length >= 3, JSON.stringify([...Object.entries(refA.pages), ...Object.entries(refA.admin)].map(([u, p]) => `${u}:${p.status}`)));
  await A2.stop();

  /* ================= B : volume neuf + script de restauration ================= */
  const runRestore = (arch, dir) => spawnSync(process.execPath, [path.join(ROOT, "scripts/restore-backup.mjs"), arch, dir], { encoding: "utf8" });
  const dataB = path.join(tmpRoot, "data-b");
  mkdirSync(dataB, { recursive: true });
  const rb = runRestore(archive, dataB);
  ok("B. restore-backup.mjs : restauration réussie", rb.status === 0, rb.stdout + rb.stderr);
  ok("B. le script n'avertit que de la référence orpheline (archive complète, pas « d'avant le lot »)", !/avant le lot 85/i.test(rb.stdout + rb.stderr) && (rb.stderr.match(/AVERTISSEMENT/g) ?? []).length === 1 && rb.stderr.includes(GHOST), rb.stdout + rb.stderr);
  const iconFiles = iconDirs().flatMap((d) => readdirSync(path.join(dataA, "media/icons", d)).map((f) => `media/icons/${d}/${f}`));
  ok("B. fichiers de l'icône en mode image (icons/) identiques à l'octet", iconFiles.length >= 6 && iconFiles.every((f) => existsSync(path.join(dataB, f)) && readFileSync(path.join(dataB, f)).equals(readFileSync(path.join(dataA, f)))), iconFiles.join(","));
  const restoredFiles = (rel) => (existsSync(path.join(dataB, rel)) ? readdirSync(path.join(dataB, rel), { recursive: true }).length : 0);
  info("B. fichiers restaurés", { kit: restoredFiles("media/kit"), icons: restoredFiles("media/icons"), originals: restoredFiles("media/originals") });
  // Sommes de contrôle : la base restaurée AVANT tout démarrage du site (le démarrage la touche : file de traitements, migrations).
  const sumsB = checksums(dataB);
  const diff = Object.keys(sumsA).filter((t) => sumsA[t] !== sumsB[t]);
  ok("B. somme de contrôle identique pour chaque table (brouillons, versions de thème, corbeille, messages, réglages compris)", diff.length === 0 && Object.keys(sumsA).length >= 15, `${diff.map((t) => `${t}: ${sumsA[t]} ≠ ${sumsB[t]}`).join(" ; ")} (${Object.keys(sumsA).length} tables)`);
  info("tables comparées", Object.keys(sumsA).length);

  const B = startServer(PORT + 3, dataB);
  ok("B. serveur démarré sur le volume restauré", await ready(B), B.log().slice(-500));
  await waitFor(() => /\[backup\] restauration détectée/.test(B.log()), 60000);
  ok("B. journal : restauration détectée, aucune alerte de fichier manquant", /\[backup\] restauration détectée/.test(B.log()) && !/fichier\(s\) cité\(s\) dans la base/.test(B.log().replace(new RegExp(`.*${GHOST}.*\\n?`, "g"), "")), B.log().split("\n").filter((l) => l.includes("[backup]")).join(" | "));
  const settled = await waitFor(() => q(dataB, "select count(*) n from media where status != 'ready'")[0].n === 0 && q(dataB, "select count(*) n from jobs where status in ('queued','running')")[0].n === 0, 180000, 1000);
  ok("B. variantes régénérées à partir des originaux (file de traitement vide)", settled, JSON.stringify(q(dataB, "select id, kind, status, attempts from jobs where status in ('queued','running')")));
  const cookieB = await login(B.base);
  const refB = await snapshot(B, cookieB);
  const urlDiff = refKeys.filter((k) => refB.urls[k].status !== 200 || refB.urls[k].sha !== refA.urls[k].sha);
  const nonRegen = urlDiff.filter((k) => !/^(img|vid|doc)\//.test(k));
  ok("B. les URL /media/… référencées répondent 200 avec des octets identiques (kit, cadres, logo, icônes, originaux)", nonRegen.length === 0, nonRegen.slice(0, 6).map((k) => `${k}:${refB.urls[k].status}`).join(","));
  const regenDiff = urlDiff.filter((k) => /^(img|vid|doc)\//.test(k));
  ok("B. variantes régénérées : toutes servies en 200 (octets identiques si l'encodeur est déterministe)", regenDiff.every((k) => refB.urls[k].status === 200), regenDiff.filter((k) => refB.urls[k].status !== 200).join(","));
  if (regenDiff.length) info("variantes régénérées avec des octets différents (encodeur non déterministe)", regenDiff.length);
  const strayB = await fetch(`${B.base}/media/${strayRel}`);
  ok("B. fiche de kit restaurée, cache des recadrages absent", existsSync(path.join(dataB, "cache/kits/manifests/export85.json")) && !existsSync(path.join(dataB, "cache/crops")));
  ok("B. le fichier du dossier inconnu est revenu à l'identique", existsSync(path.join(dataB, "media", strayRel)) && readFileSync(path.join(dataB, "media", strayRel)).equals(readFileSync(path.join(dataA, "media", strayRel))), `${strayB.status}`);
  ok("B. icône du site (/site-icon, /favicon.ico) identique", iconUrls.every((u) => refB.icons[u].status === refA.icons[u].status && refB.icons[u].sha === refA.icons[u].sha), iconUrls.filter((u) => refB.icons[u].sha !== refA.icons[u].sha).join(","));
  const stable = (set, kind) => Object.keys(refA[kind]).filter((u) => !unstable.includes(u) && refA[kind][u].status === 200);
  const pubDiff = stable(refA, "pages").filter((u) => refB.pages[u].status !== 200 || refB.pages[u].html !== refA.pages[u].html);
  for (const u of pubDiff.slice(0, 2)) {
    const x = refA.pages[u].html;
    const y = refB.pages[u].html;
    let i = 0;
    while (i < x.length && x[i] === y[i]) i++;
    info(`différence ${u} (A2 <<>> B)`, `${x.slice(Math.max(0, i - 100), i + 120)} <<>> ${y.slice(Math.max(0, i - 100), i + 120)}`);
  }
  ok("B. pages publiques identiques", stable(refA, "pages").length >= 3 && pubDiff.length === 0, pubDiff.join(","));
  const admDiff = stable(refA, "admin").filter((u) => refB.admin[u].status !== 200 || refB.admin[u].html !== refA.admin[u].html);
  for (const u of admDiff.slice(0, 2)) {
    const x = refA.admin[u].html;
    const y = refB.admin[u].html;
    let i = 0;
    while (i < x.length && x[i] === y[i]) i++;
    info(`différence ${u} (A2 <<>> B)`, `${x.slice(Math.max(0, i - 100), i + 120)} <<>> ${y.slice(Math.max(0, i - 100), i + 120)}`);
  }
  ok("B. éditeur et écrans d'admin identiques (brouillons compris)", stable(refA, "admin").length >= 3 && admDiff.length === 0, admDiff.join(","));
  await B.stop();

  /* ================= C : archive d'avant le lot 85 ================= */
  const oldFiles = listed.filter((f) => !/^media\/(kit|icons|inconnu85)\//.test(f));
  const oldDir = path.join(tmpRoot, "ancienne-archive");
  const exOld = path.join(tmpRoot, "extrait-ancien");
  mkdirSync(oldDir);
  mkdirSync(exOld);
  await extractAll(archive, exOld);
  const oldMan = { format: 1, app: "portfolio", version: man.version, createdAt: man.createdAt, reason: man.reason, includesMedia: true, mediaCount: man.mediaCount, mediaFiles: man.mediaFiles, fontFiles: man.fontFiles, dbBytes: man.dbBytes, bytes: man.bytes };
  writeFileSync(path.join(exOld, "manifest.json"), `${JSON.stringify(oldMan, null, 2)}\n`);
  const entries = ["manifest.json", ...oldFiles.filter((f) => f !== "manifest.json")].map((name) => {
    const file = path.join(exOld, name);
    return { name, size: statSync(file).size, mtime: Math.floor(statSync(file).mtimeMs / 1000), source: { file } };
  });
  const oldArchive = path.join(oldDir, "portfolio-20260101-000000.tar.gz");
  await pipeline(Readable.from(tarChunks(entries, { shortfall: 0 })), createGzip({ level: 3 }), createWriteStream(oldArchive));
  const sizeOld = statSync(oldArchive).size;
  const dataC = path.join(tmpRoot, "data-c");
  mkdirSync(dataC, { recursive: true });
  const rc = runRestore(oldArchive, dataC);
  ok("C. archive d'avant le lot : restauration acceptée", rc.status === 0 && existsSync(path.join(dataC, "portfolio.db")), rc.stdout + rc.stderr);
  ok("C. … avec un avertissement clair (script) : pas de dessins du kit ni de cadres", /AVERTISSEMENT/.test(rc.stdout + rc.stderr) && /kit/i.test(rc.stdout + rc.stderr) && /cadre/i.test(rc.stdout + rc.stderr), rc.stdout + rc.stderr);
  const C = startServer(PORT + 4, dataC);
  ok("C. serveur démarré sur l'ancienne archive restaurée", await ready(C), C.log().slice(-400));
  await waitFor(() => /\[backup\] restauration détectée/.test(C.log()), 60000);
  ok("C. journal du site : avertissement sur ce que l'ancienne archive ne contenait pas", /\[backup\].*AVERTISSEMENT.*(kit|cadre)/i.test(C.log()), C.log().split("\n").filter((l) => l.includes("[backup]")).join(" | "));
  await C.stop();

  /* ================= Poids ================= */
  const kitBytes = [...kitFiles].reduce((n, k) => n + (existsSync(path.join(dataA, "media", k)) ? statSync(path.join(dataA, "media", k)).size : 0), 0);
  info("poids", { archiveAvant: mo(sizeOld), archiveApres: mo(sizeNew), ajoute: mo(sizeNew - sizeOld), fichiersKitSynthese: kitFiles.size, octetsKitSynthese: mo(kitBytes) });
  ok("poids : l'archive grossit de ce que pèsent le kit, les cadres et les icônes (mesure ci-dessus)", sizeNew > sizeOld);
}

try {
  await main();
} catch (error) {
  failures++;
  console.log(`FAIL erreur inattendue — ${error?.stack ?? error}`);
} finally {
  for (const s of servers) await s.stop().catch(() => {});
  rmSync(tmpRoot, { recursive: true, force: true });
}
console.log(failures ? `${failures} échec(s)` : "Tout est vert");
process.exit(failures ? 1 : 0);
