// Sonde lot 106 : PHASE=set (envoie le logo, écrit settings.styles) puis, après redémarrage du serveur, PHASE=measure.
import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";
const BASE = process.env.BASE, DATA = process.env.DATA_DIR, PHASE = process.env.PHASE, K = process.env.ONLY;
const svg = (w, h) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#2e4e9e"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2 - 2}" fill="#f2b705"/></svg>`);
const logos = { large: svg(600, 120), carre: svg(200, 200), haut: svg(80, 300),
  transp: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="100" fill="#2e4e9e"/></svg>`) };
const browser = await chromium.launch();
if (PHASE === "set") {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await p.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
  await p.fill("#email", process.env.ADMIN_EMAIL); await p.fill("#password", process.env.ADMIN_PASSWORD);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/admin/connexion")), p.click("button[type=submit]")]);
  const png = await sharp(logos[K]).png().toBuffer();
  const r = await (await ctx.request.post(`${BASE}/admin/api/upload`, { multipart: { file: { name: `p-${K}.png`, mimeType: "image/png", buffer: png } }, headers: { origin: BASE } })).json();
  await new Promise((r) => setTimeout(r, 8000));
  const db = new Database(`${DATA}/portfolio.db`);
  db.prepare("insert or replace into settings(key,value) values(?,?)").run("styles", JSON.stringify({ logo: { mediaId: r.media.id, ...(process.env.EXTRA ? JSON.parse(process.env.EXTRA) : {}) } }));
  db.close(); console.log("set", K, r.media.id);
} else {
  for (const w of [1440, 390]) {
    const c = await browser.newContext({ viewport: { width: w, height: 800 } }); const pg = await c.newPage();
    await pg.goto(`${BASE}/fr`, { waitUntil: "networkidle" }); await pg.waitForTimeout(1500);
    const m = await pg.evaluate(() => { const q = (s) => document.querySelector(s); const r = (e) => { const b = e.getBoundingClientRect(); return [b.top, b.bottom, b.height].map((x) => +x.toFixed(1)); };
      const img = q(".site-logo-img"); if (!img) return { err: "no img" };
      const bar = q(".site-header-bar"), brand = q(".site-brand"); const cs = getComputedStyle(brand);
      return { bar: r(bar), brand: r(brand), img: r(img), pad: getComputedStyle(bar).padding, lh: getComputedStyle(brand).height, mb: cs.marginBottom, mt: cs.marginTop, clip: cs.clipPath, fit: getComputedStyle(img).objectFit, hdr: r(q(".site-header")) }; });
    console.log(K, w, JSON.stringify(m));
    await pg.screenshot({ path: `${process.env.SHOT_DIR ?? "."}/${K}-${w}.png`, clip: { x: 0, y: 0, width: w, height: 140 } });
    await c.close();
  }
}
await browser.close();
