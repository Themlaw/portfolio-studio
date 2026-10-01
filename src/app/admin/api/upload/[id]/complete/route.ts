/** POST /admin/api/upload/<id>/complete — envoi terminé : détection du type et traitement. */
import { assertAdmin } from "@/lib/auth/guard";
import { completeUpload } from "@/lib/upload/chunks";
import { uploadStep } from "@/lib/upload/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await assertAdmin();
  const { id } = await params;
  return uploadStep(request, async () => ({ media: await completeUpload(id, user.id) }), { revalidate: true });
}
