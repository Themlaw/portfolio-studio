/**
 * GET /admin/api/themes/<id>/export — archive ZIP du thème ENREGISTRÉ
 * (theme.json + éléments dessinés du kit), à importer sur un autre site ou
 * plus tard (Admin → Thèmes → Importer). Admin connecté ; aucune écriture.
 */
import { assertAdmin } from "@/lib/auth/guard";
import { recordEvent } from "@/lib/journal/audit";
import { loadSavedTheme } from "@/lib/kit/export-job";
import { exportThemePackage } from "@/lib/themes/transfer";
import { adminT } from "@/i18n/admin-msg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const { id } = await params;
  const theme = /^[a-z0-9-]{1,80}$/.test(id) ? loadSavedTheme(id) : null;
  if (!theme) {
    return new Response(JSON.stringify({ ok: false, message: t("Ce thème n'existe plus.") }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const zip = await exportThemePackage(theme);
  recordEvent({ action: "download:theme-export", type: "telechargement", user: session.user.id, result: "ok", label: t("Thème exporté (archive)"), target: theme.id });
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
      "Content-Disposition": `attachment; filename="theme-${theme.id}.zip"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
