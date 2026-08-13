import { chromium } from "playwright";

const PORT = process.env.PORT ?? "3000";
const BASE = `http://localhost:${PORT}`;

const pages = [
  ["home-fr", "/fr"],
  ["personnages", "/fr/personnages"],
  ["decors", "/fr/decors"],
  ["animation", "/fr/animation"],
  ["a-propos", "/fr/a-propos"],
  ["home-en", "/en"],
];

/** Scroll progressif : sans ça les images lazy restent blanches en fullPage. */
async function settle(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.75);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 220));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images]
        .filter((img) => !img.complete)
        .map((img) => new Promise((r) => {
          img.addEventListener("load", r, { once: true });
          img.addEventListener("error", r, { once: true });
        })),
    );
  });
  await page.waitForTimeout(500);
}

const browser = await chromium.launch();

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
for (const [name, path] of pages) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await settle(page);
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  console.log("ok", name);
}
await ctx.close();

const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await mob.newPage();
await mp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
await settle(mp);
await mp.screenshot({ path: "screenshots/home-mobile.png", fullPage: true });
console.log("ok mobile");

await browser.close();
