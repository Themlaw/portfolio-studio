/** POST /admin/api/upload/init — { name, size, type } → identifiant d'envoi par morceaux. */
import { noteUserActivity } from "@/lib/backup/activity";
import { assertAdmin } from "@/lib/auth/guard";
import { initUpload } from "@/lib/upload/chunks";
import { uploadStep } from "@/lib/upload/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user } = await assertAdmin();
  noteUserActivity(); // lot 118
  return uploadStep(request, async () => ({ upload: await initUpload(await request.json().catch(() => null), user.id) }));
}
