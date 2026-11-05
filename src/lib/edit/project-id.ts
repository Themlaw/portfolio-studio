/**
 * Identité d'un projet neuf (lot 111) : plus de nom choisi à la création. Le slug (identifiant stable des liens publics et des blocs) est
 * un id aléatoire court, « p- » + 8 caractères base36, d'unicité vérifiée ; le titre part d'une valeur par défaut, modifiable en place
 * ensuite SANS changer le slug. Les projets existants gardent leur slug. Module sans accès base : l'appelant fournit « déjà pris ? ».
 */
import { randomBytes } from "node:crypto";

export const DEFAULT_PROJECT_TITLE = { fr: "Projet sans titre", en: "Untitled project" } as const;

export function newProjectSlug(taken: (slug: string) => boolean): string {
  for (;;) {
    let id = "p-";
    for (const b of randomBytes(8)) id += (b % 36).toString(36);
    if (!taken(id)) return id;
  }
}

/** Titre d'un projet neuf : celui qu'on donne (appels d'API), sinon la valeur par défaut. */
export function startTitle(fr?: string, en?: string): { fr: string; en: string } {
  const f = fr?.trim();
  if (!f) return { fr: DEFAULT_PROJECT_TITLE.fr, en: DEFAULT_PROJECT_TITLE.en };
  return { fr: f, en: en?.trim() || f };
}
