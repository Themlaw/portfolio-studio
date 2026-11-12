/** PUT /admin/api/upload/<id>/chunk?offset=N — écrit un morceau à l'offset attendu, renvoie le suivant. */
import { noteUserActivity } from "@/lib/backup/activity";
import { assertAdmin } from "@/lib/auth/guard";
import { writeChunk } from "@/lib/upload/chunks";
import { uploadStep } from "@/lib/upload/http";
import { adminT } from "@/i18n/admin-msg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  noteUserActivity(); // envoi en cours = l'artiste travaille (lot 118)
  const { id } = await params;
  return uploadStep(request, async () => ({ upload: await writeChunk(id, new URL(request.url).searchParams.get("offset"), request, user.id) }));
}
