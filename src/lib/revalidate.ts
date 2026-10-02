/**
 * Invalidation du cache après une écriture (appelée par l'admin, phase 4).
 * À utiliser dans une Server Action ou un Route Handler.
 *
 * Par défaut, expiration immédiate ({ expire: 0 }) : la requête suivante
 * relit la base. `background: true` sert le contenu périmé pendant que la
 * nouvelle version se calcule (profil "max", stale-while-revalidate).
 */
import { revalidateTag } from "next/cache";

import { TAGS } from "./cache";

type Options = { background?: boolean };

function expire(tags: string[], { background = false }: Options = {}) {
  for (const tag of tags) revalidateTag(tag, background ? "max" : { expire: 0 });
}

/** Thème actif ou contenu d'un thème modifié. */
export const revalidateTheme = (o?: Options) => expire([TAGS.theme], o);
/** Identité du site, liens, réseaux. */
export const revalidateSettings = (o?: Options) => expire([TAGS.settings], o);
/**
 * Menu / liste des pages (création, slug, ordre, publication). Le menu est un
 * réglage (`nav`, v0.13) : l'étiquette des réglages part avec.
 */
export const revalidateNav = (o?: Options) => expire([TAGS.nav, TAGS.settings], o);
/** Une page et ses blocs. `structure` : slug, titre, ordre, publication ou menu changés. */
export const revalidatePage = (id: number, o?: Options & { structure?: boolean }) =>
  expire(o?.structure ? [TAGS.page(id), TAGS.nav, TAGS.settings] : [TAGS.page(id)], o);
/** Un projet et ses slots. `structure` : ajout, suppression ou ordre des projets. */
export const revalidateProject = (id: number, o?: Options & { structure?: boolean }) =>
  expire(o?.structure ? [TAGS.project(id), TAGS.projects] : [TAGS.project(id)], o);
/** Liste des projets (création, ordre, suppression) et tout ce qui la lit. */
export const revalidateProjects = (o?: Options) => expire([TAGS.projects], o);
/** Médias (alt, remplacement, suppression). */
export const revalidateMedia = (o?: Options) => expire([TAGS.media], o);
