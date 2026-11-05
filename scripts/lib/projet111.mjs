/**
 * Aide e2e (lot 111) : depuis le lot 111 la création d'un projet ne demande plus de nom (slug aléatoire, titre « Projet sans titre »,
 * ajout d'images proposé aussitôt). Pour les suites qui retrouvent leur projet par son titre : crée par l'interface, ferme la proposition
 * d'ajout, puis donne le titre voulu (base, le slug ne change pas). Renvoie l'identifiant du projet.
 */
import path from "node:path";

import Database from "better-sqlite3";

const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");

export function retitleProject(id, title) {
  const db = new Database(DB);
  try {
    db.pragma("busy_timeout = 5000");
    db.prepare("update projects set title = ? where id = ?").run(JSON.stringify({ fr: title, en: title }), id);
  } finally {
    db.close();
  }
}

/** Clique « Nouveau projet » puis « Créer le projet » (page Pages, section Projets déjà affichée), referme l'ajout d'images proposé, titre le projet. */
export async function createProjectUi(page, title) {
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Créer le projet" }).click();
  await page.waitForURL(/\/admin\/projets\/\d+$/);
  const id = Number(page.url().split("/").pop());
  const proposed = await page.locator("dialog[open]").waitFor({ timeout: 8000 }).then(() => true, () => false);
  if (proposed) {
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  if (title) {
    retitleProject(id, title);
    await page.reload({ waitUntil: "networkidle" });
  }
  return id;
}

/**
 * Sur la toile de l'éditeur (lot 111) : « Nouveau projet » dans la liste d'une planche neuve crée un projet SANS nom. Les suites qui retrouvent
 * le projet par son titre le nomment ici (base : le slug ne change pas), puis la toile (iframe) est rechargée pour montrer ce titre.
 */
export async function createOnCanvas(f, title, input) {
  await input.click();
  await f.locator(".pe-combo-opt[data-kind=create]").click();
  const newest = () => {
    const db = new Database(DB, { readonly: true });
    try {
      return db.prepare("select id, slug from projects where draft_page_id is not null and json_extract(title, '$.fr') = 'Projet sans titre' order by id desc limit 1").get();
    } finally {
      db.close();
    }
  };
  const cited = (slug) => {
    const db = new Database(DB, { readonly: true });
    try {
      return Boolean(db.prepare("select 1 x from pages where draft like ?").get(`%"project":"${slug}"%`));
    } finally {
      db.close();
    }
  };
  let row = null;
  for (const end = Date.now() + 30000; Date.now() < end && !(row && cited(row.slug)); await new Promise((r) => setTimeout(r, 150))) row = newest() ?? row;
  if (!row) throw new Error("projet neuf introuvable");
  // La création propose tout de suite d'ajouter des images (fenêtre de la médiathèque, dans la page de l'éditeur) : on la ferme.
  const pg = f.page();
  if (await pg.locator("dialog[open]").waitFor({ timeout: 8000 }).then(() => true, () => false)) {
    await pg.keyboard.press("Escape");
    await pg.locator("dialog[open]").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  retitleProject(row.id, title);
  await f.evaluate(() => location.reload());
  return row;
}
