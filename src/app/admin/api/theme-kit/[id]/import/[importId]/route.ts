/** GET /admin/api/theme-kit/<thème>/import/<id> — état d'un import de kit de CE thème (suivi par l'écran de revue). */
import { assertAdmin } from "@/lib/auth/guard";
import { getKitImport, isImportId } from "@/lib/kit/import-job";
import { adminT } from "@/i18n/admin-msg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; importId: string }> }) {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const { id, importId } = await params;
  // Un import d'un autre thème : introuvable ici (comme un identifiant inconnu).
  const state = isImportId(importId) && /^[a-z0-9-]{1,80}$/.test(id) ? await getKitImport(importId, id) : null;
  if (!state) return json(404, { ok: false, message: "Import introuvable." });
  return json(200, { ok: true, status: state.status, error: state.error });
}
