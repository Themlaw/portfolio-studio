/**
 * POST /admin/api/cadres — envoi d'UN cadre (multipart, champ « file ») : PNG / WebP / AVIF transparent ou SVG (lot 74).
 * Admin connecté et même origine ; réception en flux plafonnée à 12 Mo. Réponse JSON : { ok, entry, reused } ou { ok: false, message }.
 * Conversion au plus léger et repérage du bord : src/lib/edit/frames.ts.
 */
import { rm } from "node:fs/promises";

import { assertAdmin } from "@/lib/auth/guard";
import { FRAME_MAX_BYTES, importFrame } from "@/lib/edit/frames";
import { uploadTmpDir } from "@/lib/jobs/worker";
import { isSameOrigin } from "@/lib/preview";
import { revalidateFrames } from "@/lib/revalidate";
import { receiveOneFile, UploadError } from "@/lib/upload/receive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  await assertAdmin();
  if (!isSameOrigin(request)) return json(403, { ok: false, message: "Origine refusée." });
  let tmp: string | undefined;
  try {
    const file = await receiveOneFile(request, uploadTmpDir(), { maxBytes: FRAME_MAX_BYTES });
    tmp = file.tmpPath;
    const r = await importFrame(file);
    if (!r.ok) return json(422, { ok: false, message: r.message });
    revalidateFrames();
    return json(200, { ok: true, entry: r.data.entry, reused: r.data.reused });
  } catch (error) {
    if (error instanceof UploadError) return json(error.status, { ok: false, message: error.message });
    console.error("[cadres] échec", error);
    return json(500, { ok: false, message: "L'envoi a échoué. Réessaie avec un autre fichier." });
  } finally {
    if (tmp) await rm(tmp, { force: true });
  }
}
