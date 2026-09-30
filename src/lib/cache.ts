/**
 * Cache des lectures en base (modèle « unstable_cache + tags », voir README) :
 * chaque lecture est mise en cache sans expiration (revalidate: false) et
 * étiquetée ; src/lib/revalidate.ts invalide par étiquette. Les pages publiques
 * rendues avec ces données sont elles-mêmes en cache (ISR à la demande) et
 * héritent des étiquettes.
 */
import { unstable_cache } from "next/cache";

export const TAGS = {
  theme: "theme",
  settings: "settings",
  nav: "nav",
  media: "media",
  projects: "projects",
  page: (id: number) => `page:${id}`,
  project: (id: number) => `project:${id}`,
} as const;

/** true pendant `next build` : aucune base n'est disponible. */
export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export function cached<T>(key: string[], tags: string[], fn: () => T | Promise<T>): Promise<T> {
  return unstable_cache(async () => fn(), key, { tags, revalidate: false })();
}
