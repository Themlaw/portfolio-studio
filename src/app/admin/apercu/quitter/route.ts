/**
 * POST /admin/apercu/quitter : fin de l'aperçu (draft mode coupé, cookies
 * effacés), puis retour à l'écran de l'admin d'où l'aperçu a été ouvert
 * (Thèmes, Pages…), sinon Admin → Thèmes (v0.13.1 : plus l'accueil du site).
 * Un champ `retour` explicite (écran Thèmes) l'emporte. Admin connecté et
 * même origine obligatoires.
 */
import { cookies, draftMode } from "next/headers";

import { assertAdmin } from "@/lib/auth/guard";
import { adminScreen, isSameOrigin, PREVIEW_FALLBACK, PREVIEW_FROM_COOKIE } from "@/lib/preview";
import { DRAFT_VIEW_COOKIE } from "@/lib/draft-view";
import { PREVIEW_COOKIE } from "@/lib/theme";
import { adminT } from "@/i18n/admin-msg";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await assertAdmin();
  const t = adminT("actions");
  if (!isSameOrigin(request)) return new Response(t("Origine refusée"), { status: 403 });

  const form = await request.formData().catch(() => null);
  const jar = await cookies();
  const back = adminScreen(String(form?.get("retour") ?? "")) ?? adminScreen(jar.get(PREVIEW_FROM_COOKIE)?.value) ?? PREVIEW_FALLBACK;

  (await draftMode()).disable();
  jar.delete(PREVIEW_COOKIE);
  jar.delete(PREVIEW_FROM_COOKIE);
  // Vue brouillon de l'éditeur visuel coupée aussi.
  jar.delete(DRAFT_VIEW_COOKIE);
  return new Response(null, { status: 303, headers: { Location: back, "Cache-Control": "no-store" } });
}
