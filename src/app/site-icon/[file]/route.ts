/**
 * GET /site-icon/<fichier> : l'icône de l'onglet (lots 52 et 83), déclinée : 16/32/48/180/192/512.png, maskable-512.png,
 * favicon.ico et, pour un monogramme, icon.svg (avec sa variante sombre). Le point dans l'adresse tient la route hors du proxy
 * (comme /media). Les balises portent l'empreinte (?v=) : quand elle correspond au rendu courant, le cache est immuable.
 */
import { iconResponse } from "@/lib/favicon-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  return iconResponse(file, new URL(request.url).searchParams.get("v"));
}
