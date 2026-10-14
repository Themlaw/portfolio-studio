/**
 * Aides e2e (v0.13, lot 23) : depuis la version 0.13, un projet n'apparaît plus tout
 * seul sur une page de collection — on y pose sa « Planche d'un projet ». Ces
 * aides le font comme l'artiste, par l'éditeur (brouillon puis « Publier », voir
 * page-draft.mjs), et l'enlèvent à la remise en état (sinon le projet ne se
 * supprime pas : il est cité).
 */
import path from "node:path";

import Database from "better-sqlite3";

import { publishBlocks } from "./page-draft.mjs";

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

export const pageIdOf = (slugFr) => q1("select id from pages where json_extract(slug, '$.fr') = ?", slugFr)?.id;
export const projectSlugOf = (projectId) => q1("select slug from projects where id = ?", projectId)?.slug;

/** Pose la planche du projet en fin de page (brouillon écrit, puis « Publier » dans l'éditeur). */
export async function placeBoard(page, base, pageId, slug) {
  if (boardCount(pageId, slug) === 1) return true;
  return publishBlocks(
    page,
    base,
    pageId,
    (blocks) => [...blocks, { uid: `pb${Date.now().toString(36)}`.slice(0, 32), type: "project-board", props: { project: slug } }],
    () => boardCount(pageId, slug) === 1,
  );
}

/** Retire la planche du projet de la page (remise en état). */
export async function removeBoard(page, base, pageId, slug) {
  if (!boardCount(pageId, slug)) return true;
  return publishBlocks(
    page,
    base,
    pageId,
    (blocks) => blocks.filter((b) => !(b.type === "project-board" && b.props?.project === slug)),
    () => boardCount(pageId, slug) === 0,
  );
}
