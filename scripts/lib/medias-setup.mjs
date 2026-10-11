/**
 * Aides du lot « médias » (captures, e2e) : connexion, vidéo de test posée
 * dans un bloc « Vidéo » de la page Personnages, CV (PDF) posé dans un bloc
 * « CV ». Tout passe par l'admin, comme l'artiste ; idempotent (relancer ne
 * duplique rien). Fichiers de test générés (ffmpeg, PDF écrit à la main).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
export const q1 = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).get(...args);
  } finally {
    db.close();
  }
};
export const waitFor = async (fn, timeout = 30000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await new Promise((r) => setTimeout(r, 400))) if (await fn()) return true;
  return false;
};
export const pageIdOf = (slugFr) => q1("select id from pages where json_extract(slug, '$.fr') = ?", slugFr)?.id;

const DIR = path.join(tmpdir(), "lot3-medias");
mkdirSync(DIR, { recursive: true });
export const VIDEO_NAME = "lot3-lecteur.mp4";
export const VIDEO_TITLE = "Lecteur lot 3";
export const CV_NAME = "lot3-cv.pdf";

export async function login(page, base) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
  await page.goto(`${base}/admin/connexion`, { waitUntil: "networkidle" });
  if (!page.url().includes("/connexion")) return;
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${base}/admin`);
}

/** Vidéo de 20 s avec son (mire + sinusoïde), 640 × 360. */
export function makeVideo() {
  const file = path.join(DIR, VIDEO_NAME);
  execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=330", "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
  return file;
}

/**
 * PDF minimal de `pages` pages A4 (texte en Helvetica, police standard non
 * embarquée) : de quoi vérifier l'aperçu sans dépendre d'un outil.
 */
export function makePdf(pages = 2, name = CV_NAME, extra = "") {
  const objs = [];
  const add = (s) => objs.push(s) && objs.length;
  const catalog = add("");
  const tree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  for (let p = 1; p <= pages; p++) {
    const text = `BT /F1 28 Tf 72 760 Td (Curriculum vitae - page ${p}) Tj ET BT /F1 14 Tf 72 720 Td (Illustration, animation, decors.) Tj ET 0.2 0.4 0.8 rg 72 600 300 60 re f`;
    const content = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R ${extra} >>`;
  objs[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages} >>`;
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const file = path.join(DIR, name);
  writeFileSync(file, Buffer.from(out, "latin1"));
  return file;
}

/** Ajoute un bloc en fin de page par le formulaire de la page, et l'ouvre. */
async function addBlock(page, base, pageId, label) {
  await page.goto(`${base}/admin/pages/${pageId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "+ Ajouter un bloc" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator("label.a-block-type", { hasText: label }).first().click();
  await dialog.getByRole("button", { name: "Ajouter ce bloc" }).click();
}

/** Choisit (ou envoie) un média dans le sélecteur ouvert par `button`. */
async function pickMedia(page, button, file, name, confirm) {
  await button.click();
  const dialog = page.locator("dialog[open]");
  const tile = dialog.locator(`button.a-media-tile[title="${name}"]`);
  if (!(await tile.count())) {
    await dialog.locator("input[type=file]").setInputFiles(file);
    await tile.first().waitFor({ timeout: 60000 });
  }
  await tile.first().click();
  await dialog.getByRole("button", { name: confirm }).click();
}

const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
const blockWith = (pageId, type, mediaId) =>
  q1("select count(*) n from blocks where page_id = ? and type = ? and json_extract(props, '$.mediaId') = ?", pageId, type, mediaId).n;

/** Bloc « Vidéo » (lecteur) en fin de page Personnages, avec la vidéo de test. */
export async function ensureVideoBlock(page, base) {
  const pageId = pageIdOf("personnages");
  const known = mediaOf(VIDEO_NAME);
  if (known && blockWith(pageId, "video-single", known.id)) return known.id;
  const file = makeVideo();
  await addBlock(page, base, pageId, "Vidéo");
  await pickMedia(page, page.getByRole("button", { name: "Choisir une vidéo" }).last(), file, VIDEO_NAME, "Utiliser cette vidéo");
  await page.getByLabel("Titre", { exact: true }).last().fill(VIDEO_TITLE);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const id = await waitFor(() => mediaOf(VIDEO_NAME)?.id && blockWith(pageId, "video-single", mediaOf(VIDEO_NAME).id));
  if (!id) throw new Error("bloc Vidéo non enregistré");
  if (!(await waitFor(() => mediaOf(VIDEO_NAME)?.status === "ready", 240000))) throw new Error("vidéo non convertie");
  return mediaOf(VIDEO_NAME).id;
}

/** Bloc « CV » en fin de page Personnages, avec le PDF de test. */
export async function ensureCvBlock(page, base) {
  const pageId = pageIdOf("personnages");
  const known = mediaOf(CV_NAME);
  if (known && blockWith(pageId, "cv", known.id)) {
    // Média en échec (ou marqué tel pour un nouveau rendu) : même fichier renvoyé, même ligne retraitée.
    if (known.status === "failed") {
      const res = await page.request.post(`${base}/admin/api/upload`, { headers: { origin: base }, multipart: { file: { name: CV_NAME, mimeType: "application/pdf", buffer: readFileSync(makePdf(2)) } } });
      if (!res.ok()) throw new Error(`nouveau rendu du CV refusé : ${res.status()}`);
      if (!(await waitFor(() => mediaOf(CV_NAME)?.status === "ready", 120000))) throw new Error("PDF non traité");
    }
    return known.id;
  }
  const file = makePdf(2);
  await addBlock(page, base, pageId, "CV");
  await pickMedia(page, page.getByRole("button", { name: "Choisir un PDF" }).last(), file, CV_NAME, "Utiliser ce PDF");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  if (!(await waitFor(() => mediaOf(CV_NAME)?.id && blockWith(pageId, "cv", mediaOf(CV_NAME).id)))) throw new Error("bloc CV non enregistré");
  if (!(await waitFor(() => mediaOf(CV_NAME)?.status === "ready", 120000))) throw new Error("PDF non traité");
  return mediaOf(CV_NAME).id;
}

export const STRIP_TITLE = "Bande lot 3";

/** Images de test (mire ffmpeg, tailles et teintes variées : portrait, paysage, carré). */
export function makeImages(n = 8) {
  const sizes = ["900x1200", "1600x900", "1100x1100", "800x1200", "1500x1000", "1000x1300", "1700x950", "1200x1200"];
  return Array.from({ length: n }, (_, i) => {
    const file = path.join(DIR, `lot3-bande-${i + 1}.jpg`);
    execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=${sizes[i % sizes.length]}:rate=1`, "-vf", `hue=h=${i * 40}`, "-frames:v", "1", "-q:v", "4", file]);
    return file;
  });
}

/** Projet « Bande lot 3 » (8 images) posé sur la page Personnages : une bande qui déborde nettement. */
export async function ensureLongStrip(page, base) {
  const pageId = pageIdOf("personnages");
  const proj = q1("select id, slug from projects where json_extract(title, '$.fr') = ?", STRIP_TITLE);
  const placed = proj && q1("select count(*) n from blocks where page_id = ? and type = 'project-board' and json_extract(props, '$.project') = ?", pageId, proj.slug).n;
  if (proj && placed) return proj.slug;
  let id = proj?.id;
  if (!id) {
    await page.goto(`${base}/admin/projets`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Nouveau projet" }).click();
    await page.locator("dialog[open]").getByLabel("Titre en français").fill(STRIP_TITLE);
    await page.locator("dialog[open]").getByRole("button", { name: "Créer le projet" }).click();
    await page.waitForURL(/\/admin\/projets\/\d+$/);
    id = Number(page.url().split("/").pop());
    await page.locator(".a-strip-end input[type=file]").setInputFiles(makeImages(8));
    await page.waitForFunction(() => document.querySelectorAll(".a-strip .a-slot").length === 8 && !document.querySelector('.a-strip .a-slot[data-status="processing"]'), null, { timeout: 240000 });
  }
  const slug = q1("select slug from projects where id = ?", id).slug;
  const { placeBoard } = await import("./page-board.mjs");
  if (!(await placeBoard(page, base, pageId, slug))) throw new Error("planche non posée");
  return slug;
}
