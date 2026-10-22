import { chromium } from "playwright";
import { login } from "./lib/medias-setup.mjs";
const BASE = process.env.BASE;
const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("console", (m) => console.log("console", m.type(), m.text().slice(0, 200)));
page.on("response", (r) => { if (r.url().includes("vignette")) console.log("resp", r.status(), r.url(), r.headers()["cache-control"]); });
await login(page, BASE);
await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
await page.waitForTimeout(8000);
const frames = page.frames();
for (const f of frames) { console.log("frame", f.url()); if (f.url().includes("vignette")) { console.log(await f.evaluate(() => document.documentElement.outerHTML.slice(0, 600))); console.log(await f.evaluate(() => [...document.documentElement.attributes].map(a=>a.name+"="+a.value).join(" "))); console.log(await f.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--t-color-bg"))); } }
await page.screenshot({ path: process.env.SHOTS + "/dbg-themes.png", fullPage: true });
await browser.close();
