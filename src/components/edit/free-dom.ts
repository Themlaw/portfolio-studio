/**
 * Repères DOM de la planche libre (lot 42), lus par la toile (FreeLayer, BoardLayer). `FreeBoardBlock` pose, sur la toile
 * seulement : `.free-board[data-edit-free][data-free-aspect]` (la zone) et `.free-item[data-free-item=<id>][data-free-ratio]`
 * (chaque image ; sa géométrie est dans les variables CSS `--x --y --w --rot`). La zone est une rubrique de la page (enveloppe
 * `data-edit-block`) ou un composant de planche (cadre `data-edit-bitem`).
 */

export type FreeRef = {
  zone: HTMLElement;
  /** uid de la rubrique (page) ou du composant (planche). */
  uid: string;
  /** Planche de projet, sinon undefined (rubrique de page). */
  board?: number;
  /** Réglages du composant de planche tels que la toile les a lus (JSON), repli de l'éditeur. */
  props?: string;
};

/** La zone qui contient (ou est) cet élément, avec son propriétaire ; null si ce n'est pas une planche libre de la toile. */
export function freeRefOf(el: Element | null): FreeRef | null {
  const zone = el?.closest<HTMLElement>("[data-edit-free]") ?? null;
  if (!zone) return null;
  const frame = zone.closest<HTMLElement>("[data-edit-bitem]");
  if (frame?.dataset.editBitem) {
    const board = Number(frame.dataset.board);
    return board ? { zone, uid: frame.dataset.editBitem, board, props: (frame.dataset.editBitemProps ?? "").slice(0, 100_000) || undefined } : null;
  }
  const uid = zone.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock;
  return uid ? { zone, uid } : null;
}

/** Clé d'une zone (page : `0:<uid>` ; planche : `<projet>:<uid>`). */
export const freeKey = (ref: Pick<FreeRef, "uid" | "board">): string => `${ref.board ?? 0}:${ref.uid}`;

export const ITEM_SELECTOR = ".free-item[data-free-item]";
export const itemsOf = (zone: Element): HTMLElement[] => [...zone.querySelectorAll<HTMLElement>(`:scope > ${ITEM_SELECTOR}`)];

/** Largeur ÷ hauteur de la zone (valeur vivante : la poignée du bas la change pendant le geste). */
export function zoneAspectOf(zone: HTMLElement): number {
  const live = Number(zone.style.getPropertyValue("--fb-pr")) || Number(zone.style.getPropertyValue("--fb-r"));
  const n = live || Number(zone.dataset.freeAspect);
  return Number.isFinite(n) && n > 0 ? n : 1.5;
}

export type FreeGeom = { id: string; x: number; y: number; w: number; rot: number; ratio: number };

/** Valeur d'une variable CSS de l'image : l'aperçu d'un geste (`--p<nom>`) prime sur la valeur rendue (`--<nom>`). */
const num = (el: HTMLElement, name: string, fallback = 0) => {
  const live = el.style.getPropertyValue(`--p${name}`);
  const n = Number(live !== "" ? live : el.style.getPropertyValue(`--${name}`));
  return Number.isFinite(n) ? n : fallback;
};

/** Géométrie d'une image, lue dans ses variables CSS (aperçu d'un geste compris). */
export function readItem(el: HTMLElement): FreeGeom {
  return { id: el.dataset.freeItem ?? "", x: num(el, "x"), y: num(el, "y"), w: num(el, "w", 30), rot: num(el, "rot"), ratio: Number(el.dataset.freeRatio) || 1 };
}

/**
 * Aperçu d'un geste : variables `--px --py --pw --prot` (jamais `--x…`, que React tient : retirer l'aperçu rend exactement la
 * valeur du serveur, acceptée ou refusée — voir edit/optimistic.ts).
 */
export function writeItem(el: HTMLElement, g: Partial<Pick<FreeGeom, "x" | "y" | "w" | "rot">>) {
  for (const k of ["x", "y", "w", "rot"] as const) if (g[k] !== undefined) el.style.setProperty(`--p${k}`, String(g[k]));
}
export function clearItem(el: HTMLElement) {
  for (const k of ["x", "y", "w", "rot"]) el.style.removeProperty(`--p${k}`);
}

/** Le cadre dans le plan (lot 113) : coin (l, t) et taille (w, h) en % du plan ; l'aperçu d'un geste (`--pfb-*`) prime sur la valeur rendue (`--fb-*`). Sans recadrage : le plan entier. */
export type FrameBox = { l: number; t: number; w: number; h: number };
export function frameBoxOf(zone: HTMLElement): FrameBox {
  const read = (n: string, d: number) => {
    const live = zone.style.getPropertyValue(`--pfb-${n}`);
    const own = zone.style.getPropertyValue(`--fb-${n}`);
    const v = Number(live !== "" ? live : own);
    return (live !== "" || own !== "") && Number.isFinite(v) ? v : d;
  };
  return { l: read("cl", 0), t: read("ct", 0), w: read("cw", 100), h: read("ch", 100) };
}
/** Aperçu d'un recadrage : marges (en % du plan) et format du plan. */
export function writeCrop(zone: HTMLElement, c: { t: number; r: number; b: number; l: number }, canvasAspect: number) {
  const w = 100 - c.l - c.r;
  const h = 100 - c.t - c.b;
  zone.setAttribute("data-crop", "");
  zone.style.setProperty("--pfb-cl", String(c.l));
  zone.style.setProperty("--pfb-ct", String(c.t));
  zone.style.setProperty("--pfb-cw", String(w));
  zone.style.setProperty("--pfb-ch", String(h));
  zone.style.setProperty("--pfb-fa", ((canvasAspect * w) / h).toFixed(5));
}
export function clearCrop(zone: HTMLElement) {
  for (const n of ["cl", "ct", "cw", "ch", "fa"]) zone.style.removeProperty(`--pfb-${n}`);
  // Le rendu de l'éditeur pose `--fb-cw` (et `data-crop`) s'il y a un recadrage ; sans lui, l'aperçu a posé `data-crop` seul.
  if (zone.style.getPropertyValue("--fb-cw") === "") zone.removeAttribute("data-crop");
}

/** Zone de cette clé (page ou planche), après un nouveau rendu de la page. */
export function findZone(key: string): HTMLElement | null {
  for (const z of document.querySelectorAll<HTMLElement>("[data-edit-free]")) {
    const ref = freeRefOf(z);
    if (ref && freeKey(ref) === key) return z;
  }
  return null;
}
export const findItem = (key: string, id: string): HTMLElement | null => findZone(key)?.querySelector<HTMLElement>(`:scope > .free-item[data-free-item="${CSS.escape(id)}"]`) ?? null;
