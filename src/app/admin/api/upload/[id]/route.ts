/** DELETE /admin/api/upload/<id> — annule un envoi par morceaux. */
import { assertAdmin } from "@/lib/auth/guard";
import { cancelUpload } from "@/lib/upload/chunks";
import { uploadStep } from "@/lib/upload/http";
import { auditedRoute } from "@/lib/journal/audit";
import { adminT } from "@/i18n/admin-msg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = auditedRoute("upload-cancel", async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const { id } = await params;
  return uploadStep(request, async () => {
    await cancelUpload(id, user.id);
    return {};
  });
});
