/**
 * État optimiste de la toile (lot 6). Une modification faite sur la toile
 * (texte en place, espacement, style de texte, ordre des blocs) est montrée
 * tout de suite, puis l'éditeur l'enregistre et demande un rafraîchissement.
 * Sans garde-fou, la réponse du serveur — rendue AVANT la modification suivante,
 * ou avant l'enregistrement de celle-ci — remet un instant l'ancienne valeur.
 *
 * Règle : l'état local fait foi jusqu'à ce que le serveur acquitte une
 * révision au moins aussi récente.
 *
 * - Chaque message d'intention porte un numéro (`seq`, croissant).
 * - Chaque aperçu est inscrit ici sous une clé (« une valeur par cible ») avec
 *   le numéro de son message ; il est RÉAPPLIQUÉ après chaque mutation du DOM
 *   (MutationObserver : avant l'affichage, donc sans image intermédiaire).
 * - L'éditeur annonce (`refresh` / `settle`) la révision `rev` écrite et le
 *   dernier numéro `upTo` dont il n'attend plus rien (tout enregistré, plus
 *   aucune écriture en vol). La page rendue porte la révision du brouillon
 *   (`[data-edit-rev]`) : quand elle atteint `rev`, le DOM est celui du
 *   serveur et les aperçus de numéro ≤ `upTo` sont retirés. Les plus récents
 *   restent appliqués par-dessus la page, même si elle est en retard.
 */
import { EDIT_MSG, type FromCanvas } from "@/lib/edit/protocol";

type Entry = { seq: number; apply: () => void; clear?: () => void; data?: unknown };
type Spec = { apply?: () => void; clear?: () => void; data?: unknown };

const entries = new Map<string, Entry>();
let counter = 0;
let targets: { rev: number; upTo: number }[] = [];

/** Envoie une intention à l'éditeur ; renvoie son numéro. */
export function postIntent(msg: FromCanvas): number {
  const seq = ++counter;
  window.parent.postMessage({ type: EDIT_MSG, ...msg, seq }, window.location.origin);
  return seq;
}

/** Inscrit (ou remplace) l'aperçu d'une cible et l'applique aussitôt. */
export function setOverlay(key: string, seq: number, spec: Spec = {}) {
  entries.set(key, { seq, apply: spec.apply ?? (() => {}), clear: spec.clear, data: spec.data });
  entries.get(key)?.apply();
}

/** Donnée d'un aperçu en attente (état local qui fait foi), ou undefined. */
export function overlayData<T>(key: string): T | undefined {
  return entries.get(key)?.data as T | undefined;
}

/** Données des aperçus dont la clé commence par `prefix`. */
export function overlayList<T>(prefix: string): T[] {
  return [...entries].filter(([k]) => k.startsWith(prefix)).map(([, e]) => e.data as T);
}

export function applyOverlays() {
  for (const e of entries.values()) e.apply();
}

/** Révision du brouillon portée par la page rendue, ou null (pas de repère). */
function domRev(): number | null {
  const el = document.querySelector<HTMLElement>("[data-edit-rev]");
  const n = el ? Number(el.dataset.editRev) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Retire les aperçus que la page rendue reflète désormais. */
export function checkSettle() {
  if (!targets.length) return;
  const rev = domRev();
  const reached = targets.filter((t) => rev === null || t.rev <= rev);
  if (!reached.length) return;
  targets = targets.filter((t) => !reached.includes(t));
  const upTo = Math.max(...reached.map((t) => t.upTo));
  const gone = [...entries].filter(([, e]) => e.seq <= upTo);
  for (const [k] of gone) entries.delete(k);
  // Retirés d'abord, nettoyés ensuite : un nettoyage voit l'état restant.
  for (const [, e] of gone) e.clear?.();
}

/** L'éditeur a écrit la révision `rev` ; tout jusqu'à `upTo` est enregistré (-1 : rien d'acquitté). */
export function noteSettle(rev: number | undefined, upTo: number | undefined) {
  if (rev !== undefined && upTo !== undefined && upTo >= 0) targets.push({ rev, upTo });
  // Peu de cibles à la fois : les plus anciennes, dépassées, sont inutiles.
  targets = targets.slice(-8);
  checkSettle();
}

/** Abandon explicite (annuler, rétablir, recharger) : plus aucun aperçu. */
export function resetOverlays() {
  const all = [...entries.values()];
  entries.clear();
  targets = [];
  for (const e of all) e.clear?.();
}

/** Réapplique les aperçus après chaque rendu de la page (avant l'affichage). */
export function observeOverlays(): () => void {
  const mo = new MutationObserver(() => {
    checkSettle();
    applyOverlays();
    // Nos propres modifications ne doivent pas nous rappeler.
    mo.takeRecords();
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-edit-rev"] });
  return () => mo.disconnect();
}

/* ---- Textes en place ------------------------------------------------------------ */

/** Écrit un texte en gardant le nœud texte de React quand il n'y en a qu'un. */
function writeText(el: Element, value: string) {
  if (el.textContent === value) return;
  if (el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE) el.firstChild.nodeValue = value;
  else el.textContent = value;
}

/** Textes d'un bloc (`data-inline`) ou du site (`data-site-inline`) visés par un aperçu. */
function textElements(target: { uid: string; path: string } | { field: string; index?: number }): HTMLElement[] {
  if ("uid" in target) {
    const block = document.querySelector(`[data-edit-block="${CSS.escape(target.uid)}"]`);
    return [...(block?.querySelectorAll<HTMLElement>(`[data-inline="${CSS.escape(target.path)}"]`) ?? [])].filter((e) => e.closest("[data-edit-block]") === block);
  }
  return [...document.querySelectorAll<HTMLElement>(`[data-site-inline="${CSS.escape(target.field)}"]`)].filter(
    (e) => target.index === undefined || e.dataset.navIndex === String(target.index),
  );
}

/** Texte posé en place : montré tel quel jusqu'à ce que le serveur le rende. */
export function previewText(target: { uid: string; path: string } | { field: string; index?: number }, value: string, seq: number) {
  const key = "uid" in target ? `text:${target.uid}:${target.path}` : `site-text:${target.field}:${target.index ?? ""}`;
  setOverlay(key, seq, {
    apply: () => {
      for (const el of textElements(target)) if (!el.hasAttribute("data-editing")) writeText(el, value);
    },
  });
}

/* ---- Ordre des blocs ---------------------------------------------------------------- */

/** Enveloppes d'édition des enfants d'un même parent (`null` : la page), en ordre du DOM. */
export function siblingWrappers(parent: string | null): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-edit-block]")].filter((e) => (e.dataset.editParent ?? null) === parent);
}

/**
 * Ordre voulu des enfants d'un parent : le DOM est réordonné (déplacements
 * minimaux, des éléments qui existent déjà). Sans effet si les enveloppes
 * ne partagent pas le même nœud parent (grille à cellules) : React ne doit
 * jamais retrouver un nœud ailleurs que sous son parent.
 */
function arrange(parent: string | null, order: string[]) {
  const wrappers = new Map(siblingWrappers(parent).map((e) => [e.dataset.editBlock ?? "", e]));
  const els = order.map((uid) => wrappers.get(uid)).filter((e): e is HTMLElement => Boolean(e));
  if (els.length < 2 || els.some((e) => e.parentElement !== els[0].parentElement)) return;
  const current = siblingWrappers(parent).filter((e) => els.includes(e));
  for (let i = 0; i < els.length; i++) {
    if (current[i] === els[i]) continue;
    current[i].before(els[i]);
    current.splice(current.indexOf(els[i]), 1);
    current.splice(i, 0, els[i]);
  }
}

/** Ordre voulu des enfants (aperçu), ou undefined s'il n'y en a pas en attente. */
export function pendingOrder(parent: string | null): string[] | undefined {
  return overlayData<string[]>(`order:${parent ?? ""}`);
}

export function previewOrder(parent: string | null, order: string[], seq: number) {
  setOverlay(`order:${parent ?? ""}`, seq, { data: order, apply: () => arrange(parent, order) });
}

/* ---- Agencement d'une grille ----------------------------------------------------------- */

export function previewLayout(uid: string, layout: string, seq: number) {
  setOverlay(`layout:${uid}`, seq, {
    apply: () => {
      const grid = document.querySelector(`[data-edit-block="${CSS.escape(uid)}"] .block-grid`);
      if (grid && grid.getAttribute("data-layout") !== layout) grid.setAttribute("data-layout", layout);
    },
  });
}
