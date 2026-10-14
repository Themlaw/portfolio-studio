#!/usr/bin/env node
/**
 * Surlignage (lot 21, correction v0.19) : l'élément garde sa boîte. Un titre multiligne et un élément de menu
 * portent les déclarations réelles de `backdropDecls("highlight")` ; on mesure dans chromium qu'ils gardent leur
 * `display`, leurs marges et leur hauteur (le suivant ne bouge pas) par rapport au même élément sans fond, et que
 * le trait de surlignage est bien là (couleur, ligne par ligne). Sans serveur. Captures : $SHOTS si défini.
 * Usage : node --import tsx scripts/test-highlight-layout.mjs
 */
import { chromium } from "playwright";

import { backdropDecls } from "../src/themes/text-backdrop.ts";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const css = (decls) => decls.map(([k, v]) => `${k}:${v}`).join(";");
const variants = { sans: "", surligne: css(backdropDecls("highlight", undefined, {})) };

const browser = await chromium.launch();
const out = {};
for (const [name, style] of Object.entries(variants)) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.setContent(`<style>:root{--color-primary:#e8b4c8;--color-on-primary:#222}body{font:18px/1.4 Georgia;margin:0;padding:40px;width:600px}
h2{font-size:48px;line-height:1.1;margin:40px 0 24px}ul{list-style:none;margin:0;padding:0}li{margin:12px 0;font-size:20px}a{color:#111;text-decoration:none}p{margin:0}</style>
<h2 id=h style="${style}">Un titre assez long pour passer sur plusieurs lignes dans la colonne</h2><p id=after>après le titre</p>
<ul><li id=li1 style="${style}"><a href="#">Un lien de menu</a></li><li id=li2>suivant</li></ul>`);
  out[name] = await page.evaluate(() => {
    const g = (id) => {
      const e = document.getElementById(id);
      const r = e.getBoundingClientRect();
      const c = getComputedStyle(e);
      return { top: Math.round(r.top), h: Math.round(r.height), display: c.display, mt: c.marginTop, mb: c.marginBottom, deco: c.textDecorationLine, color: c.textDecorationColor, lines: Math.round(r.height / parseFloat(c.lineHeight)) };
    };
    return { h: g("h"), after: g("after"), li1: g("li1"), li2: g("li2") };
  });
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/surlignage-${name}.png`, clip: { x: 0, y: 0, width: 760, height: 420 } });
  await page.close();
}
await browser.close();
const [a, b] = [out.sans, out.surligne];
ok("titre multiligne : plusieurs lignes", b.h.lines >= 3, JSON.stringify(b.h));
ok("titre : display, marges et hauteur inchangés", b.h.display === a.h.display && b.h.mt === a.h.mt && b.h.mb === a.h.mb && b.h.h === a.h.h && b.h.top === a.h.top, JSON.stringify([a.h, b.h]));
ok("titre : le texte suivant ne bouge pas", b.after.top === a.after.top, `${a.after.top} -> ${b.after.top}`);
ok("élément de menu : display (list-item), marges et position inchangés", b.li1.display === a.li1.display && b.li1.mt === a.li1.mt && b.li1.top === a.li1.top && b.li1.h === a.li1.h && b.li2.top === a.li2.top, JSON.stringify([a.li1, b.li1]));
ok("le trait de surlignage existe (souligné, couleur principale)", b.h.deco.includes("underline") && b.h.color === "rgb(232, 180, 200)", JSON.stringify(b.h));
ok("sans fond : ni soulignement", a.h.deco === "none");
if (failures) {
  console.log(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log("\nTout passe");
