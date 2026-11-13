/**
 * Lot 132 — réception d'un envoi d'animation (multipart, busboy) : toutes les parties fichier, en mémoire mais BORNÉES (corps total
 * `limit`, 48 fichiers, 40 Mo chacun), avec les mêmes délais que l'envoi d'une image (inactivité, durée totale). Les noms de fichier ne
 * servent qu'à ordonner les images : jamais comme chemin.
 */
import busboy from "busboy";
import { Readable } from "node:stream";

import { cleanFilename } from "@/lib/upload/sniff";
import { UploadError } from "@/lib/upload/receive";

import { framesFromZip, sortByName, splitSheet } from "./assemble";
import { ANIM_MAX_FRAMES, AnimError } from "./sheet";

const idleMs = () => Math.max(1, Number(process.env.UPLOAD_IDLE_TIMEOUT_S || 30)) * 1000;
const maxMs = () => Math.max(1, Number(process.env.UPLOAD_MAX_DURATION_S || 600)) * 1000;
const PER_FILE = 40 * 1024 * 1024;

type Part = { name: string; data: Buffer };

async function readParts(request: Request, limit: number): Promise<{ files: Part[]; fields: Record<string, string> }> {
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data;/i.test(contentType) || !request.body) throw new UploadError(400, "Requête invalide : envoie les images par le formulaire d'envoi.");
  const source = Readable.fromWeb(request.body as import("node:stream/web").ReadableStream);
  let idle: NodeJS.Timeout | undefined;
  let deadline: NodeJS.Timeout | undefined;
  try {
    return await new Promise((resolve, reject) => {
      const files: Part[] = [];
      const fields: Record<string, string> = {};
      let total = 0;
      let done = false;
      const fail = (e: Error) => {
        if (done) return;
        done = true;
        source.unpipe();
        source.destroy();
        reject(e);
      };
      const arm = () => {
        clearTimeout(idle);
        idle = setTimeout(() => fail(new UploadError(408, "L'envoi s'est interrompu (plus rien reçu depuis un moment). Vérifie ta connexion et réessaie.")), idleMs());
      };
      arm();
      source.on("data", arm);
      deadline = setTimeout(() => fail(new UploadError(408, "L'envoi prend trop de temps : vérifie ta connexion, ou réduis les images, puis réessaie.")), maxMs());
      const bb = busboy({ headers: { "content-type": contentType }, defParamCharset: "utf8", limits: { files: ANIM_MAX_FRAMES + 1, fileSize: PER_FILE, fields: 8, fieldSize: 4096, parts: ANIM_MAX_FRAMES + 10, headerPairs: 50 } });
      bb.on("field", (n, v) => {
        if (["tags", "name", "cols", "rows", "count"].includes(n)) fields[n] = v;
      });
      bb.on("file", (_n, file, info) => {
        const chunks: Buffer[] = [];
        file.on("data", (c: Buffer) => {
          total += c.length;
          if (total > limit) return fail(new UploadError(413, `Cet envoi est trop lourd : ${Math.round(limit / 1024 ** 2)} Mo au plus pour une animation.`));
          chunks.push(c);
        });
        file.on("limit", () => fail(new UploadError(413, "Une image dépasse 40 Mo : réduis-la avant de l'envoyer.")));
        file.on("error", fail);
        file.on("end", () => {
          if (!done && chunks.length) files.push({ name: cleanFilename(info.filename), data: Buffer.concat(chunks) });
        });
      });
      bb.on("filesLimit", () => fail(new UploadError(422, `${ANIM_MAX_FRAMES} images au plus par animation.`)));
      bb.on("partsLimit", () => fail(new UploadError(400, "Requête invalide.")));
      bb.on("fieldsLimit", () => fail(new UploadError(400, "Requête invalide.")));
      bb.on("error", () => fail(new UploadError(400, "Envoi interrompu ou illisible : réessaie.")));
      bb.on("close", () => {
        if (done) return;
        done = true;
        resolve({ files, fields });
      });
      source.on("error", fail);
      source.pipe(bb);
    });
  } finally {
    clearTimeout(idle);
    clearTimeout(deadline);
  }
}

const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Lit l'envoi et renvoie les images dans l'ordre de lecture (trois formes, voir la route). */
export async function assembleAny(request: Request, limit: number): Promise<{ frames: Buffer[]; name: string; fields: Record<string, string> }> {
  const { files, fields } = await readParts(request, limit);
  if (!files.length) throw new UploadError(400, "Aucun fichier reçu.");
  try {
    if (files.length === 1 && isZip(files[0].data)) return { frames: await framesFromZip(files[0].data), name: files[0].name.replace(/\.zip$/i, ""), fields };
    if (files.length === 1) {
      if (!fields.cols || !fields.rows) throw new AnimError("Une seule image : indique le nombre de colonnes et de rangées de la feuille de sprites, ou envoie plusieurs images (ou un zip).");
      const frames = await splitSheet(files[0].data, Number(fields.cols), Number(fields.rows), fields.count ? Number(fields.count) : undefined);
      return { frames, name: files[0].name.replace(/\.[a-z0-9]+$/i, ""), fields };
    }
    const sorted = sortByName(files);
    return { frames: sorted.map((f) => f.data), name: sorted[0].name.replace(/[-_ ]?0*1?\.[a-z0-9]+$/i, "") || sorted[0].name, fields };
  } catch (error) {
    if (error instanceof AnimError) throw new UploadError(422, error.message);
    throw error;
  }
}
