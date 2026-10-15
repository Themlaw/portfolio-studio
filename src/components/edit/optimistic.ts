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
 * - Refus ou échec d'une écriture (planche tenue ailleurs, titre vide, connexion
 *   perdue) : l'éditeur envoie `revert` avec le numéro de l'intention ; son aperçu
 *   est retiré ET la valeur d'origine rétablie (`revertOverlay`).
 * - Une navigation interne de la toile vide tout (`resetOverlays`) : les uid de
 *   blocs (`b0…`) sont réutilisés d'une page à l'autre.
 *
 * Textes : un aperçu écrit dans le nœud texte que React gère, SANS rien changer
 * à ce que React croit y avoir mis. Si le serveur rend la même valeur qu'avant
 * (refus, Annuler), React ne réécrit rien et l'aperçu resterait à l'écran. Un
 * marqueur (nœud commentaire) accompagne donc l'aperçu : React, quand il réécrit
 * le texte (`textContent`), l'efface. Marqueur encore là au retrait = React n'a
 * rien réécrit, la valeur affichée est celle de l'aperçu : on rétablit l'origine.
 *
 * Carte de rubrique (lot 17c) : l'enveloppe `.surface-card` est TOUJOURS dans la page rendue en édition
 * (sans carte : `display: contents`) ; l'aperçu n'y change que des attributs et des variables CSS, jamais un
 * nœud de React (`previewSurface`).
 *
 * Plusieurs nœuds (accroche à passage surligné) : l'aperçu est un élément à nous posé à côté de
 * l'enveloppe de React, qui est seulement cachée (`previewMarked`). Listes du site (menu, réseaux,
 * champs de formulaire) : ordre CSS, retraits cachés, fantômes (`previewList`). Dans les deux cas
 * React ne perd aucun nœud et retirer l'aperçu rend exactement l'état d'origine.
 */
import { EDIT_MSG, type FromCanvas } from "@/lib/edit/protocol";
import { parseMarked } from "@/lib/marked";

import { parseColor, toHex } from "@/themes/palette";
import { fondAttributes, fondJoins, fondKey, fondStyle, readBackground, type Background } from "@/themes/fond";
import { borderVars, cardStyle, cardVars, FALLBACK_CARD, paperAttributes, readSurface, resolveSurface, surfaceAttributes, type CardPalette, type ResolvedSurface, type Surface } from "@/themes/surface";

import { markedNodes } from "./marked-edit";

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

/** Refus ou échec de l'intention `seq` : son aperçu est retiré et la valeur d'origine rétablie. */
export function revertOverlay(seq: number) {
  const gone = [...entries].filter(([, e]) => e.seq === seq);
  for (const [k] of gone) entries.delete(k);
  for (const [, e] of gone) e.clear?.();
}

/** Abandon explicite (navigation interne de la toile) : plus aucun aperçu, valeurs d'origine rétablies. */
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

/** Aperçu de texte posé sur un élément : valeur d'origine et marqueur que React effacerait en réécrivant. */
const shown = new WeakMap<Element, { original: string; marker: Comment; nodes?: ChildNode[] }>();

/**
 * Écrit un aperçu de texte dans l'élément, en gardant le nœud texte de React quand il n'y en a qu'un.
 * `before` : texte d'avant la saisie en place (l'élément montre déjà le texte tapé : sans lui, un refus
 * ne saurait pas quoi rétablir).
 */
function writeText(el: Element, value: string, before?: string) {
  if (el.textContent === value) {
    if (before !== undefined && before !== value && !shown.has(el) && el.childNodes.length <= 1) {
      const marker = document.createComment("pv");
      el.appendChild(marker);
      shown.set(el, { original: before, marker });
    }
    return;
  }
  const mark = shown.get(el);
  if (mark && mark.marker.parentNode === el) {
    // Aperçu déjà posé et React n'a rien réécrit depuis : on ne change que la valeur affichée.
    const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
    if (node) node.nodeValue = value;
    else el.insertBefore(document.createTextNode(value), mark.marker);
    return;
  }
  shown.delete(el);
  const single = el.childNodes.length === 0 || (el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE);
  if (!single) {
    // Plusieurs nœuds (balisage dans le texte) : on garde les nœuds d'origine pour les remettre au retrait
    // (refus, échec, Annuler). Le marqueur dit, comme pour un seul nœud, si React a réécrit entre-temps.
    const nodes = [...el.childNodes];
    const marker = document.createComment("pv");
    el.replaceChildren(document.createTextNode(value), marker);
    shown.set(el, { original: "", marker, nodes });
    return;
  }
  const original = el.textContent ?? "";
  if (el.firstChild) el.firstChild.nodeValue = value;
  else el.appendChild(document.createTextNode(value));
  const marker = document.createComment("pv");
  el.appendChild(marker);
  shown.set(el, { original, marker });
}

/** Retire l'aperçu d'un élément : si React n'a rien réécrit, la valeur d'origine revient. */
function restoreText(el: Element) {
  const mark = shown.get(el);
  if (!mark) return;
  shown.delete(el);
  if (mark.marker.parentNode !== el || el.hasAttribute("data-editing")) return;
  if (mark.nodes) el.replaceChildren(...mark.nodes);
  else el.textContent = mark.original;
}

/** Textes d'un bloc (`data-inline`) ou du site (`data-site-inline`) visés par un aperçu. */
function textElements(target: { uid: string; path: string } | { field: string; index?: number; key?: string }): HTMLElement[] {
  if ("uid" in target) {
    const block = document.querySelector(`[data-edit-block="${CSS.escape(target.uid)}"]`);
    return [...(block?.querySelectorAll<HTMLElement>(`[data-inline="${CSS.escape(target.path)}"]`) ?? [])].filter((e) => e.closest("[data-edit-block]") === block);
  }
  // Lien du menu : repéré par sa clé (l'index du DOM peut être celui d'avant un aperçu de déplacement).
  return [...document.querySelectorAll<HTMLElement>(`[data-site-inline="${CSS.escape(target.field)}"]`)].filter((e) =>
    target.key !== undefined ? e.closest("[data-nav-key]")?.getAttribute("data-nav-key") === target.key : target.index === undefined || e.dataset.navIndex === String(target.index),
  );
}

/** Texte posé en place : montré tel quel jusqu'à ce que le serveur le rende. */
export function previewText(target: { uid: string; path: string } | { field: string; index?: number; key?: string }, value: string, seq: number, original?: string) {
  const key = "uid" in target ? `text:${target.uid}:${target.path}` : `site-text:${target.field}:${target.key ?? target.index ?? ""}`;
  setOverlay(key, seq, {
    apply: () => {
      for (const el of textElements(target)) if (!el.hasAttribute("data-editing")) writeText(el, value, original);
    },
    clear: () => {
      for (const el of textElements(target)) restoreText(el);
    },
  });
}

/**
 * Texte à passage surligné (accroche de l'ouverture, plusieurs nœuds) : l'aperçu est un élément
 * À NOUS posé à côté de l'enveloppe de React (cachée), voir marked-edit.ts. React ne perd aucun nœud ;
 * le retrait (acquittement, refus, échec, navigation) enlève l'aperçu et rend l'enveloppe d'origine.
 */
export function previewMarked(target: { uid: string; path: string }, markup: string, seq: number) {
  setOverlay(`marked:${target.uid}:${target.path}`, seq, {
    apply: () => {
      for (const el of textElements(target)) {
        if (el.hasAttribute("data-editing")) continue;
        const body = el.querySelector<HTMLElement>(":scope > [data-marked-body]");
        if (!body) continue;
        let over = el.querySelector<HTMLElement>(":scope > [data-marked-over]");
        if (!over) {
          over = document.createElement("span");
          over.setAttribute("data-marked-over", "");
          body.after(over);
        }
        if (over.dataset.markup !== markup) {
          over.dataset.markup = markup;
          over.replaceChildren(...markedNodes(parseMarked(markup)));
        }
        body.style.display = "none";
      }
    },
    clear: () => {
      for (const el of textElements(target)) {
        el.querySelector(":scope > [data-marked-over]")?.remove();
        const body = el.querySelector<HTMLElement>(":scope > [data-marked-body]");
        if (body) body.style.display = "";
      }
    },
  });
}

/**
 * Texte d'un projet (titre, contexte, présentation, année) ou d'une place de planche, posé depuis la toile :
 * montré partout où le projet apparaît (planche, titre lié d'un autre bloc) jusqu'au rendu du serveur.
 */
export function previewBoardText(target: { board: number; field: string; key?: string }, value: string, seq: number) {
  const base = `[data-edit-board="${target.board}"]`;
  const sel = target.key !== undefined ? `${base} [data-edit-slot="${CSS.escape(target.key)}"] [data-slot-inline="${CSS.escape(target.field)}"]` : `${base} [data-project-inline="${CSS.escape(target.field)}"]`;
  setOverlay(`board-text:${target.board}:${target.key ?? ""}:${target.field}`, seq, {
    apply: () => {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) if (!el.hasAttribute("data-editing")) writeText(el, value);
    },
    clear: () => {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) restoreText(el);
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

/** Taille des images des entrées de collection : l'attribut suffit, le CSS (look.css) règle colonnes et plafond. */
export function previewTileSize(uid: string, size: string, seq: number) {
  setOverlay(`tile-size:${uid}`, seq, {
    apply: () => {
      const tiles = document.querySelector(`[data-edit-block="${CSS.escape(uid)}"] .tiles`);
      if (tiles && tiles.getAttribute("data-size") !== size) tiles.setAttribute("data-size", size);
    },
  });
}

/* ---- Listes du site : menu, réseaux, champs d'un formulaire (v0.16) ------------------------ */

/**
 * Ajouter, retirer, déplacer un lien, un réseau ou un champ : montré tout de suite, SANS toucher aux
 * nœuds de React (aucun nœud n'est déplacé ni retiré) :
 * - ordre : la propriété CSS `order` (l'élément reste à sa place dans le DOM) ; un conteneur de bloc
 *   (liste, `space-y`) passe en colonne flex le temps de l'aperçu (`data-pv-list`) ;
 * - retrait : l'élément est caché (`display: none`) ;
 * - ajout : un élément « fantôme » à nous (copie d'un voisin, en opacité réduite, non interactif) ;
 * - modification d'un lien : état « en cours » (`data-pending`) sur l'élément.
 * Chaque élément se reconnaît par une CLÉ STABLE (`data-nav-key`, `data-social-key`, `data-form-field-id`) :
 * l'aperçu se rejoue sur n'importe quel rendu du serveur (en retard, ou déjà à jour) sans jamais doubler.
 * Les opérations sont rejouées dans l'ordre sur les clés du DOM ; un acquittement ou un refus retire
 * celles de son numéro, et le rendu reprend ce qui reste (ou tout enlève).
 */
export type ListOp =
  | { t: "remove"; key: string }
  | { t: "move"; key: string; to: number }
  | { t: "add"; key: string; label: string }
  | { t: "pending"; key: string };

type ListSpec = { attr: string; scope?: string };

function listSpec(list: string): ListSpec {
  if (list === "nav") return { attr: "data-nav-key" };
  if (list === "social") return { attr: "data-social-key" };
  return { attr: "data-form-field-id", scope: `[data-edit-block="${CSS.escape(list.slice(5))}"] ` };
}

/** Éléments d'une liste, par conteneur (un menu existe en-tête, pied de page, menu mobile). */
function listGroups(list: string): HTMLElement[][] {
  const { attr, scope = "" } = listSpec(list);
  const groups = new Map<Element, HTMLElement[]>();
  for (const el of document.querySelectorAll<HTMLElement>(`${scope}[${attr}]:not([data-pv-ghost])`)) {
    const parent = el.parentElement;
    if (!parent) continue;
    groups.set(parent, [...(groups.get(parent) ?? []), el]);
  }
  return [...groups.values()];
}

const keyOf = (list: string, el: HTMLElement) => el.getAttribute(listSpec(list).attr) ?? "";

type ListModel = { keys: string[]; labels: Map<string, string>; pending: Set<string> };

/** Clés du DOM (le plus fourni des conteneurs) puis opérations rejouées dans l'ordre. */
function listModel(list: string): ListModel {
  const groups = listGroups(list);
  const base = [...(groups.sort((a, b) => b.length - a.length)[0] ?? [])].map((el) => keyOf(list, el));
  const keys = [...base];
  const labels = new Map<string, string>();
  const pending = new Set<string>();
  for (const op of overlayList<ListOp>(`list:${list}:`)) {
    const i = keys.indexOf(op.key);
    if (op.t === "remove") {
      if (i >= 0) keys.splice(i, 1);
    } else if (op.t === "move") {
      if (i >= 0) {
        keys.splice(i, 1);
        keys.splice(Math.max(0, Math.min(keys.length, op.to)), 0, op.key);
      }
    } else if (op.t === "add") {
      if (i < 0) keys.push(op.key);
      labels.set(op.key, op.label);
    } else pending.add(op.key);
  }
  return { keys, labels, pending };
}

/** Ordre (et contenu) de la liste tel que l'utilisateur doit le voir : DOM + aperçus en attente. */
export function listKeys(list: string): string[] {
  return listModel(list).keys;
}

const ORDER_BASE = 1000;

/** Retire de la liste tout ce que l'aperçu a posé. */
function stripList(list: string) {
  const { attr, scope = "" } = listSpec(list);
  for (const el of document.querySelectorAll<HTMLElement>(`${scope}[${attr}][data-pv-ghost]`)) el.remove();
  for (const el of document.querySelectorAll<HTMLElement>(`${scope}[${attr}][data-pv]`)) {
    el.style.removeProperty("order");
    el.style.removeProperty("display");
    el.removeAttribute("data-pv");
    el.removeAttribute("data-pending");
    el.parentElement?.removeAttribute("data-pv-list");
  }
}

/** Fantôme d'un élément ajouté : copie d'un voisin, sans identifiant ni repère d'édition, libellé remplacé. */
function ghostOf(template: HTMLElement, list: string, key: string, label: string): HTMLElement {
  const g = template.cloneNode(true) as HTMLElement;
  g.removeAttribute("id");
  for (const el of [g, ...g.querySelectorAll<HTMLElement>("*")]) {
    for (const a of [...el.attributes]) {
      if (a.name === "id" || a.name.startsWith("data-") || a.name === "href" || a.name === "for" || a.name === "name" || a.name === "title") el.removeAttribute(a.name);
    }
    if (el.tagName === "svg" || el.tagName === "SVG") el.remove();
  }
  g.style.removeProperty("display");
  g.style.removeProperty("order");
  g.setAttribute(listSpec(list).attr, key);
  g.setAttribute("data-pv-ghost", "");
  g.setAttribute("data-pending", "");
  g.setAttribute("aria-hidden", "true");
  g.setAttribute("inert", "");
  // Libellé : le premier texte visible de la copie (lien, libellé d'un champ).
  const walker = document.createTreeWalker(g, NodeFilter.SHOW_TEXT);
  let first: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (n.nodeValue?.trim()) {
      if (!first) first = n;
      else n.nodeValue = "";
    }
  }
  if (first) first.nodeValue = label;
  else g.append(document.createTextNode(label));
  // Champ de formulaire : rien à remplir dans un fantôme.
  for (const el of g.querySelectorAll("input, textarea, select")) (el as HTMLElement).setAttribute("tabindex", "-1");
  return g;
}

/** (Ré)applique l'aperçu d'une liste : ordre, retraits, fantômes, états « en cours ». Sans opération en attente : tout est retiré. */
function renderList(list: string) {
  if (!overlayList<ListOp>(`list:${list}:`).length) return stripList(list);
  const model = listModel(list);
  const attr = listSpec(list).attr;
  for (const group of listGroups(list)) {
    const parent = group[0].parentElement!;
    const byKey = new Map(group.map((el) => [keyOf(list, el), el]));
    // Un conteneur qui n'est ni flex ni grille n'obéit pas à `order` : colonne flex le temps de l'aperçu.
    if (!parent.hasAttribute("data-pv-list") && !/flex|grid/.test(getComputedStyle(parent).display)) parent.setAttribute("data-pv-list", "");
    for (const [key, el] of byKey) {
      el.setAttribute("data-pv", "");
      const i = model.keys.indexOf(key);
      if (i < 0) {
        el.style.display = "none";
        continue;
      }
      el.style.removeProperty("display");
      el.style.order = String(i - ORDER_BASE);
      el.toggleAttribute("data-pending", model.pending.has(key));
    }
    const template = group.at(-1);
    model.keys.forEach((key, i) => {
      if (byKey.has(key) || !template) return;
      let g = [...parent.children].find((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute("data-pv-ghost") && c.getAttribute(attr) === key);
      if (!g) {
        g = ghostOf(template, list, key, model.labels.get(key) ?? "");
        template.after(g);
      }
      g.style.order = String(i - ORDER_BASE);
    });
    // Fantômes devenus inutiles (retirés du modèle, ou l'élément réel est arrivé).
    for (const c of [...parent.children]) {
      if (c instanceof HTMLElement && c.hasAttribute("data-pv-ghost") && (byKey.has(c.getAttribute(attr) ?? "") || !model.keys.includes(c.getAttribute(attr) ?? ""))) c.remove();
    }
  }
}

/** Opération sur une liste du site : montrée tout de suite, retirée à l'acquittement ou au refus (son numéro). */
export function previewList(list: string, op: ListOp, seq: number) {
  setOverlay(`list:${list}:${seq}`, seq, { data: op, apply: () => renderList(list), clear: () => renderList(list) });
}

/* ---- Carte de rubrique (lot 17c) ------------------------------------------------------------ */

const PALETTE_VARS: Record<keyof CardPalette, string> = {
  bg: "--t-color-bg",
  bgDeep: "--t-color-bg-deep",
  surface: "--t-color-surface",
  ink: "--t-color-ink",
  inkSoft: "--t-color-ink-soft",
  primary: "--t-color-primary",
  primaryHover: "--t-color-primary-hover",
  onPrimary: "--t-color-on-primary",
  secondary: "--t-color-secondary",
  tertiary: "--t-color-tertiary",
  eyebrow: "--t-color-eyebrow",
};

/** Palette du thème lue sur la toile (variables émises par le layout) : mêmes entrées que le serveur. */
export function canvasPalette(): CardPalette {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as Record<string, string>;
  // Ornements : transparence acceptée, gardée telle quelle (la teinte douce se lit sur le fond de page).
  for (const [key, name] of Object.entries(PALETTE_VARS)) out[key] = key === "tertiary" ? cs.getPropertyValue(name).trim() : toHex(parseColor(cs.getPropertyValue(name).trim())?.rgb ?? [0, 0, 0]);
  return out as CardPalette;
}

/**
 * Palette du site en aperçu (lot 17f) : les variables `--card-*` d'une carte sont des valeurs calculées, pas des
 * références ; elles sont recalculées sur la palette qu'affiche la toile. Une carte dont l'aperçu attend encore
 * l'acquittement (previewSurface) garde le sien.
 */
export function refreshCards() {
  const palette = canvasPalette();
  for (const el of document.querySelectorAll<HTMLElement>('.surface-card[data-surface="on"][data-edit-surface]')) {
    if (surfaceOriginal.has(el)) continue;
    const surface = readSurface(parseData<unknown>(el.dataset.editSurface));
    if (!surface) continue;
    const resolved = resolveSurface(surface, parseData<ResolvedSurface>(el.dataset.cardDefault) ?? undefined);
    const style = cardStyle(resolved.color, palette);
    for (const [k, v] of Object.entries({ ...cardVars(style), ...borderVars(resolved, style, palette) })) el.style.setProperty(k, v);
  }
  // Fonds de couleur des composants (lot 32) : même recalcul sur la palette affichée.
  for (const el of document.querySelectorAll<HTMLElement>('.fond-bloc[data-fond="on"][data-edit-background]')) {
    if (fondOriginal.has(el)) continue;
    const bg = readBackground(parseData<unknown>(el.dataset.editBackground));
    if (!bg) continue;
    for (const [k, v] of Object.entries(fondStyle(bg, palette).vars)) el.style.setProperty(k, v);
  }
}

/** Enveloppe de la carte d'un bloc de premier niveau (toujours présente en vue brouillon). */
function surfaceWrapper(uid: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(uid)}"] > .surface-card`);
}

function parseData<T>(raw: string | undefined): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Carte du bloc telle qu'on doit la voir (aperçu en attente, sinon page rendue) et réglages par défaut du thème. */
export function surfaceState(uid: string): { surface: Surface | null; defaults: ResolvedSurface } {
  const el = surfaceWrapper(uid);
  const defaults = parseData<ResolvedSurface>(el?.dataset.cardDefault) ?? FALLBACK_CARD;
  const pending = entries.get(`surface:${uid}`);
  if (pending) return { surface: (pending.data as { surface: Surface | null }).surface, defaults };
  return { surface: readSurface(parseData(el?.dataset.editSurface)) ?? null, defaults };
}

/** État de l'enveloppe avant l'aperçu, pour le rétablir (refus, échec). */
const surfaceOriginal = new WeakMap<Element, { attrs: Record<string, string | null>; style: string | null }>();
const SURFACE_ATTRS = ["data-surface", "data-width", "data-corners", "data-paper", "data-border", "data-join-prev", "data-join-next"];

/**
 * Carte posée (ou retirée) depuis la toile : montrée tout de suite — attributs et variables CSS de
 * l'enveloppe —, gardée jusqu'à l'acquittement du serveur, rétablie si l'écriture est refusée. Le serveur
 * rend ensuite un bloc neuf (sa clé suit les props) : l'enveloppe d'aperçu disparaît avec l'ancien nœud.
 */
export function previewSurface(uid: string, surface: Surface | null, seq: number) {
  setOverlay(`surface:${uid}`, seq, {
    data: { surface },
    apply: () => {
      const el = surfaceWrapper(uid);
      if (!el) return;
      if (!surfaceOriginal.has(el)) surfaceOriginal.set(el, { attrs: Object.fromEntries(SURFACE_ATTRS.map((a) => [a, el.getAttribute(a)])), style: el.getAttribute("style") });
      for (const a of SURFACE_ATTRS) el.removeAttribute(a);
      el.removeAttribute("style");
      if (!surface) {
        el.setAttribute("data-surface", "off");
        refreshFondJoins(uid);
        return;
      }
      const resolved = resolveSurface(surface, parseData<ResolvedSurface>(el.dataset.cardDefault) ?? undefined);
      for (const [k, v] of Object.entries(surfaceAttributes(resolved))) el.setAttribute(k, v);
      const palette = canvasPalette();
      const style = cardStyle(resolved.color, palette);
      for (const [k, v] of Object.entries({ ...cardVars(style), ...borderVars(resolved, style, palette) })) el.style.setProperty(k, v);
      const paper = paperAttributes(surface);
      for (const [k, v] of Object.entries(paper.attrs)) el.setAttribute(k, v);
      for (const [k, v] of Object.entries(paper.vars)) el.style.setProperty(k, v);
      refreshFondJoins(uid);
    },
    clear: () => {
      const el = surfaceWrapper(uid);
      const before = el && surfaceOriginal.get(el);
      if (!el || !before) return;
      surfaceOriginal.delete(el);
      for (const [a, v] of Object.entries(before.attrs)) {
        if (v === null) el.removeAttribute(a);
        else el.setAttribute(a, v);
      }
      if (before.style === null) el.removeAttribute("style");
      else el.setAttribute("style", before.style);
      refreshFondJoins(uid);
    },
  });
}

/* ---- Fond de couleur d'un composant (lot 32, src/themes/fond.ts) ------------------------------------------- */

/** Enveloppe du fond d'un composant (celle de CE bloc, jamais celle d'un composant de son conteneur). */
function fondWrapper(uid: string): HTMLElement | null {
  const host = document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(uid)}"]`);
  return host?.querySelector<HTMLElement>(':scope > .fond-bloc, :scope > .surface-card > .fond-bloc') ?? null;
}

/** Ce composant porte-t-il une enveloppe de fond (grand composant hors cellule de grille) ? */
export function hasFondWrapper(uid: string): boolean {
  return fondWrapper(uid) !== null;
}

/** Fond du composant tel qu'on doit le voir (aperçu en attente, sinon page rendue). */
export function fondState(uid: string): Background | null {
  const pending = entries.get(`fond:${uid}`);
  if (pending) return (pending.data as { background: Background | null }).background;
  return readBackground(parseData(fondWrapper(uid)?.dataset.editBackground)) ?? null;
}

const fondOriginal = new WeakMap<Element, { attrs: Record<string, string | null>; style: string | null }>();
const FOND_ATTRS = ["data-fond", "data-join-prev", "data-join-next", "data-edit-background"];

/**
 * Fusion des voisins recalculée sur la page affichée (aperçu d'un fond ou d'une carte) : mêmes règles que le serveur
 * (`fondJoins`) mais lues dans le DOM de la toile. Les frères d'un bloc sont les enveloppes d'édition de même parent.
 */
export function refreshFondJoins(uid: string) {
  const host = document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(uid)}"]`);
  const parent = host?.parentElement;
  if (!parent) return;
  const hosts = [...parent.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute("data-edit-block"));
  const parts = hosts.map((h) => {
    const wrap = h.querySelector<HTMLElement>(':scope > .fond-bloc, :scope > .surface-card > .fond-bloc');
    const card = h.querySelector<HTMLElement>(':scope > .surface-card[data-surface="on"]');
    const bg = wrap?.dataset.fond === "on" ? readBackground(parseData(wrap.dataset.editBackground)) : undefined;
    // Même signature que le serveur (`cardBorderSignature`) : largeur + couleur calculée de la bordure.
    const border = card?.dataset.border ? `${card.dataset.border}/${card.style.getPropertyValue("--card-bc")}` : "";
    return { wrap, card, key: fondKey(bg, Boolean(card), border) };
  });
  const joins = fondJoins(parts.map((p) => p.key));
  parts.forEach((p, i) => {
    for (const el of [p.wrap, p.card]) {
      if (!el) continue;
      for (const a of ["data-join-prev", "data-join-next"]) el.removeAttribute(a);
      if (joins[i].prev) el.setAttribute("data-join-prev", "");
      if (joins[i].next) el.setAttribute("data-join-next", "");
    }
  });
}

/**
 * Fond posé (ou retiré) depuis la toile : montré tout de suite (attributs et variables de l'enveloppe, fusion des voisins),
 * gardé jusqu'à l'acquittement, rétabli si l'écriture est refusée — même principe que `previewSurface`.
 */
export function previewFond(uid: string, background: Background | null, seq: number) {
  setOverlay(`fond:${uid}`, seq, {
    data: { background },
    apply: () => {
      const el = fondWrapper(uid);
      if (!el) return;
      if (!fondOriginal.has(el)) fondOriginal.set(el, { attrs: Object.fromEntries(FOND_ATTRS.map((a) => [a, el.getAttribute(a)])), style: el.getAttribute("style") });
      for (const a of FOND_ATTRS) el.removeAttribute(a);
      el.removeAttribute("style");
      if (background) el.setAttribute("data-edit-background", JSON.stringify(background));
      if (!background) el.setAttribute("data-fond", "off");
      else {
        for (const [k, v] of Object.entries(fondAttributes({ prev: false, next: false }))) el.setAttribute(k, v);
        for (const [k, v] of Object.entries(fondStyle(background, canvasPalette()).vars)) el.style.setProperty(k, v);
      }
      refreshFondJoins(uid);
    },
    clear: () => {
      const el = fondWrapper(uid);
      const before = el && fondOriginal.get(el);
      if (!el || !before) return;
      fondOriginal.delete(el);
      for (const [a, v] of Object.entries(before.attrs)) {
        if (v === null) el.removeAttribute(a);
        else el.setAttribute(a, v);
      }
      if (before.style === null) el.removeAttribute("style");
      else el.setAttribute("style", before.style);
      refreshFondJoins(uid);
    },
  });
}
