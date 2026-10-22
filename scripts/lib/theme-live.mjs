/**
 * Mise en ligne d'un thème PAR L'INTERFACE (lot 60). Les modèles et les anciens thèmes ne se mettent plus en ligne tels quels : on en fait
 * « Mon thème » (« Utiliser ce modèle », ou « En faire mon thème (nouvelle version) » pour un ancien thème), puis on publie Mon thème.
 * `which` : le nom affiché d'une carte (ex. « Galerie lumineuse », « Studio (copie) »), ou l'identifiant du thème.
 * Après l'appel, le site public montre ce thème (via Mon thème) ; `settings.activeThemeId` désigne alors Mon thème.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function activateThemeUi(page, BASE, which) {
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  const byId = /^[a-z0-9-]+$/.test(which);
  const card = byId
    ? page.locator(`.a-theme-card[aria-labelledby="theme-${which}"]`).first()
    : page.locator(".a-theme-card", { has: page.locator("h2", { hasText: new RegExp(`^${escapeRe(which)}$`) }) }).first();
  await card.waitFor({ state: "attached", timeout: 30000 });
  const dialog = page.locator("dialog[open]");
  if ((await card.getAttribute("data-model")) !== null) {
    await card.getByTestId("use-model").click();
    if (await dialog.waitFor({ timeout: 2500 }).then(() => true, () => false)) await dialog.getByRole("button", { name: "Remplacer", exact: true }).click();
    await page.getByTestId("mine-card").waitFor({ timeout: 60000 });
    await sleep(1500);
  } else if ((await card.getAttribute("data-old")) !== null) {
    if (!(await card.isVisible())) await page.locator('[data-testid="olds-section"] summary').click();
    await card.getByTestId("old-adopt").click();
    await page.waitForURL(/nouvelle=\d+&via=adopt/, { timeout: 60000 });
  }
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  const publish = page.getByTestId("mine-publish");
  if (await publish.count()) {
    await publish.click();
    await dialog.getByRole("button", { name: "Publier", exact: true }).click();
    await dialog.waitFor({ state: "detached", timeout: 30000 });
  }
  await sleep(800);
}
