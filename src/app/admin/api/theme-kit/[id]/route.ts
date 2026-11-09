/**
 * Kit Photoshop d'un thème (admin) :
 *  - POST : état de l'export de l'état ENREGISTRÉ du thème ; le met en file
 *    (file lourde, exclusive avec la vidéo) s'il n'est ni prêt ni en cours ;
 *  - GET : téléchargement de l'archive .zip des trois PSD une fois prête (404 sinon) ;
 *    `?part=decor|logo|icones` (lot 122) : UN seul fichier .psd, celui de l'archive, tel quel ;
 *  - POST prêt : donne aussi le poids de chaque partie et la durée de génération.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { assertAdmin } from "@/lib/auth/guard";
import { recordEvent } from "@/lib/journal/audit";
import { wakeWorker } from "@/lib/jobs/worker";
import { kitFile, lastKitFailure, loadSavedTheme, kitVersion, requestKitExport } from "@/lib/kit/export-job";
import { isKitRole, kitParts, openKitPart, readKitMeta } from "@/lib/kit/parts";
import { isSameOrigin } from "@/lib/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const validId = (id: string) => /^[a-z0-9-]{1,80}$/.test(id);

export async function POST(request: Request, { params }: Params) {
  await assertAdmin();
  if (!isSameOrigin(request)) return json(403, { ok: false, message: "Origine refusée." });
  const { id } = await params;
  const theme = validId(id) ? loadSavedTheme(id) : null;
  if (!theme) return json(404, { ok: false, message: "Ce thème n'existe plus." });
  const state = await requestKitExport(theme, wakeWorker);
  if (state.ready) {
    const zip = kitFile(theme.id, state.version);
    const [parts, meta, info] = await Promise.all([kitParts(zip), readKitMeta(zip), stat(zip).catch(() => null)]);
    return json(200, { ok: true, ...state, parts, zipBytes: info?.size ?? null, ms: meta?.ms ?? null });
  }
  const error = state.ready ? null : lastKitFailure(theme.id, state.version);
  return json(200, { ok: true, ...state, ...(error && !state.ready && state.status === "queued" ? { lastError: error } : {}) });
}

export async function GET(request: Request, { params }: Params) {
  const session = await assertAdmin();
  const { id } = await params;
  const theme = validId(id) ? loadSavedTheme(id) : null;
  if (!theme) return json(404, { ok: false, message: "Ce thème n'existe plus." });
  const file = kitFile(theme.id, kitVersion(theme));
  // Lot 122 : une seule partie du kit (le .psd de l'archive).
  const part = new URL(request.url).searchParams.get("part");
  if (part !== null) {
    if (!isKitRole(part)) return json(400, { ok: false, message: "Partie du kit inconnue." });
    const opened = await openKitPart(file, part).catch(() => null);
    if (!opened) return json(404, { ok: false, ready: false, message: "Le kit n'est pas encore prêt." });
    const name = (await kitParts(null)).find((p) => p.role === part)!.file;
    // #64 : une partie du kit (le .psd tel quel) est un téléchargement comme l'archive : journalisée de la même façon.
    recordEvent({ action: "download:kit", type: "telechargement", user: session.user.id, result: "ok", label: `Partie du kit Photoshop téléchargée (${part})`, target: theme.id });
    return new Response(Readable.toWeb(opened.stream) as ReadableStream, {
      headers: {
        "Content-Type": "image/vnd.adobe.photoshop",
        "Content-Length": String(opened.size),
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const info = await stat(file).catch(() => null);
  if (!info) return json(404, { ok: false, ready: false, message: "Le kit n'est pas encore prêt." });
  recordEvent({ action: "download:kit", type: "telechargement", user: session.user.id, result: "ok", label: "Kit Photoshop téléchargé", target: theme.id });
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="kit-${theme.id}.zip"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
