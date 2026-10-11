/**
 * GET /fonts/<empreinte>.woff2 — polices Google téléchargées par le serveur
 * (src/lib/fonts/library.ts) et servies par le site lui-même : aucune requête
 * vers Google depuis le navigateur des visiteurs. Nom contrôlé (empreinte du
 * contenu : cache public d'un an, immuable), nosniff, CSP fermée.
 */
import { readFontFile } from "@/lib/fonts/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const bytes = await readFontFile(file);
  if (!bytes) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "font/woff2",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
