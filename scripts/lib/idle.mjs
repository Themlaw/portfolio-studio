/**
 * Navigation « prête » sans dépendre du silence réseau (lot 104). `waitUntil: "networkidle"` n'est jamais atteint sur les
 * pages qui interrogent le serveur en boucle (éditeur de thème, vignettes) : sous charge il expirait (180 s) et faisait
 * échouer des suites entières. Ici : « load » (scripts exécutés), puis l'attente du silence réseau BORNÉE (8 s) pour laisser
 * l'hydratation finir sur une page calme. Rien n'est vérifié par cette attente : les assertions suivantes restent entières.
 */
export const idle = (page, ms = 8000) => page.waitForLoadState("networkidle", { timeout: ms }).catch(() => {});
export async function gotoIdle(page, url, opts = {}) {
  const r = await page.goto(url, { waitUntil: "load", ...opts });
  await idle(page);
  return r;
}
export async function reloadIdle(page, opts = {}) {
  const r = await page.reload({ waitUntil: "load", ...opts });
  await idle(page);
  return r;
}
