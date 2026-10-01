/**
 * POST /admin/api/upload — envoi d'UNE image (multipart, champ « file »).
 * Admin connecté et même origine ; réception en flux plafonnée
 * (MAX_IMAGE_MB, 40 par défaut) ; type vérifié par signature ; traitement
 * asynchrone (job). Réponse JSON : { ok, media } ou { ok: false, message }.
 */
import { assertAdmin } from "@/lib/auth/guard";
import { rememberPort } from "@/lib/jobs/notify";
import { uploadTmpDir } from "@/lib/jobs/worker";
import { isSameOrigin } from "@/lib/preview";
import { revalidateMedia } from "@/lib/revalidate";
import { ingestImage } from "@/lib/upload/ingest";
import { quotaProblem } from "@/lib/upload/quota";
import { receiveOneFile, UploadError } from "@/lib/upload/receive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  await assertAdmin();
  if (!isSameOrigin(request)) return json(403, { ok: false, message: "Origine refusée." });
  rememberPort(new URL(request.url).port);
  // Quota déjà atteint : refus avant de lire le fichier.
  const full = quotaProblem();
  if (full) return json(507, { ok: false, message: full });
  try {
    const file = await receiveOneFile(request, uploadTmpDir());
    const media = await ingestImage(file);
    revalidateMedia();
    return json(200, { ok: true, media });
  } catch (error) {
    if (error instanceof UploadError) return json(error.status, { ok: false, message: error.message });
    console.error("[upload] échec", error);
    return json(500, { ok: false, message: "L'envoi a échoué. Réessaie ; si ça recommence, vérifie l'espace disque du serveur." });
  }
}
