import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";
const BASE = process.env.BASE, DATA = process.env.DATA_DIR;
const svg = (w,h,extra="") => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#2e4e9e"/><circle cx="${w/2}" cy="${h/2}" r="${Math.min(w,h)/2-2}" fill="#f2b705"/>${extra}</svg>`);
const logos = { large: svg(600,120), carre: svg(200,200), haut: svg(80,300),
  transp: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="100" fill="#2e4e9e"/></svg>`) };
const browser = await chromium.launch();
const ctx = await browser.newContext();
const p = await ctx.newPage();
await p.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await p.fill("#email", process.env.ADMIN_EMAIL); await p.fill("#password", process.env.ADMIN_PASSWORD);
await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/admin/connexion")), p.click("button[type=submit]")]);
const ids = {};
const ex = new Database(`${DATA}/portfolio.db`).prepare("select id from media order by id").all().map(r=>r.id);
if (ex.length>=4) Object.keys(logos).forEach((k,i)=>ids[k]=ex[i]);
else for (const [k,b] of Object.entries(logos)) {
  const png = await sharp(b).png().toBuffer();
  const r = await (await ctx.request.post(`${BASE}/admin/api/upload`, { multipart: { file: { name: `p-${k}.png`, mimeType: "image/png", buffer: png } }, headers: { origin: BASE } })).json();
  ids[k] = r.media.id;
}
await new Promise(r=>setTimeout(r,8000));
for (const [k,id] of Object.entries(ids)) { if (process.env.ONLY && process.env.ONLY!==k) continue;
  const db = new Database(`${DATA}/portfolio.db`);
  db.prepare("insert or replace into settings(key,value) values(?,?)").run('styles', JSON.stringify({ logo: { mediaId: id, ...(process.env.EXTRA?JSON.parse(process.env.EXTRA):{}) } }));
  db.close();
  for (const w of [1440, 390]) {
    const c = await browser.newContext({ viewport: { width: w, height: 800 } });
    const pg = await c.newPage();
    await pg.goto(`${BASE}/fr`, { waitUntil: "networkidle" }); await pg.waitForTimeout(1500);
    const m = await pg.evaluate(() => { const r=e=>{const b=e.getBoundingClientRect();return [b.top,b.bottom,b.height].map(x=>+x.toFixed(1))}; const q=s=>document.querySelector(s);
      const cs=getComputedStyle(q(".site-logo-img")); return { bar:r(q(".site-header-bar")), brand:r(q(".site-brand")), img:r(q(".site-logo-img")), imgNat:[q(".site-logo-img").naturalWidth,q(".site-logo-img").naturalHeight], display:cs.display, barPad:getComputedStyle(q(".site-header-bar")).padding, bh:getComputedStyle(q(".site-brand")).height, hdr: r(q(".site-header")) }; });
    console.log(k, w, JSON.stringify(m));
    await c.close();
  }
}
await browser.close();
