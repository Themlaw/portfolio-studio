/** GET /admin/api/upload/<id>/status — offset courant, pour reprendre un envoi. */
import { assertAdmin } from "@/lib/auth/guard";
import { uploadStatus } from "@/lib/upload/chunks";
import { uploadStep } from "@/lib/upload/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await assertAdmin();
  const { id } = await params;
  return uploadStep(request, async () => ({ upload: uploadStatus(id, user.id) }));
}
