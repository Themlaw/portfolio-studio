import type { NextRequest } from "next/server";

import { getTheme, isThemePreviewEnabled, PREVIEW_COOKIE } from "@/lib/theme";
import { PRESET_IDS } from "@/themes/presets";

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
 * GET /api/theme-preview?id=<preset>[&redirect=/fr/…]
 * Pose le cookie d'aperçu puis revient à la page d'origine. `?id=` vide l'efface.
 */
export function GET(request: NextRequest) {
  if (!isThemePreviewEnabled()) {
    return new Response("Not found", { status: 404, headers: BASE_HEADERS });
  }

  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (id && !getTheme(id)) {
    // L'identifiant reçu n'est jamais renvoyé dans la réponse.
    return new Response(`Thème inconnu. Disponibles : ${PRESET_IDS.join(", ")}`, {
      status: 400,
      headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const cookie = id
    ? `${PREVIEW_COOKIE}=${id}; Path=/; SameSite=Lax; Max-Age=2592000`
    : `${PREVIEW_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;

  return new Response(null, {
    status: 303,
    headers: { ...BASE_HEADERS, Location: backPath(request), "Set-Cookie": cookie },
  });
}
