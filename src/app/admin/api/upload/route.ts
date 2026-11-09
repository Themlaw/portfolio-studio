/**
 * POST /admin/api/upload — envoi d'UNE image ou d'UN PDF (multipart, champ « file »).
 * Admin connecté et même origine ; réception en flux plafonnée
 * (MAX_IMAGE_MB, 200 par défaut) ; type vérifié par signature ; traitement
 * asynchrone (job). Réponse JSON : { ok, media } ou { ok: false, message }.
 */
import { rm } from "node:fs/promises";

import { assertAdmin } from "@/lib/auth/guard";
import { rememberPort } from "@/lib/jobs/notify";
import { uploadTmpDir } from "@/lib/jobs/worker";
import { isSameOrigin } from "@/lib/preview";
import { revalidateMedia } from "@/lib/revalidate";
import { ingestImage } from "@/lib/upload/ingest";
import { ingestPdf } from "@/lib/pdf/ingest";
import { sniffPdf } from "@/lib/upload/sniff";
import { directReservedBytes, diskProblem, quotaProblem, reserveDirectUpload } from "@/lib/upload/quota";
import { receiveOneFile, UploadError } from "@/lib/upload/receive";
import { attachUploadTags, parseTagLabels, tagCapacityProblem } from "@/lib/tags";
import { auditedRoute } from "@/lib/journal/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const POST = auditedRoute("upload", async function POST(request: Request) {
  await assertAdmin();
  if (!isSameOrigin(request)) return json(403, { ok: false, message: "Origine refusée." });
  rememberPort(new URL(request.url).port);
  // Quota déjà atteint : refus avant de lire le fichier.
  const full = quotaProblem();
  if (full) return json(507, { ok: false, message: full });
  // Disque presque plein (statfs) : refus avant de lire, d'après la taille annoncée du corps (et celle des envois directs déjà en cours).
  const announced = Math.max(0, Number(request.headers.get("content-length")) || 0);
  const disk = await diskProblem(announced, directReservedBytes());
  if (disk) return json(507, { ok: false, message: disk });
  // #60 : la taille annoncée est RÉSERVÉE pendant la réception (sans longueur annoncée : le plafond d'une image), pour que des envois
  // simultanés ne dépassent pas ensemble le quota ; libérée dès que le fichier est enregistré ou refusé.
  const maxMb = Number(process.env.MAX_IMAGE_MB);
  const reservation = reserveDirectUpload(announced || (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 200) * 1024 ** 2);
  if ("problem" in reservation) return json(507, { ok: false, message: reservation.problem });
  try {
    const file = await receiveOneFile(request, uploadTmpDir());
    // Tags du fichier (champ « tags », JSON) : vérifiés avant tout enregistrement.
    let raw: unknown = [];
    try {
      raw = file.fields?.tags ? JSON.parse(file.fields.tags) : [];
    } catch {
      raw = null;
    }
    const tags = parseTagLabels(raw);
    const tagsFull = tags.ok ? tagCapacityProblem(tags.labels) : null;
    if (!tags.ok || tagsFull) {
      await rm(file.tmpPath, { force: true });
      return json(tags.ok ? 422 : 400, { ok: false, message: tags.ok ? tagsFull : tags.message });
    }
    // PDF (bloc CV) d'après la signature ; sinon une image (refusée si ce n'en est pas une).
    const media = sniffPdf(file.head) ? { ...(await ingestPdf(file)), kind: "pdf" as const } : await ingestImage(file);
    const tagWarning = attachUploadTags(media.id, tags.labels);
    revalidateMedia();
    return json(200, { ok: true, media: tagWarning ? { ...media, tagWarning } : media });
  } catch (error) {
    if (error instanceof UploadError) return json(error.status, { ok: false, message: error.message });
    console.error("[upload] échec", error);
    return json(500, { ok: false, message: "L'envoi a échoué. Réessaie ; si ça recommence, vérifie l'espace disque du serveur." });
  } finally {
    reservation.release();
  }
});
