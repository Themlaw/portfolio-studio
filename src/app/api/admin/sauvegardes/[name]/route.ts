/**
 * GET/HEAD /api/admin/sauvegardes/<nom> — télécharge une sauvegarde (lot 76), pour qu'elle sorte du volume du site.
 *
 * - Réservé à l'admin : session vérifiée en base (401 sans session). Les mêmes cookies que l'admin, PLUS une confirmation
 *   récente (403 sinon) : connexion de moins de 10 min ou mot de passe retapé (src/lib/backup/unlock.ts, audit P2).
 * - Nom strict (portfolio-AAAAMMJJ-HHMMSS.tar.gz) : aucun chemin ne peut être construit.
 * - Flux : le fichier est lu par blocs de 256 Ko, rien n'est chargé en mémoire (conteneur limité). Une plage
 *   (Range, une seule) donne un 206, ce qui permet de reprendre un téléchargement interrompu ; If-Range respecté.
 * - Pièce jointe, jamais affichée ; pas de cache.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { readAuthConfig } from "@/lib/auth/config";
import { adminSessionFor } from "@/lib/auth/guard";
import { dataDir } from "@/lib/db";
import { backupDir } from "@/lib/backup/archive";
import { isArchiveName, parseRange } from "@/lib/backup/download";
import { isFreshSession, isUnlocked, readCookie, UNLOCK_COOKIE } from "@/lib/backup/unlock";
import { recordEvent } from "@/lib/journal/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ name: string }> };

const text = (status: number, body: string, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });

async function serve(request: Request, { params }: Params, head: boolean) {
  const session = await adminSessionFor(request.headers);
  if (!session) return text(401, "Connexion requise");
  const user = session.user.id;
  // Audit de sécurité P2 : un cookie de session volé ne suffit pas. Connexion de moins de 10 min, ou mot de passe retapé
  // (cookie de déverrouillage lié à cette session, posé par unlockBackupDownloadAction).
  const unlocked = isFreshSession(session.session.createdAt) || isUnlocked(readAuthConfig().secret, session.session.id, readCookie(request.headers.get("cookie"), UNLOCK_COOKIE));
  if (!unlocked) return text(403, "Confirme ton mot de passe sur l'écran Sauvegardes avant de télécharger.");
  const { name } = await params;
  if (!isArchiveName(name)) return text(404, "Not found");
  const file = path.join(/* turbopackIgnore: true */ backupDir(dataDir()), name);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return text(404, "Not found");

  const etag = `"${info.size}-${Math.floor(info.mtimeMs)}"`;
  const headers = new Headers({
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    ETag: etag,
    "Last-Modified": info.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  });
  let range = parseRange(request.headers.get("range"), info.size);
  const ifRange = request.headers.get("if-range");
  if (range && ifRange && ifRange !== etag) range = null; // le fichier a changé : réponse complète
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${info.size}`);
    return new Response(null, { status: 416, headers });
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : info.size - 1;
  const length = info.size === 0 ? 0 : end - start + 1;
  headers.set("Content-Length", String(length));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
  const status = range ? 206 : 200;
  if (head || length === 0) return new Response(null, { status, headers });
  // Journal (P5) : une archive contient toute la base. Une reprise (Range au-delà du début) n'ajoute pas d'entrée.
  if (start === 0) recordEvent({ action: "download:backup", type: "telechargement", user, result: "ok", label: "Sauvegarde téléchargée", target: name });
  const stream = createReadStream(file, { start, end, highWaterMark: 256 * 1024 });
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}

export async function GET(request: Request, ctx: Params) {
  return serve(request, ctx, false);
}

export async function HEAD(request: Request, ctx: Params) {
  return serve(request, ctx, true);
}
