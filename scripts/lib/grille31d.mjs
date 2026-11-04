/**
 * Aides du lot 31d (grille unifiée) : images de test, brouillon de la page (grilles), brouillon de la planche d'un projet,
 * ouverture de l'éditeur. Tout passe par la base et l'admin, comme les autres suites.
 */
import path from "node:path";

import Database from "better-sqlite3";

import { paint } from "./crop-fixtures.mjs";
import { login, pageIdOf, q1, waitFor } from "./medias-setup.mjs";

export { login, pageIdOf, q1, waitFor };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
export const sql = (fn) => {
  const db = new Database(DB);
  db.pragma("busy_timeout = 5000");
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

/** Images de test : portrait, paysage, panorama, carré (envoyées une fois, par l'admin). */
export async function makeMedia(page, base) {
  const specs = [
    ["31d-portrait.png", 1000, 1500, 1],
    ["31d-paysage.png", 1500, 1000, 2],
    ["31d-panorama.png", 2400, 800, 3],
    ["31d-carre.png", 1200, 1200, 4],
    ["31d-paysage2.png", 1500, 1000, 5],
  ];
  const ids = {};
  for (const [name, w, h, seed] of specs) {
    const row = () => q1("select id, status from media where original_name = ? order by id desc", name);
    if (!row()) {
      const buffer = await paint(w, h, seed);
      const res = await page.request.post(`${base}/admin/api/upload`, { headers: { origin: base }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 });
      if (res.status() >= 300) throw new Error(`envoi de ${name} : ${res.status()}`);
    }
    if (!(await waitFor(() => row()?.status === "ready", 180000))) throw new Error(`${name} : ${JSON.stringify(row())}`);
    ids[name.replace(/^31d-|\.png$/g, "")] = row().id;
  }
  return ids;
}

export const img = (uid, mediaId, props = {}) => ({ uid, type: "image", props: { mediaId, width: "wide", ...props } });
export const grid = (uid, props = {}, children = []) => ({ uid, type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", ...props, children } });

/** Écrit le brouillon d'une page (blocs) ; `draft_rev` + 1. */
export function setDraft(pageId, blocks) {
  sql((db) => {
    const row = db.prepare("select title, slug, meta, nav_order from pages where id = ?").get(pageId);
    const draft = {
      title: JSON.parse(row.title),
      slug: JSON.parse(row.slug),
      meta: row.meta ? JSON.parse(row.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } },
      published: true,
      inMenu: row.nav_order !== null,
      accent: null,
      blocks,
    };
    db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), pageId);
  });
}
export const draftBlocks = (pageId) => JSON.parse(sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft).blocks;
export const findIn = (list, uid) => {
  for (const b of list) {
    if (b.uid === uid) return b;
    const inner = findIn(b.props?.children ?? [], uid);
    if (inner) return inner;
  }
  return null;
};

/** Suite de composants du brouillon d'un projet, tenue par la page `pageId`. */
export function setBoardDraft(projectId, pageId, layout) {
  sql((db) => {
    // Lot 111 : on simule des données antérieures (brouillon de projet tenu par la page) : une copie propre déjà portée par un bloc de cette
    // page pour ce projet (brouillon ou publiée) l'emporterait au rendu ; on la retire.
    const slug = db.prepare("select slug from projects where id = ?").get(projectId)?.slug;
    const strip = (node) => {
      if (Array.isArray(node)) node.forEach(strip);
      else if (node && typeof node === "object") {
        if (node.type === "project-board" && node.props?.project === slug) delete node.props.layout;
        Object.values(node).forEach((v) => typeof v === "object" && strip(v));
      }
    };
    const d = db.prepare("select draft from pages where id = ?").get(pageId)?.draft;
    if (d) {
      const j = JSON.parse(d);
      strip(j.blocks);
      db.prepare("update pages set draft = ? where id = ?").run(JSON.stringify(j), pageId);
    }
    for (const b of db.prepare("select id, props from blocks where page_id = ? and type = 'project-board'").all(pageId)) {
      const props = JSON.parse(b.props);
      if (props.project === slug && props.layout !== undefined) {
        delete props.layout;
        db.prepare("update blocks set props = ? where id = ?").run(JSON.stringify(props), b.id);
      }
    }
    db.prepare("update projects set draft_layout = ?, draft_layout_page_id = ? where id = ?").run(JSON.stringify(layout), pageId, projectId);
  });
}
/**
 * Lot 111 : le contenu d'une planche est la copie propre du bloc Projet de la page (`props.layout`), plus une surcouche du projet.
 * `boardDraft` : suite du brouillon (surcouche tenue héritée, sinon copie propre d'un bloc du brouillon d'une page) ; `boardPublished` : copie
 * propre du bloc publié, sinon la suite du projet.
 */
const findOwn = (node, slug) => {
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = findOwn(x, slug);
      if (r) return r;
    }
    return null;
  }
  if (node && typeof node === "object") {
    if (node.type === "project-board" && node.props?.project === slug && Array.isArray(node.props.layout)) return node.props.layout;
    for (const v of Object.values(node)) {
      const r = typeof v === "object" ? findOwn(v, slug) : null;
      if (r) return r;
    }
  }
  return null;
};
export const boardDraft = (projectId) => {
  const row = sql((db) => db.prepare("select slug, draft_layout from projects where id = ?").get(projectId));
  if (row?.draft_layout) return JSON.parse(row.draft_layout);
  if (!row) return null;
  for (const { draft } of sql((db) => db.prepare("select draft from pages where draft is not null").all())) {
    const own = findOwn(JSON.parse(draft).blocks, row.slug);
    if (own) return own;
  }
  return null;
};
export const boardPublished = (projectId) => {
  const row = sql((db) => db.prepare("select slug, layout from projects where id = ?").get(projectId));
  if (!row) return null;
  const own = sql((db) => db.prepare("select props from blocks where json_extract(props, '$.project') = ? and json_extract(props, '$.layout') is not null order by id desc limit 1").get(row.slug));
  if (own) return JSON.parse(own.props).layout;
  return row.layout ? JSON.parse(row.layout) : null;
};

export async function canvas(page) {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
export async function openEditor(page, base, pageId) {
  await page.goto(`${base}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const fr = await canvas(page);
  await sleep(2000);
  return fr;
}
export async function settled(page) {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(700);
}

/** Lot 111 : retire la copie propre (`props.layout`) que des blocs Projet portent pour ce projet, dans tous les brouillons et blocs publiés (remise à zéro de données). */
export function clearOwnLayouts(projectId) {
  sql((db) => {
    const slug = db.prepare("select slug from projects where id = ?").get(projectId)?.slug;
    const strip = (node) => {
      if (Array.isArray(node)) node.forEach(strip);
      else if (node && typeof node === "object") {
        if (node.type === "project-board" && node.props?.project === slug) delete node.props.layout;
        Object.values(node).forEach((v) => typeof v === "object" && strip(v));
      }
    };
    for (const { id, draft } of db.prepare("select id, draft from pages where draft is not null").all()) {
      const j = JSON.parse(draft);
      strip(j.blocks);
      db.prepare("update pages set draft = ? where id = ?").run(JSON.stringify(j), id);
    }
    for (const b of db.prepare("select id, props from blocks where type = 'project-board'").all()) {
      const props = JSON.parse(b.props);
      if (props.project === slug && props.layout !== undefined) {
        delete props.layout;
        db.prepare("update blocks set props = ? where id = ?").run(JSON.stringify(props), b.id);
      }
    }
  });
}
