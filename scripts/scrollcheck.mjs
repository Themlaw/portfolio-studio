import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:3000/fr', { waitUntil: 'networkidle' });
// scroll progressif comme un vrai utilisateur
await p.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 400) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 60));
  }
});
await p.waitForTimeout(1200);
const sel = p.locator('section:has-text("Quelques tirages")').first();
await sel.scrollIntoViewIfNeeded();
await p.waitForTimeout(600);
await p.screenshot({ path: 'screenshots/masonry-scrolled.png', fullPage: false });
const broken = await p.evaluate(() =>
  [...document.querySelectorAll('img')].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src)
);
console.log('images non chargées:', JSON.stringify(broken));
await b.close();
