/**
 * Kit Photoshop d'un thème (admin) :
 *  - POST : état de l'export de l'état ENREGISTRÉ du thème ; le met en file
 *    (file lourde, exclusive avec la vidéo) s'il n'est ni prêt ni en cours ;
 *  - GET : téléchargement de l'archive .zip des trois PSD une fois prête (404 sinon).
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { assertAdmin } from "@/lib/auth/guard";
import { recordEvent } from "@/lib/journal/audit";
import { wakeWorker } from "@/lib/jobs/worker";
import { kitFile, lastKitFailure, loadSavedTheme, kitVersion, requestKitExport } from "@/lib/kit/export-job";
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
  const error = state.ready ? null : lastKitFailure(theme.id, state.version);
  return json(200, { ok: true, ...state, ...(error && !state.ready && state.status === "queued" ? { lastError: error } : {}) });
}

export async function GET(_request: Request, { params }: Params) {
  const session = await assertAdmin();
  const { id } = await params;
  const theme = validId(id) ? loadSavedTheme(id) : null;
  if (!theme) return json(404, { ok: false, message: "Ce thème n'existe plus." });
  const file = kitFile(theme.id, kitVersion(theme));
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
