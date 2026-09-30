/**
 * POST /admin/apercu/quitter : fin de l'aperçu (draft mode coupé, cookie
 * effacé), puis retour à la page d'où vient le formulaire (bandeau d'aperçu
 * sur le site, ou écran Thèmes). Admin connecté et même origine obligatoires.
 */
import { cookies, draftMode } from "next/headers";

import { assertAdmin } from "@/lib/auth/guard";
import { isSameOrigin, localPath } from "@/lib/preview";
import { PREVIEW_COOKIE } from "@/lib/theme";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await assertAdmin();
  if (!isSameOrigin(request)) return new Response("Origine refusée", { status: 403 });

  const form = await request.formData().catch(() => null);
  const back = localPath(String(form?.get("retour") ?? "") || request.headers.get("referer"), "/fr");

  (await draftMode()).disable();
  (await cookies()).delete(PREVIEW_COOKIE);
  return new Response(null, { status: 303, headers: { Location: back, "Cache-Control": "no-store" } });
}
