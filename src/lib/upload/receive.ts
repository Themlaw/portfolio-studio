/**
 * Réception d'un fichier image (POST multipart) en flux : busboy écrit sur
 * disque dans ${DATA_DIR}/tmp au fil de l'eau (jamais tout en mémoire), calcule
 * le SHA-256 et garde les premiers octets pour la détection du type. La taille
 * est plafonnée PENDANT le flux : au dépassement, la lecture s'arrête.
 */
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import busboy from "busboy";

import { cleanFilename, SNIFF_BYTES } from "./sniff";

export class UploadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Received = { tmpPath: string; size: number; sha256: string; head: Uint8Array; filename: string };

/** Abandon d'un envoi qui ne reçoit plus rien (secondes, 30 par défaut). */
function idleTimeoutMs(): number {
  const s = Number(process.env.UPLOAD_IDLE_TIMEOUT_S || 30);
  return Math.max(1, Number.isFinite(s) ? s : 30) * 1000;
}

/** Durée totale maximale d'un envoi (secondes, 600 par défaut) : contre l'envoi au compte-gouttes. */
function maxDurationMs(): number {
  const s = Number(process.env.UPLOAD_MAX_DURATION_S || 600);
  return Math.max(1, Number.isFinite(s) ? s : 600) * 1000;
}

export function maxImageBytes(): number {
  const mb = Number(process.env.MAX_IMAGE_MB || 40);
  return Math.max(1, Number.isFinite(mb) ? mb : 40) * 1024 * 1024;
}

export async function receiveOneFile(request: Request, tmpDir: string): Promise<Received> {
  const max = maxImageBytes();
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > max + 64 * 1024) throw new UploadError(413, tooBig(max));
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data;/i.test(contentType) || !request.body) {
    throw new UploadError(400, "Requête invalide : envoie le fichier par le formulaire d'envoi.");
  }
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `upload-${Date.now()}-${randomBytes(8).toString("hex")}`);
  const source = Readable.fromWeb(request.body as import("node:stream/web").ReadableStream);

  // Flux d'écriture : on attend sa fermeture avant de supprimer le fichier
  // (sinon une ouverture tardive recréerait un fichier orphelin).
  let out: ReturnType<typeof createWriteStream> | null = null;
  let idle: NodeJS.Timeout | undefined;
  let deadline: NodeJS.Timeout | undefined;
  try {
    return await new Promise<Received>((resolve, reject) => {
      let settled = false;
      let gotFile = false;
      let written: Received | null = null;
      let formClosed = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        source.unpipe();
        source.destroy();
        out?.destroy();
        reject(error);
      };
      // Résolution seulement quand le fichier est écrit ET le formulaire lu en
      // entier : une seconde partie fichier est ainsi refusée elle aussi.
      const finishIfComplete = () => {
        if (settled || !written || !formClosed) return;
        settled = true;
        resolve(written);
      };
      const arm = () => {
        clearTimeout(idle);
        idle = setTimeout(
          () => fail(new UploadError(408, "L'envoi s'est interrompu (plus rien reçu depuis un moment). Vérifie ta connexion et réessaie.")),
          idleTimeoutMs(),
        );
      };
      arm();
      source.on("data", arm);
      deadline = setTimeout(
        () => fail(new UploadError(408, "L'envoi prend trop de temps : vérifie ta connexion, ou réduis l'image, puis réessaie.")),
        maxDurationMs(),
      );

      const bb = busboy({
        headers: { "content-type": contentType },
        // Les navigateurs envoient le nom de fichier en UTF-8.
        defParamCharset: "utf8",
        limits: { files: 1, fileSize: max, fields: 4, fieldSize: 256, parts: 5, headerPairs: 50 },
      });
      bb.on("file", (_name, file, info) => {
        if (gotFile) {
          file.resume();
          return;
        }
        gotFile = true;
        const hash = createHash("sha256");
        const headChunks: Buffer[] = [];
        let headLen = 0;
        let size = 0;
        out = createWriteStream(tmpPath, { flags: "wx" });
        const sink = out;
        file.on("data", (chunk: Buffer) => {
          size += chunk.length;
          hash.update(chunk);
          if (headLen < SNIFF_BYTES) {
            headChunks.push(chunk.subarray(0, SNIFF_BYTES - headLen));
            headLen += Math.min(chunk.length, SNIFF_BYTES - headLen);
          }
        });
        file.on("limit", () => fail(new UploadError(413, tooBig(max))));
        file.on("error", (e) => fail(e));
        sink.on("error", (e) => fail(e));
        file.pipe(sink);
        sink.on("finish", () => {
          if (settled) return;
          if (size === 0) return fail(new UploadError(400, "Le fichier est vide."));
          written = { tmpPath, size, sha256: hash.digest("hex"), head: new Uint8Array(Buffer.concat(headChunks)), filename: cleanFilename(info.filename) };
          finishIfComplete();
        });
      });
      bb.on("filesLimit", () => fail(new UploadError(400, "Un seul fichier par envoi.")));
      bb.on("partsLimit", () => fail(new UploadError(400, "Requête invalide.")));
      // Corps multipart mal formé ou interrompu : erreur du client, pas du serveur.
      bb.on("error", () => fail(new UploadError(400, "Envoi interrompu ou illisible : réessaie.")));
      bb.on("close", () => {
        if (!gotFile) return fail(new UploadError(400, "Aucun fichier reçu."));
        formClosed = true;
        finishIfComplete();
      });
      source.on("error", (e) => fail(e));
      source.pipe(bb);
    });
  } catch (error) {
    const sink = out as ReturnType<typeof createWriteStream> | null;
    if (sink && !sink.closed) {
      await new Promise<void>((resolve) => {
        sink.once("close", () => resolve());
        setTimeout(resolve, 2000);
      });
    }
    await rm(tmpPath, { force: true });
    throw error;
  } finally {
    clearTimeout(idle);
    clearTimeout(deadline);
  }
}

function tooBig(max: number): string {
  return `Ce fichier dépasse ${Math.round(max / 1024 / 1024)} Mo : réduis-le avant de l'envoyer.`;
}
