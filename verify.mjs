import { chromium } from "playwright";

const PORT = process.env.PORT ?? "3001";
const BASE = `http://localhost:${PORT}`;

// THEME=<preset> : rejoue la régression sous ce thème (cookie d'aperçu, dev uniquement).
const THEME = process.env.THEME;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
if (THEME) {
  // Aperçu = draft mode + cookie d'id, posés par la route (dev uniquement).
  await (await context.newPage()).goto(`${BASE}/api/theme-preview?id=${THEME}&redirect=/fr&banner=0`);
  console.log(`Thème : ${THEME}`);
}
const page = await context.newPage();
const fail = [];
const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!pass) fail.push(label);
};

/* ---- (a) barre présente si débord, absente si tout tient --------------- */
await page.goto(`${BASE}/fr/decors`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const strips = await page.evaluate(() => {
  return [...document.querySelectorAll("section[aria-labelledby^='project-']")].map(
    (section) => {
      const rail = section.querySelector(".strip-rail");
      const bar = section.querySelector("[role='scrollbar']");
      return {
        title: section.querySelector("h1,h2,h3")?.textContent?.trim(),
        overflows: rail ? rail.scrollWidth - rail.clientWidth > 8 : false,
        hasBar: Boolean(bar),
        valueNow: bar?.getAttribute("aria-valuenow"),
        controls: bar?.getAttribute("aria-controls"),
        railId: rail?.id,
      };
    },
  );
});
console.log(JSON.stringify(strips, null, 2));

const withOverflow = strips.filter((s) => s.overflows);
const withoutOverflow = strips.filter((s) => !s.overflows);
ok(
  "(a1) barre presente sous chaque bande qui deborde",
  withOverflow.length > 0 && withOverflow.every((s) => s.hasBar),
  `${withOverflow.length} bande(s) en debord`,
);
ok(
  "(a2) pas de barre sous une bande qui tient",
  withoutOverflow.length > 0 && withoutOverflow.every((s) => !s.hasBar),
  `${withoutOverflow.length} bande(s) sans debord`,
);
ok(
  "(a3) aria-controls pointe le rail",
  withOverflow.every((s) => s.controls && s.controls === s.railId),
);

/* ---- (d) l'anneau de focus des oeuvres tient dans le rail -------------- */
// Le rail defile en x, donc rogne aussi en y : il faut >= 5px (outline 2px +
// offset 3px) entre chaque oeuvre et les bords haut/bas du rail.
const ringRoom = await page.evaluate(() => {
  let worst = Infinity;
  for (const rail of document.querySelectorAll(".strip-rail")) {
    const r = rail.getBoundingClientRect();
    for (const f of rail.querySelectorAll(".strip-frame")) {
      const b = f.getBoundingClientRect();
      worst = Math.min(worst, b.top - r.top, r.bottom - b.bottom);
    }
  }
  return Math.round(worst * 10) / 10;
});
ok("(d) anneau de focus non rogne (>= 5px)", ringRoom >= 5, `marge mini ${ringRoom}px`);

/* ---- (b) le drag de la barre decale le rail ---------------------------- */
const target = await page.evaluate(() => {
  const sections = [...document.querySelectorAll("section[aria-labelledby^='project-']")];
  const hit = sections.find((s) => s.querySelector("[role='scrollbar']"));
  return hit ? hit.getAttribute("aria-labelledby") : null;
});

const bar = page.locator(`section[aria-labelledby='${target}'] [role='scrollbar']`);
const rail = page.locator(`section[aria-labelledby='${target}'] .strip-rail`);

// La barre doit être dans le viewport : page.mouse travaille en coordonnées
// viewport alors que boundingBox() rend des coordonnées page.
await bar.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);

const before = await rail.evaluate((el) => el.scrollLeft);
const valueBefore = await bar.getAttribute("aria-valuenow");
const box = await bar.boundingBox();

await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);

const after = await rail.evaluate((el) => el.scrollLeft);
const valueAfter = await bar.getAttribute("aria-valuenow");
ok(
  "(b) le drag de la barre decale le rail",
  after > before + 20,
  `scrollLeft ${before} -> ${after}, aria-valuenow ${valueBefore} -> ${valueAfter}`,
);

// Clic sur la piste : saut a la position visee (retour vers le debut).
await page.mouse.click(box.x + box.width * 0.05, box.y + box.height / 2);
await page.waitForTimeout(400);
const afterClick = await rail.evaluate((el) => el.scrollLeft);
ok("(b2) clic sur la piste = saut", afterClick < after - 20, `-> ${afterClick}`);

/* ---- (c) lightbox : clic vignette change l'image principale ------------ */
await page.locator(`section[aria-labelledby='${target}'] .strip-frame`).first().click();
await page.waitForTimeout(700);

// Scopé à notre lightbox : en dev, l'overlay d'erreur Next.js est aussi un dialog.
const dialog = page.locator("div[role='dialog'][aria-modal='true'].fixed");
ok("(c1) lightbox ouverte", await dialog.isVisible());

const firstTitle = await dialog.locator("h2").textContent();
const thumbs = dialog.locator(".lb-thumb");
const thumbCount = await thumbs.count();
const firstCurrent = await thumbs.first().getAttribute("aria-current");

// On vise la dernière vignette : toujours différente de l'active au départ.
const last = thumbCount - 1;
await thumbs.nth(last).click();
await page.waitForTimeout(600);
const secondTitle = await dialog.locator("h2").textContent();
const nowCurrent = await thumbs.nth(last).getAttribute("aria-current");
const oldCurrent = await thumbs.first().getAttribute("aria-current");

ok(
  "(c2) clic sur une vignette change l'image principale",
  firstTitle !== secondTitle,
  `"${firstTitle?.trim()}" -> "${secondTitle?.trim()}"`,
);
ok(
  "(c3) aria-current suit la vignette active",
  firstCurrent === "true" && nowCurrent === "true" && oldCurrent === "false",
  `${thumbCount} vignettes`,
);

/* ---- (e) selecteur de langue : slug localise de la meme page ----------- */
await page.keyboard.press("Escape");
await page.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
await page.locator("header a[hreflang='en']").first().click();
await page.waitForURL("**/en/characters", { timeout: 10000 }).catch(() => {});
ok("(e1) FR → EN : /fr/personnages mene a /en/characters", page.url().endsWith("/en/characters"), page.url());
await page.locator("header a[hreflang='fr']").first().click();
await page.waitForURL("**/fr/personnages", { timeout: 10000 }).catch(() => {});
ok("(e2) EN → FR : retour sur /fr/personnages", page.url().endsWith("/fr/personnages"), page.url());

/* ---- (f) slug inconnu : 404 --------------------------------------------- */
const missing = await page.goto(`${BASE}/fr/cette-page-n-existe-pas`);
ok("(f) slug inconnu → 404", missing?.status() === 404, String(missing?.status()));

console.log(fail.length === 0 ? "\nTOUT PASSE" : `\nECHECS: ${fail.join(", ")}`);
await browser.close();
process.exit(fail.length === 0 ? 0 : 1);
