import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3000/fr", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);

const result = await page.evaluate(() => {
  const h1 = document.querySelector("h1");
  const body = document.body;
  const eyebrow = document.querySelector(".eyebrow");
  const faces = [...document.fonts].map((f) => `${f.family} [${f.status}]`);
  return {
    h1Text: h1 ? h1.textContent.trim().slice(0, 40) : null,
    h1Font: h1 ? getComputedStyle(h1).fontFamily : null,
    bodyFont: getComputedStyle(body).fontFamily,
    eyebrowFont: eyebrow ? getComputedStyle(eyebrow).fontFamily : null,
    varDisplay: getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim(),
    varPrimary: getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim(),
    faces,
  };
});

console.log(JSON.stringify(result, null, 2));

const uniq = [...new Set(result.faces)];
const need = ["Young Serif", "Figtree", "Spline Sans Mono"];
const loaded = need.filter((n) => uniq.some((f) => f.startsWith(n) && f.includes("loaded")));
console.log("\n--- VERDICT ---");
console.log("h1 contient Young Serif :", /Young Serif/.test(result.h1Font || ""));
console.log("body contient Figtree   :", /Figtree/.test(result.bodyFont || ""));
console.log("eyebrow contient Spline :", /Spline Sans Mono/.test(result.eyebrowFont || ""));
console.log("familles loaded         :", loaded.join(", ") || "AUCUNE");
await browser.close();
