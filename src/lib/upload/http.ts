/** Réponses JSON des routes d'envoi et traduction des erreurs. */
import { isSameOrigin } from "@/lib/preview";
import { revalidateMedia } from "@/lib/revalidate";

import { UploadError } from "./receive";

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Exécute une étape d'envoi : même origine exigée, erreurs en JSON lisible. */
export async function uploadStep(request: Request, step: () => Promise<unknown>, opts: { revalidate?: boolean } = {}): Promise<Response> {
  if (!isSameOrigin(request)) return json(403, { ok: false, message: "Origine refusée." });
  try {
    const data = await step();
    if (opts.revalidate) revalidateMedia();
    return json(200, { ok: true, ...(data && typeof data === "object" ? data : {}) });
  } catch (error) {
    if (error instanceof UploadError) return json(error.status, { ok: false, message: error.message });
    console.error("[upload] échec", error);
    return json(500, { ok: false, message: "L'envoi a échoué. Réessaie ; si ça recommence, vérifie l'espace disque du serveur." });
  }
}
