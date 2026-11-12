/**
 * Polices récentes (lot 70), commodité des menus de police de l'éditeur (admin seulement) :
 *  GET  /admin/api/fonts/recent                  → { fonts: ["embed:caveat", …] } (6 au plus, la dernière choisie en tête)
 *  POST /admin/api/fonts/recent  { font: "<réf>" } → même réponse, la police en tête ; 400 si la référence est inconnue.
 * Même origine obligatoire pour l'écriture. Mémorisé dans les réglages du site (src/lib/fonts/recent.ts).
 */
import { assertAdmin } from "@/lib/auth/guard";
import { pushRecentFont, readRecentFonts } from "@/lib/fonts/recent";
import { isSameOrigin } from "@/lib/preview";
import { adminT } from "@/i18n/admin-msg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Cookie" } });

export async function GET() {
  await assertAdmin();
  const t = adminT("actions");
  return json(200, { fonts: readRecentFonts() });
}

export async function POST(request: Request) {
  await assertAdmin();
  const t = adminT("actions");
  if (!isSameOrigin(request)) return json(403, { message: t("Origine refusée.") });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { message: t("Requête invalide.") });
  }
  const fonts = pushRecentFont((body as { font?: unknown } | null)?.font);
  return fonts ? json(200, { fonts }) : json(400, { message: t("Police inconnue.") });
}
