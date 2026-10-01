/** POST /admin/api/upload/<id>/complete — envoi terminé : détection du type et traitement (média, ou import d'un kit PSD). */
import { assertAdmin } from "@/lib/auth/guard";
import { completeUpload } from "@/lib/upload/chunks";
import { uploadStep } from "@/lib/upload/http";
import { UploadError } from "@/lib/upload/receive";

/** Corps facultatif { tags } (tags courants du client), 16 Ko au plus. */
async function readTags(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return undefined;
  if (text.length > 16 * 1024) throw new UploadError(413, "Requête trop longue.");
  try {
    const body = JSON.parse(text) as { tags?: unknown } | null;
    return body && typeof body === "object" ? body.tags : undefined;
  } catch {
    throw new UploadError(400, "Requête invalide.");
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await assertAdmin();
  const { id } = await params;
  // Média : { media } ; kit de thème : { kitImport } (import mis en file).
  return uploadStep(request, async () => completeUpload(id, user.id, await readTags(request)), { revalidate: true });
}
