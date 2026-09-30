/**
 * POST /admin/apercu (formulaire natif, target="_blank") : active l'aperçu
 * d'un thème — draft mode + cookie d'id — puis ouvre le site. L'admin reste
 * sur son onglet. Admin connecté et même origine obligatoires.
 */
import { cookies, draftMode } from "next/headers";

import { assertAdmin } from "@/lib/auth/guard";
import { isSameOrigin } from "@/lib/preview";
import { getTheme, PREVIEW_COOKIE } from "@/lib/theme";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await assertAdmin();
  if (!isSameOrigin(request)) return new Response("Origine refusée", { status: 403 });

  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (!(await getTheme(id))) return new Response("Thème inconnu", { status: 400 });

  (await draftMode()).enable();
  (await cookies()).set(PREVIEW_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24,
  });
  return new Response(null, { status: 303, headers: { Location: "/fr", "Cache-Control": "no-store" } });
}
