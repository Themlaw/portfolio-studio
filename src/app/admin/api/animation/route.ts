/**
 * POST /admin/api/animation — envoi d'une ANIMATION image par image (lot 132), multipart. Admin connecté, même origine.
 *  - plusieurs fichiers image (PNG / WebP / JPEG), lus dans l'ordre naturel de leurs noms ;
 *  - OU un seul zip d'images ;
 *  - OU une seule image + champs `cols` et `rows` (feuille de sprites), `count` facultatif (images utilisées).
 * Bornes (sécurité v1.0) : corps ≤ MAX_ANIM_MB (150 par défaut), 48 images, 40 Mpx par image, quota et disque contrôlés avant lecture.
 * Réponse JSON : { ok, media } (comme /admin/api/upload) ou { ok: false, message }.
 */
import { assertAdmin } from "@/lib/auth/guard";
import { assembleAny } from "@/lib/animation/receive";
import { ingestAnimation } from "@/lib/animation/ingest";
import { auditedRoute } from "@/lib/journal/audit";
import { rememberPort } from "@/lib/jobs/notify";
import { isSameOrigin } from "@/lib/preview";
import { revalidateMedia } from "@/lib/revalidate";
import { attachUploadTags, parseTagLabels, tagCapacityProblem } from "@/lib/tags";
import { directReservedBytes, diskProblem, quotaProblem, reserveDirectUpload } from "@/lib/upload/quota";
import { UploadError } from "@/lib/upload/receive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const POST = auditedRoute("animation", async function POST(request: Request) {
  await assertAdmin();
  if (!isSameOrigin(request)) return json(403, { ok: false, message: "Origine refusée." });
  rememberPort(new URL(request.url).port);
  const full = quotaProblem();
  if (full) return json(507, { ok: false, message: full });
  const maxMb = Number(process.env.MAX_ANIM_MB);
  const limit = (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 150) * 1024 ** 2;
  const announced = Math.max(0, Number(request.headers.get("content-length")) || 0);
  if (announced > limit) return json(413, { ok: false, message: `Cet envoi est trop lourd : ${Math.round(limit / 1024 ** 2)} Mo au plus pour une animation.` });
  const disk = await diskProblem(announced, directReservedBytes());
  if (disk) return json(507, { ok: false, message: disk });
  const reservation = reserveDirectUpload(announced || limit);
  if ("problem" in reservation) return json(507, { ok: false, message: reservation.problem });
  try {
    const { frames, name, fields } = await assembleAny(request, limit);
    let raw: unknown = [];
    try {
      raw = fields.tags ? JSON.parse(fields.tags) : [];
    } catch {
      raw = null;
    }
    const tags = parseTagLabels(raw);
    const tagsFull = tags.ok ? tagCapacityProblem(tags.labels) : null;
    if (!tags.ok || tagsFull) return json(tags.ok ? 422 : 400, { ok: false, message: tags.ok ? tagsFull : tags.message });
    const media = await ingestAnimation(frames, fields.name?.trim().slice(0, 120) || name);
    const tagWarning = attachUploadTags(media.id, tags.labels);
    revalidateMedia();
    return json(200, { ok: true, media: tagWarning ? { ...media, tagWarning } : media });
  } catch (error) {
    if (error instanceof UploadError) return json(error.status, { ok: false, message: error.message });
    console.error("[animation] échec", error);
    return json(500, { ok: false, message: "L'envoi a échoué. Réessaie ; si ça recommence, vérifie l'espace disque du serveur." });
  } finally {
    reservation.release();
  }
});
