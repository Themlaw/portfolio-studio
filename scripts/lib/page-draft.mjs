/**
 * Aide e2e (lot 23) : le formulaire d'une page ne porte plus la liste des blocs (le contenu se compose dans
 * l'éditeur visuel). Pour poser ou retirer un bloc comme le ferait l'artiste, ces aides écrivent le BROUILLON
 * de la page (la même ligne que l'éditeur, `pages.draft`) puis ouvrent l'éditeur et cliquent « Publier » :
 * la publication (validation complète, revalidation du cache, surcouches) est celle du produit.
 */
import path from "node:path";

import Database from "better-sqlite3";

const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");

/** État d'une page tel que l'éditeur le reprend : son brouillon, sinon la version publiée. */
function currentDraft(db, pageId) {
  const row = db.prepare("select title, slug, meta, published, nav_order, theme_overrides, draft from pages where id = ?").get(pageId);
  if (!row) throw new Error(`page ${pageId} introuvable`);
  if (row.draft) return JSON.parse(row.draft);
  const L = { fr: "", en: "" };
  const meta = row.meta ? JSON.parse(row.meta) : { title: L, description: L };
  const overrides = row.theme_overrides ? JSON.parse(row.theme_overrides) : null;
  const blocks = db.prepare("select type, props from blocks where page_id = ? order by position").all(pageId);
  return {
    title: JSON.parse(row.title),
    slug: JSON.parse(row.slug),
    meta: { title: meta.title ?? L, description: meta.description ?? L },
    published: Boolean(row.published),
    inMenu: row.nav_order !== null,
    accent: typeof overrides?.primary === "string" ? overrides.primary : null,
    blocks: blocks.map((b, i) => ({ uid: `b${i}`, type: b.type, props: JSON.parse(b.props) })),
  };
}

/**
 * Applique `mutate(blocks)` au contenu de la page (brouillon écrit en base), puis publie par l'éditeur.
 * `done()` : condition (lecture de la base) attendue après « Publier ».
 */
export async function publishBlocks(page, base, pageId, mutate, done, timeout = 60000) {
  const db = new Database(DB);
  try {
    db.pragma("busy_timeout = 5000");
    const draft = currentDraft(db, pageId);
    draft.blocks = mutate(draft.blocks);
    db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), pageId);
  } finally {
    db.close();
  }
  await page.goto(`${base}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const publish = page.getByRole("button", { name: "Publier", exact: true });
  await publish.waitFor({ timeout });
  await publish.click();
  // Page jamais mise en ligne (lot 51) : « Publier » demande d'abord « Mettre cette page en ligne ? ».
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 4000 }).then(() => true, () => false)) await confirm.click();
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (done()) {
      // La publication a rendu la main (brouillon vidé) : on attend la fin du rafraîchissement.
      await page.waitForTimeout(800);
      return true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
