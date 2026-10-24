/**
 * Aides du lot 62 (cadres des photos et des vidéos) : un thème avec un VRAI cadre dessiné (kit de Studio redessiné, option A du
 * lot 58, importé puis mis en ligne comme l artiste), et le menu « Cadre » ouvert depuis la barre d une image.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { sleep, sql, waitFor } from "./grille31d.mjs";
import { gotoThemesPage } from "./theme-live.mjs";

const DIR = path.join(tmpdir(), "e2e-cadres62-kit");
mkdirSync(DIR, { recursive: true });

/** Met en ligne un thème Studio dont le cadre du kit est dessiné (cadre58a). Idempotent côté appelant : à n appeler qu une fois. `onDraft(id)` : retouche facultative de la copie brouillon avant la mise en ligne. */
export async function installKitFrameTheme(page, base, onDraft, cmd = "cadre58a") {
  const kitUrl = `${base}/admin/api/theme-kit/studio`;
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) {
    const res = await page.request.post(kitUrl, { headers: { origin: base } });
    ready = (await res.json()).ready === true;
    if (!ready) await sleep(2000);
  }
  if (!ready) throw new Error("export du kit non prêt");
  const kitZip = path.join(DIR, "kit-studio.zip");
  writeFileSync(kitZip, await (await page.request.get(kitUrl)).body());
  const edited = path.join(DIR, `retour-${cmd}.zip`);
  execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-multi.mts", cmd, kitZip, edited], { stdio: "inherit" });
  await page.goto(`${base}/admin/themes/studio/kit`, { waitUntil: "networkidle" });
  await page.setInputFiles("[data-testid=\"kit-file\"]", edited);
  await page.waitForURL(/\/kit\?import=/, { timeout: 180000 });
  await page.locator(".a-kit-card").nth(0).waitFor({ timeout: 240000 });
  await page.waitForLoadState("networkidle");
  // Lot 60 : le kit crée une version de Mon thème, qu on publie (« Publier cette version »).
  await Promise.all([page.waitForURL(/\/admin\/themes\?nouvelle=\d+&via=kit/, { timeout: 60000 }), page.getByRole("button", { name: /^Appliquer à mon thème/ }).click()]);
  const draftId = sql((db) => db.prepare("select id from themes where mine = 1").get())?.id;
  // Lot 64 : un thème d essai peut retoucher la copie brouillon (découpe du cadre) avant sa mise en ligne.
  if (onDraft) await onDraft(draftId);
  await gotoThemesPage(page, base);
  await page.getByTestId("mine-publish").click();
  await page.locator("dialog[open]").getByRole("button", { name: "Publier", exact: true }).click();
  await page.locator("dialog[open]").waitFor({ state: "detached" });
  await sleep(1500);
  return draftId;
}
export { waitFor };
