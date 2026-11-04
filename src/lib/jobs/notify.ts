/**
 * Fin d'un traitement : invalide le cache des pages publiques qui affichent
 * ce média (étiquettes « media » et projets). Le worker tourne hors requête :
 * revalidateTag n'y est pas toujours disponible ; on passe alors par une
 * requête interne vers /api/internal/revalidate, authentifiée par un jeton
 * propre au processus.
 */
import { randomBytes } from "node:crypto";

import { TAGS } from "@/lib/cache";

export const INTERNAL_TOKEN_HEADER = "x-portfolio-internal-token";

const G = globalThis as typeof globalThis & { __portfolioInternalToken?: string };

/**
 * Jeton partagé par toutes les copies du module dans ce processus (worker et route, bundles distincts) : rangé sur `globalThis`,
 * JAMAIS dans `process.env`, que tout processus enfant hériterait (ffmpeg et ffprobe lisent des fichiers envoyés).
 */
export function internalToken(): string {
  G.__portfolioInternalToken ||= randomBytes(24).toString("hex");
  return G.__portfolioInternalToken;
}

/** Port local du serveur (mémorisé à la première requête d'admin). */
export function rememberPort(port: string | null | undefined) {
  if (port && /^\d+$/.test(port)) process.env.PORTFOLIO_SELF_PORT ||= port;
}

export async function notifyMediaChanged(mediaId: number): Promise<void> {
  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag(TAGS.media, { expire: 0 });
    revalidateTag(TAGS.projects, { expire: 0 });
    return;
  } catch {
    // hors contexte de requête : requête interne ci-dessous
  }
  const port = process.env.PORT || process.env.PORTFOLIO_SELF_PORT || "3000";
  try {
    await fetch(`http://127.0.0.1:${port}/api/internal/revalidate`, {
      method: "POST",
      headers: { [INTERNAL_TOKEN_HEADER]: internalToken(), "content-type": "application/json" },
      body: JSON.stringify({ mediaId }),
    });
  } catch (error) {
    console.error(`[jobs] invalidation du cache après le média ${mediaId} impossible`, error);
  }
}
