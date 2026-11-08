import { draftMode } from "next/headers";
import type { NextRequest } from "next/server";

import { sameOriginPath } from "@/lib/preview";
import { getTheme, isThemePreviewOpen, listThemes, PREVIEW_BANNER_COOKIE, PREVIEW_COOKIE } from "@/lib/theme";

export const dynamic = "force-dynamic";

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Chemin de retour, strictement sur la même origine.
 * On laisse le parseur URL normaliser (`/\evil`, tabulations, CRLF…) puis on
 * compare les origines : tout ce qui sort du site retombe sur "/".
 */
function backPath(request: NextRequest): string {
  return sameOriginPath(request.nextUrl.searchParams.get("redirect") ?? request.headers.get("referer"), request.nextUrl.origin);
}

/**
 * GET /api/theme-preview?id=<thème>[&redirect=/fr/…]
 * Active le draft mode (contournement du cache ISR) et mémorise le thème à
 * prévisualiser, puis revient à la page d'origine. `?id=` vide désactive
 * l'aperçu. DÉVELOPPEMENT UNIQUEMENT (scripts de test) : un GET qui change
 * un état serait exposé au CSRF. En production, l'aperçu passe par les server
 * actions de l'admin (écran Thèmes) ; cette route répond 404.
 */
export async function GET(request: NextRequest) {
  if (!isThemePreviewOpen()) {
    return new Response("Not found", { status: 404, headers: BASE_HEADERS });
  }

  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (id && !(await getTheme(id))) {
    // L'identifiant reçu n'est jamais renvoyé dans la réponse.
    const available = Object.keys(await listThemes()).join(", ");
    return new Response(`Thème inconnu. Disponibles : ${available}`, {
      status: 400,
      headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const draft = await draftMode();
  if (id) draft.enable();
  else draft.disable();

  // draftMode() pose/efface son propre cookie ; on y ajoute l'id du thème.
  const headers = new Headers({ ...BASE_HEADERS, Location: backPath(request) });
  headers.append(
    "Set-Cookie",
    id
      ? `${PREVIEW_COOKIE}=${id}; Path=/; SameSite=Lax; HttpOnly; Max-Age=2592000`
      : `${PREVIEW_COOKIE}=; Path=/; SameSite=Lax; HttpOnly; Max-Age=0`,
  );
  // &banner=0 : les scripts de capture masquent le bandeau d'aperçu.
  const banner = request.nextUrl.searchParams.get("banner") === "0" && id ? "off" : "";
  headers.append(
    "Set-Cookie",
    banner
      ? `${PREVIEW_BANNER_COOKIE}=off; Path=/; SameSite=Lax; HttpOnly; Max-Age=2592000`
      : `${PREVIEW_BANNER_COOKIE}=; Path=/; SameSite=Lax; HttpOnly; Max-Age=0`,
  );
  return new Response(null, { status: 303, headers });
}
