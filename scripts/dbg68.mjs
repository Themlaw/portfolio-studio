import { chromium } from "playwright";
import { login, openEditor, pageIdOf, sleep } from "./lib/grille31d.mjs";
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await login(page, process.env.BASE);
const f = await openEditor(page, process.env.BASE, pageIdOf("personnages"));
await sleep(1500);
await page.getByRole("button", { name: "Aperçu", exact: true }).click();
await f.waitForFunction(() => !document.documentElement.hasAttribute("data-edit-canvas"), null, { timeout: 30000 });
await sleep(1500);
const n = await f.locator("[data-viewer-item]").count();
console.log("items", n);
if (n) { await f.locator("[data-viewer-item]").first().scrollIntoViewIfNeeded(); await f.locator("[data-viewer-item]").first().click(); await sleep(1500); console.log("lightbox", await f.locator(".lightbox").count(), await f.locator(".lightbox img").first().evaluate((e) => e.currentSrc)); }
await b.close();
