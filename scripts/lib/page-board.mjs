/**
 * Aides e2e (v0.13) : depuis la version 0.13, un projet n'apparaît plus tout
 * seul sur une page de collection — on y pose sa « Planche d'un projet ». Ces
 * aides le font comme l'artiste, par le formulaire de la page, et l'enlèvent
 * à la remise en état (sinon le projet ne se supprime pas : il est cité).
 */
import path from "node:path";

import Database from "better-sqlite3";

const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
const q1 = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).get(...args);
  } finally {
    db.close();
  }
};
const boardCount = (pageId, slug) =>
  q1("select count(*) n from blocks where page_id = ? and type = 'project-board' and json_extract(props, '$.project') = ?", pageId, slug).n;
const waitFor = async (fn, timeout = 30000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await new Promise((r) => setTimeout(r, 300))) if (fn()) return true;
  return false;
};

/**
 * Fin de l'enregistrement (réponse de l'action et rafraîchissement du routeur) avant
 * toute navigation : sur une machine rapide, la base est écrite avant, et Firefox
 * abandonne alors le `goto` suivant (NS_BINDING_ABORTED).
 */
async function settled(page) {
  await page.locator('.a-savebar[data-dirty="false"]').first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle");
}

export const pageIdOf = (slugFr) => q1("select id from pages where json_extract(slug, '$.fr') = ?", slugFr)?.id;
export const projectSlugOf = (projectId) => q1("select slug from projects where id = ?", projectId)?.slug;

/** Pose la planche du projet en fin de page (formulaire de la page, « Enregistrer » publie). */
export async function placeBoard(page, base, pageId, slug) {
  await page.goto(`${base}/admin/pages/${pageId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "+ Ajouter un bloc" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator("label.a-block-type", { hasText: "Planche d'un projet" }).click();
  await dialog.getByRole("button", { name: "Ajouter ce bloc" }).click();
  await page.locator('select[id$="-projet"]').last().selectOption(slug);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const done = await waitFor(() => boardCount(pageId, slug) === 1);
  await settled(page);
  return done;
}

/** Retire la planche du projet de la page (remise en état). */
export async function removeBoard(page, base, pageId, slug) {
  if (!boardCount(pageId, slug)) return true;
  await page.goto(`${base}/admin/pages/${pageId}`, { waitUntil: "networkidle" });
  const card = page.locator("article.a-block", { hasText: `Projet · ${slug}` }).first();
  await card.getByRole("button", { name: /Supprimer le bloc/ }).click();
  await page.locator("dialog[open]").getByRole("button", { name: /Supprimer/ }).click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const done = await waitFor(() => boardCount(pageId, slug) === 0);
  await settled(page);
  return done;
}
