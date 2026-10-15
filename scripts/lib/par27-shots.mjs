// Captures pleine page des pages publiques (parité visuelle) : node par27-shots.mjs <port> <dossier>
import { chromium } from "playwright";
const [port, out] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--disable-gpu"] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" })).newPage();
for (const u of ["/fr/parite", "/fr/a-propos", "/fr"]) {
  await p.goto(`http://localhost:${port}${u}`, { waitUntil: "networkidle" });
  await p.addStyleTag({ content: "*{animation:none!important;transition:none!important}" });
  await new Promise((r) => setTimeout(r, 800));
  await p.screenshot({ path: `${out}/${u.replace(/\//g, "_")}.png`, fullPage: true });
}
await b.close();
