import { draftMode } from "next/headers";
import type { NextRequest } from "next/server";

import { getTheme, isThemePreviewEnabled, listThemes, PREVIEW_COOKIE } from "@/lib/theme";

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
  const candidate =
    request.nextUrl.searchParams.get("redirect") ?? request.headers.get("referer");
  if (!candidate) return "/";
  try {
    const url = new URL(candidate, request.nextUrl.origin);
    if (url.origin !== request.nextUrl.origin) return "/";
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}

/**
 * GET /api/theme-preview?id=<thème>[&redirect=/fr/…]
 * Active le draft mode (contournement du cache ISR) et mémorise le thème à
 * prévisualiser, puis revient à la page d'origine. `?id=` vide désactive
 * l'aperçu. Développement uniquement tant que l'auth n'existe pas.
 */
export async function GET(request: NextRequest) {
  if (!isThemePreviewEnabled()) {
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
  return new Response(null, { status: 303, headers });
}
