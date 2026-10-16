/**
 * Aides du lot 36 (lecteur vidéo) : deux VRAIES petites vidéos générées par ffmpeg et envoyées par la médiathèque, comme
 * l'artiste (conversion réelle par le serveur) : une vidéo « longue » avec son (16 s, 640 × 360) et une animation « courte »
 * sans son (3 s). Brouillons de page et de planche : voir lib/grille31d.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { q1, waitFor } from "./medias-setup.mjs";

const DIR = path.join(tmpdir(), "e2e-video36");
mkdirSync(DIR, { recursive: true });
export const LONG_NAME = "v36-longue.mp4";
export const SHORT_NAME = "v36-courte.mp4";
const ff = (args) => execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args]);

/** Vidéo de 16 s avec son : de quoi avancer et reculer de 10 s. */
export function makeLong() {
  const file = path.join(DIR, LONG_NAME);
  ff(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=330", "-t", "16", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
  return file;
}
/** Animation de 3 s sans son (une « boucle » pour le serveur). */
export function makeShort() {
  const file = path.join(DIR, SHORT_NAME);
  ff(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an", file]);
  return file;
}

const row = (name) => q1("select id, status from media where original_name = ? order by id desc", name);

/** Les deux vidéos sont dans la médiathèque et prêtes (idempotent) : { long, short } = identifiants. */
export async function ensureVideos(page, base) {
  for (const [name, make] of [
    [LONG_NAME, makeLong],
    [SHORT_NAME, makeShort],
  ]) {
    if (row(name)) continue;
    await page.goto(`${base}/admin/medias`, { waitUntil: "networkidle" });
    await page.locator("input[type=file]").first().setInputFiles(make());
    if (!(await waitFor(() => Boolean(row(name)), 60000))) throw new Error(`${name} : envoi non reçu`);
  }
  for (const name of [LONG_NAME, SHORT_NAME]) if (!(await waitFor(() => row(name)?.status === "ready", 240000))) throw new Error(`${name} : ${JSON.stringify(row(name))}`);
  return { long: row(LONG_NAME).id, short: row(SHORT_NAME).id };
}
