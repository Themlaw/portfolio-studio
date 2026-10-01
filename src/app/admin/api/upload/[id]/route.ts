/** DELETE /admin/api/upload/<id> — annule un envoi par morceaux. */
import { assertAdmin } from "@/lib/auth/guard";
import { cancelUpload } from "@/lib/upload/chunks";
import { uploadStep } from "@/lib/upload/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await assertAdmin();
  const { id } = await params;
  return uploadStep(request, async () => {
    await cancelUpload(id, user.id);
    return {};
  });
}
