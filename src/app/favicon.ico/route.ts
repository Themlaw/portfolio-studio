/** GET /favicon.ico : l'icône de l'onglet courante (ICO 16, 32, 48 px), jamais un fichier d'origine (lot 83). */
import { iconResponse } from "@/lib/favicon-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return iconResponse("favicon.ico", new URL(request.url).searchParams.get("v"));
}
