/**
 * Corbeille (lot 23) : pages, projets et médias supprimés restent 30 jours restaurables, puis un job les
 * purge (src/lib/edit/trash.ts). Module pur (aucun import) : lu aussi par l'interface.
 */
export const TRASH_DAYS = 30;
const DAY_MS = 86_400_000;

/** Date (ms) de la purge d'un élément mis à la corbeille à `deletedAt` (ms). */
export const purgeAt = (deletedAt: number): number => deletedAt + TRASH_DAYS * DAY_MS;

/** Jours restants avant la purge (au moins 0). */
export function daysLeft(deletedAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((purgeAt(deletedAt) - now) / DAY_MS));
}

/* ---- Phrases des confirmations « Supprimer définitivement » (accords et zéro gérés) ---- */

/** « 0 / 1 » → singulier, sinon pluriel (français). */
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** Ce qui part avec une page supprimée pour de bon. */
export function lostWithPage(blocks: number, hasDraft: boolean): string {
  const items = [blocks > 0 ? (blocks === 1 ? "son bloc" : `ses ${blocks} blocs`) : "", hasDraft ? "son brouillon" : ""].filter(Boolean);
  if (!items.length) return "elle est vide : rien d'autre ne disparaît.";
  return `${items.join(" et ")} ${items.length === 1 && blocks <= 1 ? "disparaît" : "disparaissent"}.`;
}

/** Ce qui part avec un projet supprimé pour de bon (ses images restent dans la médiathèque). */
export function lostWithProject(slots: number): string {
  const what = slots === 0 ? "sa mise en page (sans emplacement) disparaît" : slots === 1 ? "sa mise en page et son emplacement disparaissent" : `sa mise en page et ses ${slots} emplacements disparaissent`;
  return `${what} ; ses images restent dans la médiathèque.`;
}

/** Résumé de « Vider la corbeille » : « 2 pages, 1 projet (avec 3 emplacements) ». */
export function emptyTrashParts(s: { pages: number; projects: number; media: number; slots: number }): string[] {
  return [
    s.pages ? `${s.pages} ${plural(s.pages, "page", "pages")}` : "",
    s.projects ? `${s.projects} ${plural(s.projects, "projet", "projets")}${s.slots ? ` (avec ${s.slots} ${plural(s.slots, "emplacement", "emplacements")})` : " (sans emplacement)"}` : "",
    s.media ? `${s.media} ${plural(s.media, "média", "médias")}` : "",
  ].filter(Boolean);
}

/** « 1 élément sera supprimé » / « 3 éléments seront supprimés ». */
export const willBeDeleted = (n: number) => `${n} ${plural(n, "élément", "éléments")} ${plural(n, "sera supprimé", "seront supprimés")}`;

/** Toast d'une page restaurée : l'adresse reprise et la collection reprise sont dites. */
export function restoredMessage(title: string, r: { slugChanged: boolean; collectionDropped: boolean }): string {
  const notes = [r.slugChanged ? "son adresse était prise, elle en a une nouvelle" : "", r.collectionDropped ? "sa collection est maintenant celle d'une autre page, elle ne la présente plus" : ""].filter(Boolean);
  return `« ${title} » restaurée${notes.length ? ` · ${notes.join(" ; ")}` : ""}`;
}
