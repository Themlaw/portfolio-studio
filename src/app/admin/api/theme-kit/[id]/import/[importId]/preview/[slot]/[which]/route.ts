/**
 * GET /admin/api/theme-kit/<thème>/import/<id>/preview/<emplacement>/<avant|apres>
 * — aperçu PNG d'un emplacement pour l'écran de revue ; l'import doit
 * appartenir au thème ; chemins calculés côté serveur (readPreview).
 */
import { assertAdmin } from "@/lib/auth/guard";
import { isImportId, readPreview } from "@/lib/kit/import-job";
import { ALL_SLOTS } from "@/lib/kit/spec";
import { adminT } from "@/i18n/admin-msg";

/** Plan du décor libre (kit v4) : `decor--<n>`, n de 1 à 8. */
const DECOR_SLOT = /^decor--([1-8])$/;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => new Response(t("Aperçu introuvable"), { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; importId: string; slot: string; which: string }> }) {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const { id, importId, slot, which } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(id) || !isImportId(importId) || (which !== "avant" && which !== "apres")) return notFound();
  const spec = ALL_SLOTS.find((s) => s.id.replace(/\//g, "--") === slot) ?? (DECOR_SLOT.test(slot) ? { id: slot.replace("--", "/") } : undefined);
  if (!spec) return notFound();
  const data = await readPreview(importId, id, spec.id, which);
  if (!data) return notFound();
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "image/png", "Content-Length": String(data.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
