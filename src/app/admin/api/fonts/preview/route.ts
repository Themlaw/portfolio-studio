/**
 * GET /admin/api/fonts/preview?famille=<Famille> — aperçu d'une police du
 * catalogue dans le menu des polices de l'éditeur (admin seulement) : un
 * minuscule sous-ensemble (lettres de son nom), téléchargé par le serveur et
 * gardé en cache disque. Le navigateur ne contacte jamais Google.
 */
import { assertAdmin } from "@/lib/auth/guard";
import { previewFont } from "@/lib/fonts/library";
import { adminT } from "@/i18n/admin-msg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await assertAdmin();
  const t = adminT("actions");
  const family = new URL(request.url).searchParams.get("famille") ?? "";
  const bytes = family.length <= 60 ? await previewFont(family) : null;
  if (!bytes) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "font/woff2", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
