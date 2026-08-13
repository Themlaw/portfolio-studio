import { chromium } from "playwright";

const BASE = `http://localhost:${process.env.PORT ?? "3000"}`;

async function settle(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.75);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 220));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });
  await page.waitForTimeout(500);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

/* 1. Accueil pleine page */
await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
await settle(page);
await page.screenshot({ path: "screenshots/home-fr.png", fullPage: true });
console.log("ok home-fr");

/* 2. Plan serré d'une bande avec sa barre de glissement */
await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
await settle(page);
const strip = page
  .locator("section[aria-labelledby^='project-']")
  .filter({ has: page.locator("[role='scrollbar']") })
  .first();
await strip.scrollIntoViewIfNeeded();
await page.waitForTimeout(700);
await strip.screenshot({ path: "screenshots/bande-barre.png" });
console.log("ok bande-barre");

/* 3. Lightbox ouverte, rangée de vignettes visible */
await strip.locator(".strip-frame").first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: "screenshots/lightbox-vignettes.png" });
console.log("ok lightbox-vignettes");

await browser.close();
