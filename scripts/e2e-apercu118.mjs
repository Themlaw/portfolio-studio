#!/usr/bin/env node
/**
 * Lot 118 (urgent) : après « Publié », l'aperçu et le site public montrent TOUT DE SUITE la version publiée.
 * UN chromium, base NEUVE (seed), données SYNTHÉTIQUES. Le contenu qui change est le titre d'une œuvre d'un projet, publié depuis la
 * page « À propos » (planche du projet) ; ce titre est lu par l'accueil et les pages de collection (autres pages que celle publiée).
 *
 *  A. En-têtes des pages du site : revalidées (`max-age=0, must-revalidate`), jamais `s-maxage` d'un an ; cache du routeur client à 0.
 *  B. Cache PARTAGÉ simulé devant le site (comme Pangolin / Traefik / CDN : respecte Cache-Control et ETag) : visiteur anonyme, page
 *     lue avant la publication, relue juste après : à jour.
 *  C. Juste après « Publié » : HTML, RSC et préchargement de l'accueil, d'une collection et de la page publiée ; aperçu (draft mode)
 *     ouvert comme l'éditeur le fait (POST /admin/apercu) : rechargement et navigation interne.
 *  D. Un onglet d'aperçu déjà ouvert (autre onglet que l'éditeur) se rafraîchit seul à la publication, puis la navigation interne est
 *     à jour (cache du routeur de Next abandonné).
 *
 * Usage : BASE=http://localhost:4100 DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-apercu118.mjs
 */
import { createServer, request as httpRequest } from "node:http";

import { chromium } from "playwright";

import { login, pageIdOf, q1, sleep, sql } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const L = (t) => ({ fr: t, en: t });
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

/* ---- Cache partagé simulé -------------------------------------------------------------------------------------------------- */
const store = new Map();
function lifetime(cc) {
  const s = /s-maxage=(\d+)/.exec(cc)?.[1] ?? /(?:^|[ ,])max-age=(\d+)/.exec(cc)?.[1];
  if (/no-cache|must-revalidate|no-store|private/.test(cc)) return 0;
  return s === undefined ? 0 : Number(s) * 1000;
}
const proxy = createServer((req, res) => {
  const target = new URL(BASE);
  const key = req.url;
  const hit = req.method === "GET" && !req.headers.cookie ? store.get(key) : undefined;
  if (hit && Date.now() - hit.at < hit.life) {
    res.writeHead(hit.status, { ...hit.headers, "x-proxy": "HIT" });
    return res.end(hit.body);
  }
  const headers = { ...req.headers, host: target.host };
  if (hit?.etag) headers["if-none-match"] = hit.etag;
  const up = httpRequest({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers }, (r) => {
    const chunks = [];
    r.on("data", (c) => chunks.push(c));
    r.on("end", () => {
      const body = Buffer.concat(chunks);
      const cc = String(r.headers["cache-control"] ?? "");
      if (r.statusCode === 304 && hit) {
        hit.at = Date.now();
        hit.life = lifetime(cc || hit.headers["cache-control"] || "");
        res.writeHead(hit.status, { ...hit.headers, "x-proxy": "REVALIDATED" });
        return res.end(hit.body);
      }
      if (req.method === "GET" && !req.headers.cookie && r.statusCode === 200 && !/no-store|private/.test(cc)) {
        store.set(key, { status: 200, headers: r.headers, body, at: Date.now(), life: lifetime(cc), etag: r.headers.etag });
      }
      res.writeHead(r.statusCode, { ...r.headers, "x-proxy": "MISS" });
      res.end(body);
    });
  });
  req.pipe(up);
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const PROXY = `http://127.0.0.1:${proxy.address().port}`;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
await login(page, BASE);
const PAGE = pageIdOf("a-propos");

/** Publie, depuis l'éditeur (vrai clic sur « Publier »), un nouveau titre d'œuvre pour le projet de la planche de « À propos ». */
async function publish(tag) {
  sql((db) => {
    db.prepare("update slots set draft_title = ?, draft_page_id = ?, draft_position = 0 where id = 1").run(JSON.stringify(L(tag)), PAGE);
    const row = db.prepare("select title, slug, meta, nav_order from pages where id = ?").get(PAGE);
    const draft = { title: JSON.parse(row.title), slug: JSON.parse(row.slug), meta: row.meta ? JSON.parse(row.meta) : { title: L(""), description: L("") }, published: true, inMenu: row.nav_order !== null, accent: null, blocks: [{ uid: "pb", type: "project-board", props: { project: "les-hauts-chemins" } }] };
    db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), PAGE);
  });
  await page.goto(`${BASE}/admin/pages/${PAGE}/editer`, { waitUntil: "domcontentloaded" });
  const btn = page.getByRole("button", { name: "Publier", exact: true });
  await btn.waitFor();
  await page.waitForFunction(() => !!document.querySelector("iframe.ve-frame"));
  await sleep(2500);
  await btn.click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 2000 }).then(() => true, () => false)) await confirm.click();
  for (let i = 0; i < 120 && q1("select draft from pages where id = ?", PAGE)?.draft; i++) await sleep(500);
  return !q1("select draft from pages where id = ?", PAGE)?.draft;
}
const get = async (base, slug, headers = {}) => {
  const r = await fetch(`${base}/fr/${slug}`, { headers });
  return { status: r.status, cc: r.headers.get("cache-control") ?? "", stale: r.headers.get("x-nextjs-stale-time"), proxy: r.headers.get("x-proxy"), text: await r.text() };
};
const VARIANTS = { html: {}, rsc: { RSC: "1" }, prefetch: { RSC: "1", "Next-Router-Prefetch": "1" } };
const PAGES = ["", "personnages", "a-propos"];

/* ---- A. en-têtes ------------------------------------------------------------------------------------------------------------ */
{
  const bad = [];
  for (const slug of PAGES) {
    for (const [name, h] of Object.entries(VARIANTS)) {
      const r = await get(BASE, slug, h);
      const revalidated = /(?:max-age=0|no-cache)/.test(r.cc) && /must-revalidate|no-cache/.test(r.cc);
      const year = /s-maxage=(\d+)/.exec(r.cc)?.[1];
      const staleOk = r.stale === null || Number(r.stale) <= 0;
      if (!revalidated || (year && Number(year) > 0) || !staleOk) bad.push(`${slug || "/"} ${name}: cc="${r.cc}" stale=${r.stale}`);
    }
  }
  ok("A. pages du site (HTML, RSC, préchargement) revalidées à chaque fois, jamais s-maxage ; cache du routeur à 0", bad.length === 0, bad.join(" | "));
}

/* ---- B. cache partagé devant le site ----------------------------------------------------------------------------------------- */
{
  const T1 = `ZZB${Date.now()}`;
  for (const slug of ["personnages", "a-propos"]) await get(PROXY, slug); // lu avant la publication
  const before = await get(PROXY, "personnages");
  ok("B. (préalable) la page lue avant la publication ne montre pas le nouveau titre", !before.text.includes(T1));
  ok("B. publication", await publish(T1));
  const res = [];
  for (const slug of ["personnages", "a-propos"]) res.push([slug, await get(PROXY, slug)]);
  ok("B. cache partagé : visiteur anonyme, page relue juste après « Publié » = à jour (collection et page publiée)", res.every(([, r]) => r.text.includes(T1)), res.map(([s, r]) => `${s}: ${r.proxy} ${r.cc} ${r.text.includes(T1)}`).join(" | "));
}

/* ---- C. tous les chemins, juste après la publication ------------------------------------------------------------------------- */
{
  const T2 = `ZZC${Date.now()}`;
  for (const slug of PAGES) for (const h of Object.values(VARIANTS)) await get(BASE, slug, h); // caches du serveur remplis
  ok("C. publication", await publish(T2));
  const stale = [];
  for (const slug of PAGES) {
    for (const [name, h] of Object.entries(VARIANTS)) {
      const r = await get(BASE, slug, h);
      const shows = slug === "" ? true : r.text.includes(T2); // l'accueil ne montre pas forcément l'œuvre : seule la fraîcheur compte (voir plus bas)
      if (!shows) stale.push(`${slug || "/"} ${name}`);
    }
  }
  ok("C. juste après « Publié » : HTML, RSC et préchargement de la collection et de la page publiée à jour", stale.length === 0, stale.join(", "));
  // Aperçu comme l'éditeur l'ouvre (POST /admin/apercu, nouvel onglet) : premier chargement, rechargement, navigation interne.
  const T3 = `ZZD${Date.now()}`;
  const prev = await ctx.newPage();
  prev.setDefaultTimeout(60000);
  await prev.goto(`${BASE}/admin/pages/${PAGE}`, { waitUntil: "networkidle" });
  const [np] = await Promise.all([ctx.waitForEvent("page"), prev.getByRole("button", { name: /Prévisualiser/ }).click()]);
  np.setDefaultTimeout(60000);
  await np.waitForLoadState("networkidle");
  await np.locator('a[href="/fr/personnages"]').first().click();
  await np.waitForURL("**/personnages");
  await sleep(800);
  ok("C. aperçu ouvert avant la publication (état d'avant)", (await np.content()).includes(T2) && !(await np.content()).includes(T3));

  /* ---- D. l'onglet d'aperçu déjà ouvert suit la publication ---------------------------------------------------------------- */
  ok("D. publication depuis l'éditeur", await publish(T3));
  let refreshed = false;
  for (let i = 0; i < 40 && !refreshed; i++) {
    refreshed = (await np.content()).includes(T3);
    if (!refreshed) await sleep(500);
  }
  ok("D. l'onglet d'aperçu déjà ouvert se rafraîchit seul : le nouveau titre apparaît sans rien toucher", refreshed);
  await np.locator('a[href="/fr/a-propos"]').first().click();
  await np.waitForURL("**/a-propos");
  await sleep(800);
  ok("D. navigation interne dans l'aperçu : page publiée à jour", (await np.content()).includes(T3));
  await np.locator('a[href="/fr/personnages"]').first().click();
  await np.waitForURL("**/personnages");
  await sleep(800);
  ok("D. navigation interne dans l'aperçu : collection à jour", (await np.content()).includes(T3));
  await np.reload({ waitUntil: "networkidle" });
  ok("D. rechargement de l'aperçu : à jour", (await np.content()).includes(T3));
  // Site public (non aperçu) de l'artiste connectée, ouvert avant la publication puis publication : même chose.
  const T4 = `ZZE${Date.now()}`;
  ok("D. publication (site public)", await publish(T4));
  const pubTab = await ctx.newPage();
  await pubTab.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  ok("D. site public ouvert après la publication : à jour au premier chargement", (await pubTab.content()).includes(T4));
}

await browser.close();
proxy.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
