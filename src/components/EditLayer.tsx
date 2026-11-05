"use client";

/**
 * Couche d'édition de la toile de l'éditeur visuel. Rendue seulement en vue
 * brouillon (admin vérifié, draft mode, cookie de la toile : voir
 * src/lib/draft-view.ts) et inactive tant que la fenêtre parente — l'éditeur,
 * même origine — ne l'a pas allumée (`mode`). En « aperçu », elle ne dessine
 * rien : la page est exactement celle du brouillon.
 *
 * Elle repère les blocs par leurs enveloppes (data-edit-block, posées par
 * BlockList ; `data-edit-parent` pour un composant de conteneur) et dessine
 * par-dessus, dans un calque à part : contour au survol, étiquette (fil
 * d'Ariane « Projet mis en avant › Planche » pour un composant), barre
 * d'outils, poignée, repère d'insertion pendant un glisser — entre deux blocs
 * de la page, ou DANS un conteneur (ligne intérieure + cadre du conteneur
 * en évidence ; cadre rouge si le conteneur refuse ce composant). En-tête et
 * pied de page (`data-edit-global`) : contour et étiquette « commun à toutes
 * les pages ». Textes déclarés `inline` (data-inline) et textes du site
 * (data-site-inline) : double-clic, double-tap (toucher), ou Entrée sur le bloc choisi. Toute
 * modification part vers l'éditeur, qui tient le brouillon, l'enregistre
 * puis demande un rafraîchissement.
 */
import { NATIVE_SCROLL } from "@/components/rail-step";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { TILE_SIZE_LABELS, TILE_SIZES } from "@/blocks/collection-pages";
import { FIELD_OP_NAMES } from "@/blocks/optional-fields";
import { MAX_NESTING } from "@/blocks/tree";
import { acceptToCanvas, insertionIndex, moveTo, type BlockInfo, type FromCanvas } from "@/lib/edit/protocol";

import BoardLayer from "./BoardLayer";
import LookLayer, { lookOf, sendOwnMediaLook } from "./edit/LookLayer";
import type { ImageBg } from "@/lib/look";
import SiteLookLayer from "./edit/SiteLookLayer";
import FreeLayer from "./edit/FreeLayer";
import GridLayer from "./edit/GridLayer";
import { gridRefOf } from "./edit/grid-dom";
import { listKeys, noteSettle, observeOverlays, pendingOrder, postIntent, previewMarked, previewOrder, previewText, previewTileSize, resetOverlays, revertOverlay, siblingWrappers } from "./edit/optimistic";
import { parseMarked } from "@/lib/marked";
import { closeMarkedEditor, markedNodes, markState, markupOf, openMarkedEditor, selectionRange, selectRange, toggleMark, type MarkedEditor } from "./edit/marked-edit";
import FondMenu, { FondButton } from "./edit/FondMenu";
import { hasFondWrapper } from "./edit/optimistic";
import FrameWindow, { FrameButton } from "./edit/FrameMenu";
import QuickMenu, { QuickButton, type QuickKind } from "./edit/QuickMenus";
import ImageBgWindow, { ImageBgButton } from "./edit/ImageBgMenu";
import { holdForAa, inAaUi, savedRange } from "./edit/aa-focus";
import Popover from "./edit/Popover";
import SiteLayer, { FormLayer } from "./SiteLayer";

import "@/app/admin/edit-layer.css";

type Rect = { top: number; left: number; width: number; height: number };
type Box = BlockInfo & Rect & { depth: number; accepts: string[] | null };
type Mode = "off" | "edit" | "preview";
type Drag = { source: "canvas"; uid: string; label: string; x: number; y: number } | { source: "palette"; label: string; x: number; y: number };
/** Où un dépôt irait : la page ou un conteneur, à un rang ; `refused` : conteneur qui n'accepte pas. */
type Drop = { parent: string | null; index: number; refused?: boolean };

const EDGE = 64;
const GLOBAL_UIDS: Record<string, string> = { header: "site-header", footer: "site-footer" };

/** Envoie une intention (numérotée : voir edit/optimistic.ts) ; renvoie son numéro. */
function post(msg: FromCanvas): number {
  return postIntent(msg);
}

const orderOf = (parent: string | null) => pendingOrder(parent) ?? siblingWrappers(parent).map((e) => e.dataset.editBlock ?? "");

/**
 * Ordre des enfants d'un parent après avoir déplacé `uid` à `to` (index compté
 * avant le retrait, comme l'éditeur), en partant de l'ordre voulu en attente
 * s'il y en a un, sinon de celui de la page. Aperçu immédiat, gardé jusqu'à
 * l'acquittement du serveur. Sans effet entre deux parents différents (le DOM
 * de React ne se déplace pas d'un parent à l'autre).
 */
function previewMove(seq: number, uid: string, parent: string | null, to: number) {
  const base = orderOf(parent);
  const from = base.indexOf(uid);
  if (from < 0) return;
  previewOrder(parent, moveTo(base, from, to), seq);
}

/** Choix de la page de collection d'une nouvelle entrée (lot 22) : se ferme d'un clic ailleurs. */
function TilePagePicker({ anchor, uid, items, onClose }: { anchor: Element; uid: string; items: { pageId: number; title: string }[]; onClose: () => void }) {
  return (
    <Popover anchor={anchor} className="pe-layouts pe-tile-pick" role="menu" label="Page de la nouvelle entrée" onClose={onClose}>
      {items.map((p) => (
        <button
          key={p.pageId}
          type="button"
          role="menuitem"
          onClick={() => {
            post({ kind: "tile-op", uid, op: "add", pageId: p.pageId });
            onClose();
          }}
        >
          {p.title}
        </button>
      ))}
    </Popover>
  );
}

/** Taille des images des entrées de collection (lot 22) : se ferme d'un clic ailleurs. */
function TileSizePicker({ uid, onClose }: { uid: string; onClose: () => void }) {
  const [current, setCurrent] = useState(() => document.querySelector(`[data-edit-block="${CSS.escape(uid)}"] .tiles`)?.getAttribute("data-size") ?? "medium");
  return (
    <Popover anchor='.pe-tools [data-anchor="tile-size"]' className="pe-layouts pe-sizes" role="radiogroup" label="Taille des images" onClose={onClose}>
      {TILE_SIZES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={current === s}
          onClick={() => {
            const seq = post({ kind: "tile-size", uid, size: s });
            previewTileSize(uid, s, seq);
            setCurrent(s);
          }}
        >
          {TILE_SIZE_LABELS[s]}
        </button>
      ))}
    </Popover>
  );
}

/** Boîte d'un élément en coordonnées du document (enveloppes display: contents : réunion des enfants, récursivement). */
export function rectOf(el: Element): Rect | null {
  const own = el.getBoundingClientRect();
  let r: { top: number; left: number; right: number; bottom: number } | null = own.width || own.height ? { top: own.top, left: own.left, right: own.right, bottom: own.bottom } : null;
  if (!r) {
    for (const child of el.children) {
      const b = rectOf(child);
      if (!b) continue;
      const cb = { top: b.top - window.scrollY, left: b.left - window.scrollX, right: b.left - window.scrollX + b.width, bottom: b.top - window.scrollY + b.height };
      r = r ? { top: Math.min(r.top, cb.top), left: Math.min(r.left, cb.left), right: Math.max(r.right, cb.right), bottom: Math.max(r.bottom, cb.bottom) } : cb;
    }
  }
  return r ? { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.right - r.left, height: r.bottom - r.top } : null;
}

/**
 * Le site (hors calque d'édition) montre-t-il du texte, une image ou un bouton au point (x, y) de la fenêtre ?
 * Sert à poser l'étiquette d'un bloc là où elle ne recouvre rien (lot 24).
 */
function contentAt(x: number, y: number): boolean {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === document.documentElement || el === document.body || el.closest(".pe-layer")) continue;
    // Décor (calques de l'ouverture, filets) : aria-hidden ou image sans texte alternatif, il ne compte pas.
    const decor = el.closest('[aria-hidden="true"]') !== null || (el instanceof HTMLImageElement && el.alt === "");
    if (!decor && el.matches("img, video, svg, canvas, input, textarea, select, button, a[href], [data-inline]")) return true;
    for (const n of el.childNodes) {
      if (n.nodeType !== Node.TEXT_NODE || !n.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const q of range.getClientRects()) if (x >= q.left && x <= q.right && y >= q.top && y <= q.bottom) return true;
    }
  }
  return false;
}

/** Une boîte (coordonnées du document) recouvrirait-elle du contenu du site ? Points hors de la fenêtre : ignorés. */
export function coversContent(r: Rect): boolean {
  const xs: number[] = [];
  // Marge de 2 px autour de l'étiquette : un texte qui la frôle compte.
  for (let x = r.left - 2; x < r.left + r.width + 2; x += 16) xs.push(x);
  xs.push(r.left + r.width + 2);
  for (const y of [r.top - 2, r.top + r.height / 2, r.top + r.height - 1]) {
    const vy = y - window.scrollY;
    if (vy < 0 || vy >= window.innerHeight) continue;
    for (const x of xs) {
      const vx = x - window.scrollX;
      if (vx >= 0 && vx < window.innerWidth && contentAt(vx, vy)) return true;
    }
  }
  return false;
}

function measure(): Box[] {
  let lastBottom = 0;
  return [...document.querySelectorAll<HTMLElement>("[data-edit-block]")].map((el) => {
    const parent = el.dataset.editParent;
    const info = {
      uid: el.dataset.editBlock ?? "",
      type: el.dataset.editType ?? "",
      label: el.dataset.editLabel ?? "",
      ...(parent ? { parent } : {}),
      depth: [...ancestorsOf(el)].length,
      accepts: el.dataset.editContainer !== undefined ? el.dataset.editContainer.split(" ").filter(Boolean) : null,
    };
    const r = rectOf(el);
    if (!r) return { ...info, top: lastBottom, left: 0, width: document.documentElement.clientWidth, height: 0 };
    if (!parent) lastBottom = r.top + r.height;
    return { ...info, ...r };
  });
}

/** Conteneurs qui englobent un bloc (du plus proche au plus haut). */
function* ancestorsOf(el: Element): Generator<HTMLElement> {
  let cur = el.parentElement?.closest<HTMLElement>("[data-edit-block]");
  while (cur) {
    yield cur;
    cur = cur.parentElement?.closest<HTMLElement>("[data-edit-block]");
  }
}

function markerY(boxes: Box[], index: number): number {
  const top = boxes.filter((b) => !b.parent);
  if (!top.length) {
    const main = document.getElementById("contenu");
    return (main?.getBoundingClientRect().top ?? 0) + window.scrollY + 24;
  }
  if (index <= 0) return top[0].top;
  if (index >= top.length) return top[top.length - 1].top + top[top.length - 1].height;
  const prev = top[index - 1];
  return (prev.top + prev.height + top[index].top) / 2;
}

/** Distance (px) du pointeur à une frontière entre deux rubriques pour y proposer « + » (lot 17c). */
const GAP_REACH = 16;

/**
 * Frontière entre deux rubriques de la page proche de y (coordonnées du document) : rang d'insertion et
 * position du « + ». Avant la première rubrique et entre deux ; la fin de page a son bouton fixe.
 */
function gapAt(boxes: Box[], y: number): { index: number; top: number } | null {
  const top = boxes.filter((b) => !b.parent && b.height > 0);
  for (let i = 0; i < top.length; i++) {
    const edge = i === 0 ? top[0].top : (top[i - 1].top + top[i - 1].height + top[i].top) / 2;
    if (Math.abs(y - edge) <= GAP_REACH) return { index: i, top: edge };
  }
  return null;
}

/** Rang d'insertion parmi des boîtes en ordre de lecture (lignes, puis gauche → droite). */
function readingIndex(children: Rect[], x: number, y: number): number {
  let i = 0;
  for (const c of children) {
    const before = c.top + c.height < y || (c.top <= y && c.left + c.width / 2 < x);
    if (before) i++;
  }
  return i;
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Pas de sélection de texte du navigateur pendant un glisser. */
function clearSelection() {
  try {
    window.getSelection()?.removeAllRanges();
  } catch {}
}

type Editing = {
  /** Numéro de la saisie : un `blur` tardif d'une saisie précédente (même élément) ne doit pas fermer la suivante. */
  id: number;
  el: HTMLElement;
  original: string;
  target: { kind: "block"; uid: string } | { kind: "site"; field: string; index?: number };
  /** Texte à passage surligné (accroche) : champ à part, voir edit/marked-edit.ts. */
  marked?: MarkedEditor;
  /** Dernière sélection connue dans le champ (positions du texte brut) : elle ne survit pas au remontage du bloc. */
  sel?: [number, number] | null;
  /** Texte brut (champ sans passage surligné) tel que l'utilisateur l'a laissé : rétabli si un rendu le réécrit. */
  text?: string;
  /** Une saisie de l'utilisateur est en cours de traitement (entre `beforeinput` et `input`) : pas une réécriture du serveur. */
  typing?: boolean;
  /** Composition (IME, touche morte) en cours : le texte du champ contient une saisie non validée, on n'y touche pas. */
  composing?: boolean;
  /** Focus passé à la barre « Aa » (liste native, champ de la barre) : la saisie est tenue, pas finie (edit/aa-focus.ts). */
  hold?: AbortController;
  /** Écouteurs de la saisie (champ sans passage surligné) : retirés d'un coup à la fin de la saisie. */
  ac?: AbortController;
};
/** Barre « Surligner » de l'accroche : position (coordonnées du document) et état du bouton. */
type MarkBar = { top: number; left: number; below: boolean; state: boolean | null };

export default function EditLayer() {
  const router = useRouter();
  const pathname = usePathname();
  // Navigation interne de la toile : les aperçus de la page quittée (uid `b0…` réutilisés) ne s'appliquent pas à la suivante.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    resetOverlays();
  }, [pathname]);
  const [mode, setMode] = useState<Mode>("off");
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [globals, setGlobals] = useState<(Rect & { uid: string; label: string })[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [viewTop, setViewTop] = useState(0);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** Bloc grille dont le choix d'agencement est ouvert. */
  const [sizeFor, setSizeFor] = useState<string | null>(null);
  const [tilePick, setTilePick] = useState<{ uid: string; anchor: Element; items: { pageId: number; title: string }[] } | null>(null);
  const [projectPicker, setProjectPicker] = useState<string | null>(null);
  const [markBar, setMarkBar] = useState<MarkBar | null>(null);
  /** Bloc dont le menu « Carte » (carte de rubrique) est ouvert ; `bump` redessine après un choix (aperçu optimiste). */
  const [fondFor, setFondFor] = useState<string | null>(null);
  /** Bloc image dont la fenêtre « Cadre » (cadre autour de la photo, lot 34) est ouverte. */
  const [frameFor, setFrameFor] = useState<string | null>(null);
  /** Bloc dont la fenêtre « Taille » (image seule) ou « Espace » (au-dessus) est ouverte (lot 40). */
  const [quickFor, setQuickFor] = useState<{ uid: string; kind: QuickKind } | null>(null);
  /** Bloc image dont la fenêtre « Fond de l'image » (lot 41) est ouverte. */
  const [imgBgFor, setImgBgFor] = useState<string | null>(null);
  const [, bump] = useState(0);
  const toggleQuick = (uid: string, kind: QuickKind) => {
    setFondFor(null);
    setFrameFor(null);
    setQuickFor((o) => (o?.uid === uid && o.kind === kind ? null : { uid, kind }));
  };
  /** « + » proposé entre deux rubriques sous le pointeur. */
  const [gap, setGap] = useState<{ index: number; top: number } | null>(null);
  /** Texte à ouvrir en édition dès que son bloc est rendu (rubrique Texte tout juste ajoutée). */
  const pendingEdit = useRef<{ uid: string; path: string; at: number } | null>(null);
  const tryEditRef = useRef<() => void>(() => {});
  /** Annuler / Rétablir en cours : résultat inconnu de la toile, état « en cours » jusqu'à l'acquittement. */
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const editing = useRef<Editing | null>(null);
  const boxesRef = useRef<Box[]>([]);
  const selectedRef = useRef<string | null>(null);
  const lastOrder = useRef("");
  /** Bloc à amener à l'écran dès qu'il apparaît (ajouté, pas encore rendu). */
  const pendingScroll = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const remeasure = useCallback(() => {
    const next = measure();
    boxesRef.current = next;
    setBoxes(next);
    setGlobals(
      [...document.querySelectorAll<HTMLElement>("[data-edit-global]")]
        .map((el) => ({ uid: GLOBAL_UIDS[el.dataset.editGlobal ?? ""] ?? "", label: el.dataset.editLabel ?? "", rect: rectOf(el) }))
        .filter((g): g is { uid: string; label: string; rect: Rect } => Boolean(g.uid && g.rect))
        .map((g) => ({ uid: g.uid, label: g.label, ...g.rect })),
    );
    setViewTop(window.scrollY);
    if (pendingScroll.current) {
      const box = next.find((b) => b.uid === pendingScroll.current);
      if (box) {
        pendingScroll.current = null;
        window.scrollTo({ top: Math.max(0, box.top - 80), behavior: "smooth" });
      }
    }
    tryEditRef.current();
    const order = next.map((b) => `${b.parent ?? ""}/${b.uid}`).join(",");
    if (order !== lastOrder.current) {
      lastOrder.current = order;
      post({ kind: "blocks", blocks: next.map(({ uid, type, label, parent }) => ({ uid, type, label, ...(parent ? { parent } : {}) })) });
    }
  }, []);

  // Repère « choisi » sur l'enveloppe du bloc (lot 39) : les repères gris des champs vides (Titre / Légende / Date) n'apparaissent
  // que sur un composant survolé ou choisi (edit-layer.css).
  useEffect(() => {
    for (const el of document.querySelectorAll("[data-edit-selected]")) el.removeAttribute("data-edit-selected");
    if (selected) document.querySelector(`[data-edit-block="${CSS.escape(selected)}"]`)?.setAttribute("data-edit-selected", "");
  }, [selected, boxes]);

  const select = useCallback((uid: string | null, notify = true, click = false) => {
    setSelected(uid);
    setQuickFor(null);
    if (notify) post({ kind: "select", uid, ...(click ? { click: true } : {}) });
  }, []);

  // Une seule fenêtre ouverte à la fois (lot 31e) : la fenêtre « Réglages » de la grille ferme Carte, Fond, Cadre ; « Plus de réglages… »
  // choisit la grille comme un clic et ouvre ses réglages dans le panneau de gauche.
  useEffect(() => {
    const closeAll = () => {
      setFondFor(null);
      setFrameFor(null);
      setImgBgFor(null);
      setSizeFor(null);
      setQuickFor(null);
    };
    const openPanel = (e: Event) => {
      const d = (e as CustomEvent<{ uid?: string; board?: number }>).detail;
      if (d?.uid && !d.board) select(d.uid, true, true);
    };
    window.addEventListener("pe:popups-close", closeAll);
    window.addEventListener("pe:open-panel", openPanel);
    return () => {
      window.removeEventListener("pe:popups-close", closeAll);
      window.removeEventListener("pe:open-panel", openPanel);
    };
  }, [select]);

  /* ---- Où déposer : page ou conteneur ------------------------------------ */

  /**
   * Cible d'un dépôt au point (x, y fenêtre) pour un bloc de ce type :
   * conteneur le plus profond sous le point qui l'accepte (marge de 14 px en
   * haut et en bas : entre deux blocs de la page), sinon la page. `moving` :
   * bloc déplacé (jamais dans lui-même ni dans ses composants).
   */
  const dropAt = useCallback((x: number, y: number, type: string | undefined, nesting: number, moving?: string): Drop => {
    const all = boxesRef.current;
    const py = y + window.scrollY;
    const px = x + window.scrollX;
    const inside = (b: Box) => px >= b.left && px <= b.left + b.width && py >= b.top + 14 && py <= b.top + b.height - 14;
    const descendants = new Set<string>();
    if (moving) {
      descendants.add(moving);
      let grew = true;
      while (grew) {
        grew = false;
        for (const b of all) {
          if (b.parent && descendants.has(b.parent) && !descendants.has(b.uid)) {
            descendants.add(b.uid);
            grew = true;
          }
        }
      }
    }
    const containers = all.filter((b) => b.accepts && inside(b) && !descendants.has(b.uid)).sort((a, b) => b.depth - a.depth);
    for (const c of containers) {
      const ok = Boolean(type && c.accepts!.includes(type)) && c.depth + 1 + nesting <= MAX_NESTING;
      if (!ok) {
        // Le plus profond refuse : un conteneur plus haut peut accepter (ex. grille dans un projet mis en avant).
        if (containers.some((o) => o.depth < c.depth && type && o.accepts!.includes(type) && o.depth + 1 + nesting <= MAX_NESTING)) continue;
        return { parent: c.uid, index: 0, refused: true };
      }
      const kids = all.filter((b) => b.parent === c.uid && b.uid !== moving);
      const index = c.type === "grid" ? readingIndex(kids, px, py) : insertionIndex(kids.map((k) => k.top + k.height / 2), py);
      return { parent: c.uid, index };
    }
    const top = all.filter((b) => !b.parent);
    return { parent: null, index: insertionIndex(top.map((b) => b.top + b.height / 2), py) };
  }, []);

  /* ---- Texte en place ---------------------------------------------------- */

  /** Barre « Surligner » : replacée au-dessus (ou sous) l'accroche en cours d'édition, bouton à jour. */
  const refreshMarkBar = useCallback(() => {
    const m = editing.current?.marked;
    const r = m ? rectOf(m.host) : null;
    if (!m || !r) return setMarkBar(null);
    const below = r.top < 52;
    setMarkBar({ top: below ? r.top + r.height + 10 : r.top - 46, left: Math.max(8, r.left), below, state: markState(m.editor) });
  }, []);

  const finishEdit = useCallback((commit: boolean) => {
    const current = editing.current;
    if (!current) return;
    editing.current = null;
    current.ac?.abort();
    current.hold?.abort();
    const { el, original, target, marked } = current;
    // Fin de la saisie : la barre « Aa » de ce texte se ferme (LookLayer).
    queueMicrotask(() => window.dispatchEvent(new CustomEvent("pe:text-end", { detail: { el } })));
    if (marked) {
      // Accroche : le texte est lu dans NOTRE champ (nœuds texte et passages surlignés), jamais du HTML.
      const markup = markupOf(marked.editor);
      closeMarkedEditor(marked);
      el.removeAttribute("data-editing");
      setMarkBar(null);
      if (!commit || markup === marked.before || target.kind !== "block") return;
      const locale = document.documentElement.lang === "en" ? "en" : "fr";
      const seq = post({ kind: "text", uid: target.uid, path: "statement", locale, value: markup });
      previewMarked({ uid: target.uid, path: "statement" }, markup, seq);
      return;
    }
    const value = (el.textContent ?? "").replace(/\s*\n\s*/g, " ");
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-editing");
    if (!commit) {
      el.textContent = original;
      return;
    }
    const locale = document.documentElement.lang === "en" ? "en" : "fr";
    if (value === original) return;
    // Le texte posé reste affiché (edit/optimistic.ts) jusqu'à ce que le serveur le rende.
    if (target.kind === "block") {
      const path = el.dataset.inline ?? "";
      const seq = post({ kind: "text", uid: target.uid, path, locale, value: value.slice(0, 2000) });
      previewText({ uid: target.uid, path }, value.slice(0, 2000), seq, original);
    } else {
      // Lien du menu : rang dans la liste telle que l'éditeur la tient (aperçus de déplacement compris), aperçu sur la clé du lien.
      const navKey = target.field === "nav" ? el.closest("[data-nav-key]")?.getAttribute("data-nav-key") ?? undefined : undefined;
      const rank = navKey !== undefined ? listKeys("nav").indexOf(navKey) : -1;
      const index = rank >= 0 ? rank : target.index;
      const seq = post({ kind: "site-text", field: target.field as "name", ...(index !== undefined ? { index } : {}), ...(navKey ? { key: navKey } : {}), locale, value: value.slice(0, 200) });
      previewText({ field: target.field, ...(navKey !== undefined ? { key: navKey } : index !== undefined ? { index } : {}) }, value.slice(0, 200), seq, original);
    }
  }, []);

  const resumeRef = useRef<(cur: Editing) => void>(() => {});
  const editSeq = useRef(0);
  /** Perte du focus : fin de la saisie, sauf si l'élément a seulement été remplacé par un rendu du serveur. */
  const onEditBlurRef = useRef<(id: number, ev?: FocusEvent) => void>(() => {});
  const onEditBlur = useCallback((id: number, ev?: FocusEvent) => {
    const cur = editing.current;
    if (!cur || cur.id !== id) return;
    const field = cur.marked?.editor ?? cur.el;
    const range = savedRange(field);
    queueMicrotask(() => {
      if (editing.current !== cur) return;
      // Le focus est passé à la barre « Aa » ou à l'une de ses fenêtres : la saisie continue (hotfix v0.33.4).
      if (cur.el.isConnected && (inAaUi(ev?.relatedTarget) || inAaUi(cur.el.ownerDocument.activeElement))) {
        cur.hold?.abort();
        cur.hold = holdForAa(
          field,
          range,
          (commit) => editing.current === cur && finishEdit(commit),
          () => field.addEventListener("blur", (e) => onEditBlurRef.current(id, e), { once: true }),
        );
        return;
      }
      if (cur.el.isConnected) finishEdit(true);
      else if (!cur.composing) resumeRef.current(cur);
    });
  }, [finishEdit]);
  useEffect(() => {
    onEditBlurRef.current = onEditBlur;
  });
  const bindMarked = useCallback(
    (marked: MarkedEditor, id: number) => {
      marked.editor.addEventListener("blur", (e) => onEditBlur(id, e), { once: true });
      marked.editor.addEventListener("input", () => {
        // Sélection relevée à chaque frappe (l'événement `selectionchange` arrive après coup).
        if (editing.current?.marked?.editor === marked.editor) editing.current.sel = selectionRange(marked.editor);
        refreshMarkBar();
      });
      // Ctrl/Cmd + Maj + H : surligner au clavier.
      marked.editor.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "h") {
          e.preventDefault();
          toggleMark(marked.editor);
          refreshMarkBar();
        }
      });
    },
    [onEditBlur, refreshMarkBar],
  );

  const bindPlain = useCallback(
    (el: HTMLElement, id: number) => {
      const cur = editing.current;
      if (!cur || cur.id !== id) return;
      // Un seul jeu d'écouteurs par saisie : ceux d'une reprise précédente sont retirés, ceux-ci le sont à la fin.
      cur.ac?.abort();
      const ac = new AbortController();
      cur.ac = ac;
      const { signal } = ac;
      el.addEventListener("blur", (e) => onEditBlur(id, e), { once: true, signal });
      el.addEventListener(
        "beforeinput",
        () => {
          if (editing.current?.el !== el) return;
          editing.current.typing = true;
          setTimeout(() => editing.current?.el === el && (editing.current.typing = false));
        },
        { signal },
      );
      // Texte et sélection d'avant la composition : un rendu du serveur peut réécrire le champ (donc replacer le curseur au début)
      // pendant qu'elle dure ; à la fin le texte validé est replacé là où la composition a commencé.
      let before: { text: string; sel: [number, number] } | null = null;
      const endComposition = (data: string) => {
        const start = before;
        before = null;
        // Après le dernier `input` de la composition : le texte validé fait foi, puis on rattrape ce que le rendu a pu faire entre-temps.
        setTimeout(() => {
          const now = editing.current;
          if (!now || now.el !== el) return;
          now.composing = false;
          if (!el.isConnected) return resumeRef.current(now);
          if (start && data) {
            const want = start.text.slice(0, start.sel[0]) + data + start.text.slice(start.sel[1]);
            if (el.textContent !== want) {
              el.textContent = want;
              selectRange(el, start.sel[0] + data.length, start.sel[0] + data.length);
            }
          }
          now.text = el.textContent ?? "";
          now.sel = selectionRange(el);
        });
      };
      el.addEventListener(
        "input",
        (e) => {
          const now = editing.current;
          if (now?.el !== el) return;
          // Une insertion hors composition alors qu'une composition était ouverte la valide (sans `compositionend` chez certains pilotes).
          if (now.composing && !(e as InputEvent).isComposing) endComposition((e as InputEvent).data ?? "");
          now.text = el.textContent ?? "";
          now.sel = selectionRange(el);
          now.typing = false;
        },
        { signal },
      );
      el.addEventListener(
        "compositionstart",
        () => {
          const now = editing.current;
          if (now?.el !== el) return;
          now.composing = true;
          const len = (el.textContent ?? "").length;
          before = { text: el.textContent ?? "", sel: selectionRange(el) ?? [len, len] };
        },
        { signal },
      );
      el.addEventListener("compositionend", (e) => endComposition(e.data), { signal });
    },
    [onEditBlur],
  );

  const startEdit = useCallback(
    (el: HTMLElement, opts: { selectAll?: boolean } = {}) => {
      let target: Editing["target"];
      if (el.dataset.siteInline) {
        const index = el.dataset.navIndex !== undefined ? Number(el.dataset.navIndex) : undefined;
        target = { kind: "site", field: el.dataset.siteInline, ...(index !== undefined ? { index } : {}) };
        const global = el.closest<HTMLElement>("[data-edit-global]")?.dataset.editGlobal;
        finishEdit(true);
        if (global) select(GLOBAL_UIDS[global] ?? null);
        else {
          const block = el.closest<HTMLElement>("[data-edit-block]");
          if (block?.dataset.editBlock) select(block.dataset.editBlock);
        }
      } else {
        const block = el.closest<HTMLElement>("[data-edit-block]");
        if (!block?.dataset.editBlock) return;
        finishEdit(true);
        select(block.dataset.editBlock);
        target = { kind: "block", uid: block.dataset.editBlock };
      }
      if (el.hasAttribute("data-marked")) {
        const marked = openMarkedEditor(el);
        if (!marked) return;
        const id = ++editSeq.current;
        editing.current = { id, el, original: marked.before, target, marked };
        el.setAttribute("data-editing", "");
        marked.editor.focus();
        placeCaretAtEnd(marked.editor);
        bindMarked(marked, id);
        refreshMarkBar();
        return;
      }
      const id = ++editSeq.current;
      editing.current = { id, el, original: el.textContent ?? "", target, text: el.textContent ?? "" };
      try {
        el.contentEditable = "plaintext-only";
      } catch {
        el.contentEditable = "true";
      }
      el.setAttribute("data-editing", "");
      el.focus();
      if (opts.selectAll) window.getSelection()?.selectAllChildren(el);
      else placeCaretAtEnd(el);
      bindPlain(el, id);
      // Saisie commencée : la barre « Aa » du texte s'ouvre d'elle-même (LookLayer), sans prendre le focus.
      window.dispatchEvent(new CustomEvent("pe:text-edit", { detail: { el } }));
    },
    [finishEdit, select, refreshMarkBar, bindMarked, bindPlain],
  );

  /**
   * Un rendu tardif du serveur (clé d'un bloc = son contenu) remonte le bloc sous le champ en cours : l'élément
   * édité quitte le document, le focus et la sélection avec lui. Ce n'est pas la fin de la saisie : on rouvre le
   * champ sur le nouvel élément, avec le texte déjà tapé et la même sélection.
   */
  const resumeEdit = useCallback(
    (cur: Editing) => {
      if (editing.current !== cur || cur.el.isConnected) return;
      const same = (n: HTMLElement) => {
        if (cur.target.kind === "block") {
          return n.closest("[data-edit-block]")?.getAttribute("data-edit-block") === cur.target.uid;
        }
        const group = (n: HTMLElement) => n.closest("[data-edit-global]")?.getAttribute("data-edit-global") ?? null;
        const navKey = (n: HTMLElement) => n.closest("[data-nav-key]")?.getAttribute("data-nav-key") ?? null;
        return group(n) === group(cur.el) && navKey(n) === navKey(cur.el);
      };
      const t = cur.target;
      const query = t.kind === "block" ? `[data-inline="${cur.marked ? "statement" : cur.el.dataset.inline ?? ""}"]` : `[data-site-inline="${t.field}"]`;
      const candidates = [...document.querySelectorAll<HTMLElement>(query)].filter(same);
      const next = candidates.find((n) => n.dataset.navIndex === cur.el.dataset.navIndex) ?? candidates[0];
      if (!next) return finishEdit(true);
      const sel = cur.sel ?? null;
      if (cur.marked) {
        const typed = markupOf(cur.marked.editor);
        const reopened = openMarkedEditor(next);
        if (!reopened) return finishEdit(true);
        reopened.before = cur.marked.before;
        reopened.editor.replaceChildren(...markedNodes(parseMarked(typed)));
        editing.current = { ...cur, el: next, marked: reopened };
        next.setAttribute("data-editing", "");
        reopened.editor.focus();
        if (sel) selectRange(reopened.editor, sel[0], sel[1]);
        else placeCaretAtEnd(reopened.editor);
        bindMarked(reopened, cur.id);
        refreshMarkBar();
        return;
      }
      const typed = cur.el.textContent ?? "";
      editing.current = { ...cur, el: next, text: typed };
      if (next.textContent !== typed) next.textContent = typed;
      try {
        next.contentEditable = "plaintext-only";
      } catch {
        next.contentEditable = "true";
      }
      next.setAttribute("data-editing", "");
      next.focus();
      if (sel) selectRange(next, sel[0], sel[1]);
      else placeCaretAtEnd(next);
      bindPlain(next, cur.id);
    },
    [finishEdit, refreshMarkBar, bindMarked, bindPlain],
  );
  useLayoutEffect(() => {
    resumeRef.current = resumeEdit;
  }, [resumeEdit]);

  useEffect(() => {
    const mo = new MutationObserver(() => {
      const cur = editing.current;
      if (!cur) return;
      // Pendant une composition (IME, touche morte), rien n'est rétabli ni repris : la reprise attend `compositionend`.
      if (cur.composing) return;
      if (!cur.el.isConnected) return resumeRef.current(cur);
      // Rendu tardif qui réécrit le texte de l'élément en cours de saisie (sans le remonter) : le texte tapé fait foi.
      if (!cur.marked && !cur.typing && !cur.composing && cur.text !== undefined && cur.el.textContent !== cur.text) {
        cur.el.textContent = cur.text;
        if (document.activeElement !== cur.el) cur.el.focus();
        if (cur.sel) selectRange(cur.el, cur.sel[0], cur.sel[1]);
        else placeCaretAtEnd(cur.el);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, []);

  // Rubrique Texte tout juste ajoutée : son texte d'aide s'ouvre en édition (sélectionné) dès qu'il est rendu.
  useEffect(() => {
    tryEditRef.current = () => {
      const p = pendingEdit.current;
      if (!p) return;
      if (Date.now() - p.at > 20000) {
        pendingEdit.current = null;
        return;
      }
      if (!document.documentElement.hasAttribute("data-edit-mode")) return;
      const el = document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(p.uid)}"] [data-inline="${CSS.escape(p.path)}"]`);
      if (!el) return;
      pendingEdit.current = null;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      startEdit(el, { selectAll: true });
    };
  }, [startEdit]);

  /* ---- Messages de l'éditeur --------------------------------------------- */

  useEffect(() => {
    if (window.parent === window) return;
    document.documentElement.setAttribute("data-preview-framed", "");
    let hostEl: HTMLElement | null = null;
    const onMessage = (event: MessageEvent) => {
      // Origine, source (la fenêtre parente) et schéma vérifiés ; sinon ignoré.
      const msg = acceptToCanvas(event, window.location.origin, window.parent);
      if (!msg) return;
      switch (msg.kind) {
        case "mode":
          {
            finishEdit(true);
            // Calque en TÊTE du document : au clavier, Tab parcourt les blocs avant les liens du site.
            if (!hostEl) {
              hostEl = document.createElement("div");
              hostEl.className = "pe-host";
              document.body.prepend(hostEl);
              setHost(hostEl);
            }
            setMode(msg.mode);
          }
          break;
        case "edit-text":
          pendingEdit.current = { uid: msg.uid, path: msg.path, at: Date.now() };
          tryEditRef.current();
          break;
        case "select": {
          setSelected(msg.uid);
          setQuickFor(null);
          if (msg.uid && msg.scroll) {
            const box = boxesRef.current.find((b) => b.uid === msg.uid);
            if (box) window.scrollTo({ top: Math.max(0, box.top - 80), behavior: "smooth" });
            else pendingScroll.current = msg.uid;
          }
          break;
        }
        case "refresh":
          noteSettle(msg.rev, msg.upTo);
          // upTo >= 0 : tout est enregistré, la page qui arrive est celle du serveur.
          if (msg.upTo !== undefined && msg.upTo >= 0) setPendingLabel(null);
          router.refresh();
          break;
        case "settle":
          noteSettle(msg.rev, msg.upTo);
          setPendingLabel(null);
          break;
        case "pending":
          setPendingLabel(msg.label);
          break;
        case "revert":
          revertOverlay(msg.seq);
          break;
        case "drag": {
          // Média glissé : cible d'une planche ou d'un bloc média (BoardLayer).
          if (msg.payload === "media") break;
          document.documentElement.setAttribute("data-edit-dragging", "");
          const target = dropAt(msg.x, msg.y, msg.blockType, msg.nesting ?? 0);
          setDrag({ source: "palette", label: msg.label, x: msg.x, y: msg.y });
          setDrop(target);
          post({ kind: "drag-index", index: target.index, parent: target.parent, ...(target.refused ? { refused: true } : {}) });
          if (msg.y < EDGE) window.scrollBy(0, -16);
          else if (msg.y > window.innerHeight - EDGE) window.scrollBy(0, 16);
          break;
        }
        case "drag-end":
          document.documentElement.removeAttribute("data-edit-dragging");
          setDrag(null);
          setDrop(null);
          break;
      }
    };
    window.addEventListener("message", onMessage);
    // Aperçus locaux réappliqués après chaque rendu de la page (edit/optimistic.ts).
    const stopOverlays = observeOverlays();
    const blocks = measure().map(({ uid, type, label, parent }) => ({ uid, type, label, ...(parent ? { parent } : {}) }));
    lastOrder.current = blocks.map((b) => `${b.parent ?? ""}/${b.uid}`).join(",");
    post({ kind: "ready", path: window.location.pathname, locale: document.documentElement.lang, blocks });
    return () => {
      window.removeEventListener("message", onMessage);
      stopOverlays();
      hostEl?.remove();
    };
  }, [router, finishEdit, dropAt]);

  /* ---- Mesures ------------------------------------------------------------ */

  useEffect(() => {
    if (mode === "off") return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(remeasure);
    };
    schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });
    const onScroll = () => setViewTop(window.scrollY);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("load", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("load", schedule, true);
    };
  }, [mode, remeasure]);

  // État « en cours » : voile léger sur la page (après un court délai, pour ne pas clignoter), levé à l'acquittement ou au bout de 10 s.
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-edit-pending", pendingLabel !== null);
    if (pendingLabel === null) return;
    const t = setTimeout(() => setPendingLabel(null), 10000);
    return () => clearTimeout(t);
  }, [pendingLabel]);

  // Toile en mode édition : `data-edit-mode` (repères) et `data-edit-canvas`
  // (en-tête et éléments collants du thème remis dans le flux, edit-layer.css).
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-edit-mode", mode === "edit");
    root.toggleAttribute("data-edit-canvas", mode === "edit");
    return () => {
      root.removeAttribute("data-edit-mode");
      root.removeAttribute("data-edit-canvas");
    };
  }, [mode]);

  /* ---- Pointeur, clavier ------------------------------------------------- */

  useEffect(() => {
    if (mode === "preview") {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") post({ kind: "key", key: "escape" });
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
    if (mode !== "edit") return;
    const inLayer = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest(".pe-layer"));
    /** Annule l'action par défaut d'un lien (navigation, mailto:, tel:, nouvel onglet) ; le clic continue son chemin. */
    const neutralizeLink = (e: Event) => {
      if (e.target instanceof Element && !e.target.closest(NATIVE_SCROLL) && e.target.closest("a[href], area[href]")) e.preventDefault();
    };
    /** Bloc (le plus profond) ou en-tête / pied sous la cible. */
    const targetOf = (t: EventTarget | null): string | null => {
      if (!(t instanceof Element)) return null;
      const block = t.closest<HTMLElement>("[data-edit-block]");
      if (block?.dataset.editBlock) return block.dataset.editBlock;
      const g = t.closest<HTMLElement>("[data-edit-global]")?.dataset.editGlobal;
      return g ? (GLOBAL_UIDS[g] ?? null) : null;
    };

    const onMove = (e: PointerEvent) => {
      // Sur le « + » lui-même : il reste (le pointeur le tient).
      if (e.target instanceof Element && e.target.closest(".pe-gap")) return;
      if (!inLayer(e.target)) setHover(targetOf(e.target));
      // « + » entre deux rubriques : au pointeur seulement (jamais au toucher), pas pendant une saisie.
      const next = e.pointerType === "touch" || editing.current ? null : gapAt(boxesRef.current, e.clientY + window.scrollY);
      setGap((cur) => (cur?.index === next?.index && cur?.top === next?.top ? cur : next));
    };
    const onLeave = () => {
      setHover(null);
      setGap(null);
    };
    const onClick = (e: MouseEvent) => {
      if (inLayer(e.target)) return;
      // Un lien du site n'ouvre JAMAIS rien en édition (mailto:, tel:, réseau, page) — y compris quand le clic tombe dans un texte
      // en cours de modification (l'adresse e-mail du pied est dans un lien) : plus bas, ce cas sort sans rien bloquer (lot 86).
      neutralizeLink(e);
      // Place libre d'une grille, « + Image » / « + Vidéo » (page ou planche, lot 31d) : le choix du média pour cette case.
      const freeMedia = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-edit-cell-media]") : null;
      const freeGrid = freeMedia ? gridRefOf(freeMedia) : null;
      if (freeMedia && freeGrid) {
        e.preventDefault();
        e.stopPropagation();
        finishEdit(true);
        const index = Number(freeMedia.closest<HTMLElement>(".block-grid-cell[data-cell-index]")?.dataset.cellIndex);
        postIntent({
          kind: "grid-op",
          uid: freeGrid.uid,
          ...(freeGrid.board ? { board: freeGrid.board, ...(freeGrid.props ? { props: freeGrid.props } : {}) } : {}),
          op: { op: "pick", index: Number.isInteger(index) && index >= 0 ? index : 24, media: freeMedia.dataset.editCellMedia === "video" ? "video" : "image" },
        });
        return;
      }
      // Commandes de défilement du site (flèches et barre d'une bande d'images) : elles marchent comme en ligne.
      if (e.target instanceof Element && e.target.closest(NATIVE_SCROLL)) return;
      // Contenu d'une planche (lot 31) : « + Ajouter », barre d'un composant, composant (hors bande), zone d'un carrousel vide — gérés par BoardLayer.
      if (e.target instanceof Element && e.target.closest("[data-edit-bitem-add], [data-edit-bitem-op], [data-edit-bitem-pick], [data-edit-bitem]:not([data-edit-bitem-rail])")) {
        e.preventDefault();
        e.stopPropagation();
        finishEdit(true);
        return;
      }
      // Ajouter une rubrique : bouton fixe du bas de page, ou « Texte » d'une case vide de grille (lot 17c).
      const t = e.target instanceof Element ? e.target : null;
      const addEnd = t?.closest("[data-edit-add]");
      const cellText = t?.closest<HTMLElement>("[data-edit-cell-text]");
      const fieldOp = t?.closest<HTMLElement>("[data-edit-field-op]");
      // État vide d'un bloc média : « Choisir une image / une vidéo / un PDF » (lot 27).
      const emptyMedia = t?.closest<HTMLElement>("[data-edit-empty-media]");
      // Entrées des collections choisies à la main (lot 22) : retirer, monter, descendre ; « + Ajouter une entrée ».
      const tileOp = t?.closest<HTMLElement>("[data-edit-tile-op]");
      const tileAdd = t?.closest<HTMLElement>("[data-edit-tile-add]");
      if (tileOp || tileAdd) {
        e.preventDefault();
        e.stopPropagation();
        finishEdit(true);
        const host = (tileOp ?? tileAdd)!;
        const uid = host.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock;
        if (uid && tileOp) {
          const op = tileOp.dataset.editTileOp as "remove" | "up" | "down" | "cover" | "cover-clear" | "mode-manual" | "mode-auto";
          // Couverture (lot 26) : l'entrée se désigne par son rang (liste manuelle) ou par sa page (automatique).
          const index = tileOp.dataset.index !== undefined ? Number(tileOp.dataset.index) : undefined;
          const pageId = tileOp.dataset.pageId !== undefined ? Number(tileOp.dataset.pageId) : undefined;
          post({ kind: "tile-op", uid, op, ...(index !== undefined && Number.isInteger(index) ? { index } : {}), ...(pageId !== undefined && Number.isInteger(pageId) ? { pageId } : {}) });
        } else if (uid && tileAdd && !(tileAdd as HTMLButtonElement).disabled) {
          let items: { pageId: number; title: string }[] = [];
          try {
            items = JSON.parse(tileAdd.dataset.candidates ?? "[]");
          } catch {}
          setTilePick({ uid, anchor: tileAdd, items });
        }
        return;
      }
      if (emptyMedia) {
        e.preventDefault();
        e.stopPropagation();
        const uid = emptyMedia.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock;
        const field = emptyMedia.dataset.editEmptyMedia;
        if (uid && (field === "mediaId" || field === "backgroundMediaId" || field === "portraitMediaId")) post({ kind: "media-op", uid, field, op: "replace" });
        return;
      }
      if (fieldOp) {
        e.preventDefault();
        e.stopPropagation();
        finishEdit(true);
        const uid = fieldOp.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock;
        const op = fieldOp.dataset.editFieldOp;
        if (uid && op && (FIELD_OP_NAMES as readonly string[]).includes(op.replace(/^(add|remove)-/, ""))) post({ kind: "field-op", uid, op: op as Extract<FromCanvas, { kind: "field-op" }>["op"] });
        return;
      }
      if (addEnd || cellText) {
        e.preventDefault();
        e.stopPropagation();
        finishEdit(true);
        if (addEnd) post({ kind: "insert", parent: null, index: boxesRef.current.filter((b) => !b.parent).length, what: "choose" });
        else {
          const grid = cellText!.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock;
          if (grid) post({ kind: "insert", parent: grid, index: boxesRef.current.filter((b) => b.parent === grid).length, what: (cellText!.dataset.editCellText as "text" | "title" | "title-text" | "free") || "text" });
        }
        return;
      }
      if (editing.current && e.target instanceof Node && editing.current.el.contains(e.target)) return;
      // Titre, Légende, Date sous un média (lot 39) : un clic écrit directement dedans, champ vide compris.
      const cap = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-cap][data-inline]") : null;
      if (cap && !cap.closest("[data-edit-bitem]")) {
        e.preventDefault();
        e.stopPropagation();
        if (editing.current?.el !== cap) startEdit(cap);
        return;
      }
      // Liens, boutons, formulaires et visionneuses du site restent inertes en édition.
      e.preventDefault();
      e.stopPropagation();
      finishEdit(true);
      select(targetOf(e.target), true, true);
    };
    const onAuxClick = (e: MouseEvent) => {
      if (!inLayer(e.target)) neutralizeLink(e);
    };
    const onDblClick = (e: MouseEvent) => {
      if (inLayer(e.target)) return;
      neutralizeLink(e);
      const field = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-inline], [data-site-inline]") : null;
      e.preventDefault();
      e.stopPropagation();
      if (field && editing.current?.el !== field) startEdit(field);
    };
    const onSubmit = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      // Menu « Carte » : ses touches (Échap, Suppr…) sont les siennes, pas celles du bloc (useDismiss le ferme).
      if (e.target instanceof Element && e.target.closest(".sm")) return;
      const mod = e.ctrlKey || e.metaKey;
      // Saisie dans un champ de la couche (planche neuve, texte posé par-dessus) : rien ici.
      if (!editing.current && e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))) return;
      if (editing.current) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finishEdit(true);
        } else if (e.key === "Escape") {
          // Échap VALIDE la saisie (comme cliquer ailleurs) : ce qui est tapé n'est jamais perdu. Pour revenir en arrière : Annuler / Ctrl+Z.
          // Exception (lot 109) : le libellé d'un lien du menu, renommé en place, revient à son texte d'avant.
          e.preventDefault();
          const cur = editing.current;
          finishEdit(!(cur.target.kind === "site" && cur.target.field === "nav"));
        }
        return;
      }
      if (mod && (e.key === "z" || e.key === "Z" || e.key === "y")) {
        e.preventDefault();
        post({ kind: "key", key: e.key === "y" || e.shiftKey ? "redo" : "undo" });
        return;
      }
      const uid = selectedRef.current;
      if (e.key === "Escape") {
        if (uid) {
          // Échap : remonte au conteneur parent, puis désélectionne.
          const box = boxesRef.current.find((b) => b.uid === uid);
          select(box?.parent ?? null);
        } else post({ kind: "key", key: "escape" });
        return;
      }
      if (!uid || uid.startsWith("site-")) {
        if (uid && e.key === "Enter" && !inLayer(e.target)) {
          const field = document.querySelector<HTMLElement>(`[data-edit-global="${uid === "site-header" ? "header" : "footer"}"] [data-site-inline]`);
          if (field) {
            e.preventDefault();
            startEdit(field);
          }
        }
        return;
      }
      // Entrée et Espace sur une flèche de défilement (ou la barre) servent à la faire défiler, pas à modifier le texte du bloc.
      const native = e.target instanceof Element && Boolean(e.target.closest(NATIVE_SCROLL));
      if ((e.key === "Delete" || e.key === "Backspace") && !inLayer(e.target)) {
        e.preventDefault();
        post({ kind: "op", op: "delete", uid });
      } else if (e.key === "Enter" && !native && (!inLayer(e.target) || (e.target instanceof HTMLElement && e.target.dataset.uid === uid))) {
        // Entrée sur le bloc choisi : son premier texte (à lui, pas à ses composants) se modifie.
        const scope = document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(uid)}"]`);
        const field = [...(scope?.querySelectorAll<HTMLElement>("[data-inline], [data-site-inline]") ?? [])].find(
          (f) => f.closest("[data-edit-block]") === scope,
        );
        if (field) {
          e.preventDefault();
          startEdit(field);
        }
      }
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onAuxClick, true);
    document.addEventListener("dblclick", onDblClick, true);
    // Toucher : le double-tap (deux appuis rapprochés sur le même texte, sans glisser) ouvre la saisie comme le double-clic.
    let down: { x: number; y: number } | null = null;
    let lastTap: { t: number; field: HTMLElement } | null = null;
    const onPtrDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") down = { x: e.clientX, y: e.clientY };
    };
    const onPtrCancel = () => {
      down = null;
      lastTap = null;
    };
    const onPtrUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || inLayer(e.target)) return;
      const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10 : false;
      down = null;
      const field = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-inline], [data-site-inline]") : null;
      if (moved || !field) {
        lastTap = null;
        return;
      }
      if (lastTap && lastTap.field === field && e.timeStamp - lastTap.t < 350) {
        lastTap = null;
        setTimeout(() => {
          if (field.isConnected && editing.current?.el !== field) startEdit(field);
        }, 0);
      } else lastTap = { t: e.timeStamp, field };
    };
    // Bouton « Renommer » du menu (SiteLayer) : même saisie en place que le double-clic.
    const onRename = (e: Event) => {
      const el = (e as CustomEvent<{ el?: HTMLElement }>).detail?.el;
      if (el && el.isConnected) startEdit(el, { selectAll: true });
    };
    document.addEventListener("pointerdown", onPtrDown, { passive: true });
    document.addEventListener("pointerup", onPtrUp, { passive: true });
    document.addEventListener("pointercancel", onPtrCancel, { passive: true });
    document.addEventListener("pe:rename", onRename);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("keydown", onKey);
    // Sélection modifiée dans l'accroche : l'état du bouton « Surligner » suit.
    const onSelection = () => {
      const cur = editing.current;
      if (!cur) return;
      const root = cur.marked ? cur.marked.editor : cur.el;
      if (root.isConnected && (cur.marked || cur.text === undefined || root.textContent === cur.text)) cur.sel = selectionRange(root) ?? cur.sel ?? null;
      if (cur.marked) refreshMarkBar();
    };
    document.addEventListener("selectionchange", onSelection);
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onAuxClick, true);
      document.removeEventListener("dblclick", onDblClick, true);
      document.removeEventListener("pointerdown", onPtrDown);
      document.removeEventListener("pointerup", onPtrUp);
      document.removeEventListener("pointercancel", onPtrCancel);
      document.removeEventListener("pe:rename", onRename);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("keydown", onKey);
      finishEdit(true);
    };
  }, [mode, select, startEdit, finishEdit, refreshMarkBar]);

  /* ---- Réordonner par la poignée (page, dans un conteneur, entre les deux) */

  const onGripDown = (e: React.PointerEvent<HTMLButtonElement>, box: Box) => {
    if (e.button !== 0) return;
    e.preventDefault();
    clearSelection();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    finishEdit(true);
    document.documentElement.setAttribute("data-edit-dragging", "");
    // Conteneurs portés par le bloc déplacé (une grille en apporte un).
    const nesting = box.accepts ? 1 + (boxesRef.current.some((b) => b.parent === box.uid && b.accepts) ? 1 : 0) : 0;
    let target: Drop | null = null;
    let raf = 0;
    let lastY = e.clientY;
    const update = (x: number, y: number) => {
      lastY = y;
      target = dropAt(x, y, box.type, nesting, box.uid);
      setDrag({ source: "canvas", uid: box.uid, label: box.label, x, y });
      setDrop(target);
    };
    // Défilement continu près des bords.
    const tick = () => {
      if (lastY < EDGE) window.scrollBy(0, -14);
      else if (lastY > window.innerHeight - EDGE) window.scrollBy(0, 14);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    update(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => update(ev.clientX, ev.clientY);
    const end = (commit: boolean) => {
      cancelAnimationFrame(raf);
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", esc, true);
      document.documentElement.removeAttribute("data-edit-dragging");
      clearSelection();
      setDrag(null);
      setDrop(null);
      const t = target as Drop | null;
      if (!commit || !t || t.refused) return;
      const siblings = boxesRef.current.filter((b) => (b.parent ?? null) === t.parent);
      const from = siblings.findIndex((b) => b.uid === box.uid);
      if (from >= 0 && (t.index === from || t.index === from + 1)) return;
      const seq = post({ kind: "move", uid: box.uid, index: t.index, parent: t.parent });
      if ((box.parent ?? null) === t.parent) previewMove(seq, box.uid, t.parent, t.index);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        end(false);
      }
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", esc, true);
  };

  const boards = <BoardLayer mode={mode} host={host} announce={setAnnouncement} pickerFor={projectPicker} onPickerClose={() => setProjectPicker(null)} />;
  const site = (
    <>
      <SiteLayer mode={mode} host={host} selected={selected} announce={setAnnouncement} />
      <FormLayer mode={mode} host={host} />
    </>
  );
  // Positions fixes (calque des blocs, planches, site) : BoardLayer et SiteLayer
  // ne sont jamais remontés quand le mode change (ils perdraient leur état).
  if (mode !== "edit" || !host)
    return (
      <>
        {null}
        {boards}
        {site}
      </>
    );

  const sel = boxes.find((b) => b.uid === selected);
  /**
   * Étiquette HORS de la boîte, pour ne recouvrir aucun texte : au-dessus, ou
   * dessous quand la boîte touche le haut de la page (en-tête).
   */
  const TAG_H = 24;
  /**
   * Place de l'étiquette (lot 24) : au-dessus à gauche si rien n'y est écrit (texte collé à la rubrique précédente) ; sinon dedans
   * (dans l'espace du haut de la rubrique), puis au-dessus à droite. Repli : au-dessus à gauche.
   */
  const tagAttrs = (b: Rect, text: string) => {
    if (b.top < 28) return { "data-tag": "below" };
    const width = text.length * 7 + 22;
    const at = (side: "above" | "inside", x: "left" | "right") => ({
      top: side === "above" ? b.top - TAG_H : b.top,
      left: x === "left" ? b.left : b.left + b.width - width,
      width,
      height: TAG_H,
    });
    const options = [["above", "left"], ["inside", "left"], ["above", "right"]] as const;
    const pick = options.find(([side, x]) => (side === "above" || b.height >= 48) && !coversContent(at(side, x))) ?? options[0];
    return { "data-tag": pick[0], ...(pick[1] === "right" ? { "data-tag-x": "right" } : {}) };
  };
  const selGlobal = globals.find((g) => g.uid === selected);
  const hovBlock = hover && hover !== selected ? boxes.find((b) => b.uid === hover) : undefined;
  const hovGlobal = hover && hover !== selected ? globals.find((g) => g.uid === hover) : undefined;
  const draggingUid = drag?.source === "canvas" ? drag.uid : null;
  const siblingsOf = (b: Box) => boxes.filter((x) => (x.parent ?? null) === (b.parent ?? null));
  /** Monter / descendre d'un rang : envoyé à l'éditeur, montré tout de suite. */
  const orderOp = (kind: "up" | "down", b: Box) => {
    const seq = post({ kind: "op", op: kind, uid: b.uid });
    const parent = b.parent ?? null;
    const base = orderOf(parent);
    const i = base.indexOf(b.uid);
    if (i < 0) return;
    if (kind === "up" && i > 0) previewMove(seq, b.uid, parent, i - 1);
    if (kind === "down" && i < base.length - 1) previewMove(seq, b.uid, parent, i + 2);
  };
  const chain = (b: Box): Box[] => {
    const out: Box[] = [];
    let cur: Box | undefined = b;
    while (cur?.parent) {
      cur = boxes.find((x) => x.uid === cur!.parent);
      if (cur) out.unshift(cur);
    }
    return out;
  };
  /** Conteneur voisin (après, sinon avant) qui accepterait ce bloc : « Entrer dans… ». */
  const enterable = (b: Box): Box | undefined => {
    if (b.accepts && b.type !== "grid") return undefined;
    const sibs = siblingsOf(b);
    const i = sibs.findIndex((x) => x.uid === b.uid);
    const fits = (c: Box | undefined) => c && c.accepts?.includes(b.type) && c.depth + 1 + (b.accepts ? 1 : 0) <= MAX_NESTING;
    return [sibs[i + 1], sibs[i - 1]].find(fits);
  };
  const dropContainer = drop?.parent ? boxes.find((b) => b.uid === drop.parent) : undefined;
  /** Repère d'insertion dans un conteneur : ligne (liste) ou barre verticale (grille). */
  const innerMarker = (() => {
    if (!drag || !drop?.parent || drop.refused || !dropContainer) return null;
    const kids = boxes.filter((b) => b.parent === drop.parent && b.uid !== draggingUid);
    const inset = 12;
    if (dropContainer.type === "grid" && kids.length) {
      const k = kids[Math.min(drop.index, kids.length - 1)];
      const after = drop.index >= kids.length;
      return { kind: "v" as const, top: k.top, left: after ? k.left + k.width + 6 : k.left - 8, height: k.height };
    }
    let y: number;
    if (!kids.length) y = dropContainer.top + dropContainer.height / 2;
    else if (drop.index <= 0) y = kids[0].top;
    else if (drop.index >= kids.length) y = kids[kids.length - 1].top + kids[kids.length - 1].height;
    else y = (kids[drop.index - 1].top + kids[drop.index - 1].height + kids[drop.index].top) / 2;
    return { kind: "h" as const, top: y, left: dropContainer.left + inset, width: dropContainer.width - inset * 2 };
  })();
  const topCount = boxes.filter((b) => !b.parent).length;
  const emptyZones = [...document.querySelectorAll<HTMLElement>("[data-edit-container-empty]")]
    .map((el) => ({ uid: el.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock ?? "", rect: rectOf(el) }))
    .filter((z): z is { uid: string; rect: Rect } => Boolean(z.uid && z.rect));

  const blocksLayer = createPortal(
    <div className="pe-layer" lang="fr">
      {/* Cibles clavier : Tab parcourt les blocs (composants compris), Entrée en choisit un. */}
      {boxes.map((b) => {
        const sibs = siblingsOf(b);
        const where = b.parent ? ` dans « ${boxes.find((x) => x.uid === b.parent)?.label ?? "bloc"} »` : "";
        return (
          <button
            key={`f-${b.uid}`}
            type="button"
            className="pe-focus"
            aria-label={`Bloc ${sibs.indexOf(b) + 1} sur ${sibs.length}${where} : ${b.label}${b.uid === selected ? " (sélectionné)" : ""}`}
            aria-pressed={b.uid === selected}
            style={{ top: b.top, left: b.left, width: b.width, height: Math.max(b.height, 8) }}
            onFocus={() => setHover(b.uid)}
            onBlur={() => setHover(null)}
            data-uid={b.uid}
            onClick={() => select(b.uid, true, true)}
          />
        );
      })}
      {globals.map((g) => (
        <button
          key={`f-${g.uid}`}
          type="button"
          className="pe-focus"
          aria-label={`${g.label}${g.uid === selected ? " (sélectionné)" : ""}`}
          aria-pressed={g.uid === selected}
          style={{ top: g.top, left: g.left, width: g.width, height: g.height }}
          data-uid={g.uid}
          onFocus={() => setHover(g.uid)}
          onBlur={() => setHover(null)}
          onClick={() => select(g.uid, true, true)}
        />
      ))}

      {emptyZones.map((z) => (
        <div
          key={`empty-${z.uid}`}
          className="pe-container-dropzone"
          data-over={(drop?.parent === z.uid && !drop.refused) || undefined}
          style={{ top: z.rect.top + 8, left: z.rect.left + 24, width: Math.max(120, z.rect.width - 48), height: Math.max(80, z.rect.height - 16) }}
          aria-hidden="true"
        >
          Glisse un bloc ici
        </div>
      ))}

      {hovBlock && (
        <div className="pe-box pe-hover" data-child={hovBlock.parent ? "" : undefined} {...tagAttrs(hovBlock, hovBlock.label)} style={{ top: hovBlock.top, left: hovBlock.left, width: hovBlock.width, height: hovBlock.height }} aria-hidden="true">
          <span className="pe-tag pe-tag-soft">{hovBlock.label}</span>
        </div>
      )}
      {hovGlobal && (
        <div className="pe-box pe-hover pe-global" {...tagAttrs(hovGlobal, hovGlobal.label)} style={{ top: hovGlobal.top, left: hovGlobal.left, width: hovGlobal.width, height: hovGlobal.height }} aria-hidden="true">
          <span className="pe-tag pe-tag-soft pe-tag-global">{hovGlobal.label}</span>
        </div>
      )}

      {selGlobal && (
        <div className="pe-box pe-selected pe-global" {...tagAttrs(selGlobal, selGlobal.label)} style={{ top: selGlobal.top, left: selGlobal.left, width: selGlobal.width, height: selGlobal.height }}>
          <span className="pe-tag pe-tag-global">{selGlobal.label}</span>
        </div>
      )}

      {sel && (
        <div
          className="pe-box pe-selected"
          {...tagAttrs(sel, [...chain(sel).map((c) => c.label), sel.label].join(" › "))}
          data-dragging={draggingUid === sel.uid || undefined}
          data-container={sel.accepts ? "" : undefined}
          style={{ top: sel.top, left: sel.left, width: sel.width, height: sel.height }}
        >
          {/* Fil d'Ariane : remonter au conteneur parent (comme Elementor). */}
          <nav className="pe-tag pe-crumbs" aria-label="Emplacement du bloc">
            {chain(sel).map((c) => (
              <span key={c.uid}>
                <button type="button" className="pe-crumb" onClick={() => select(c.uid, true, true)} title={`Sélectionner « ${c.label} »`}>
                  {c.label}
                </button>
                <span aria-hidden="true"> › </span>
              </span>
            ))}
            <span aria-current="true">{sel.label}</span>
          </nav>
          {/* Image ou vidéo d'une case de grille : une seule barre, celle de la case (GridLayer, lot 31d). */}
          {!(sel.parent && boxes.find((b) => b.uid === sel.parent)?.type === "grid" && (sel.type === "image" || sel.type === "video-single")) && (
          <div
            className="pe-tools"
            role="toolbar"
            aria-label={`Bloc ${sel.label}`}
            // Reste visible quand le haut du bloc sort de l'écran.
            style={{ top: Math.min(Math.max(0, viewTop + 8 - sel.top), Math.max(0, sel.height - 34)) }}
          >
            <button type="button" className="pe-grip" aria-label="Glisser pour déplacer" title="Glisser pour déplacer (dans un bloc, ou hors de lui)" onPointerDown={(e) => onGripDown(e, sel)}>
              <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                {[3, 8, 13].flatMap((y) => [2.5, 7.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" fill="currentColor" />))}
              </svg>
            </button>
            {sel.type === "featured-project" && (
              <button type="button" className="pe-tool-text" aria-expanded={projectPicker === sel.uid} onClick={() => setProjectPicker(sel.uid)}>
                Changer de projet
              </button>
            )}
            {sel.type === "collection-tiles" && (
              <button type="button" className="pe-tool-text" data-anchor="tile-size" aria-expanded={sizeFor === sel.uid} onClick={() => setSizeFor((o) => (o === sel.uid ? null : sel.uid))}>
                Taille des images
              </button>
            )}
            {sel.type === "collection-tiles" && (
              <button
                type="button"
                className="pe-tool-text"
                data-testid="tiles-mode-button"
                onClick={() => post({ kind: "tile-op", uid: sel.uid, op: document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(sel.uid)}"] .tiles`)?.dataset.tilesMode === "manual" ? "mode-auto" : "mode-manual" })}
                title="Automatiques : une entrée par page de collection, dans l'ordre du menu. À la main : tu choisis les entrées, leur ordre, et tu peux en retirer."
              >
                {document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(sel.uid)}"] .tiles`)?.dataset.tilesMode === "manual" ? "Entrées : à la main · passer en automatique" : "Entrées : automatiques · les choisir à la main"}
              </button>
            )}
            {sel.type === "grid" && (
              <button
                type="button"
                className="pe-tool-text"
                data-grid-settings-button=""
                data-testid="grid-settings-button"
                aria-haspopup="dialog"
                title="Agencement, espace, format des cases, colonnes…"
                onClick={() => window.dispatchEvent(new CustomEvent("pe:grid-settings", { detail: { uid: sel.uid } }))}
              >
                Réglages
              </button>
            )}
            {(sel.type === "image" || sel.type === "video-single") && <FrameButton what={sel.type === "image" ? "photo" : "vidéo"} uid={sel.uid} open={frameFor === sel.uid} onToggle={() => { setFondFor(null); setImgBgFor(null); setQuickFor(null); setFrameFor((o) => (o === sel.uid ? null : sel.uid)); }} />}
            {sel.type === "image" && (
              <ImageBgButton
                uid={sel.uid}
                open={imgBgFor === sel.uid}
                onToggle={() => {
                  const next = imgBgFor === sel.uid ? null : sel.uid;
                  // Une seule fenêtre à la fois (pe:popups-close ferme aussi celles des autres couches), puis la sienne.
                  window.dispatchEvent(new CustomEvent("pe:popups-close"));
                  setImgBgFor(next);
                }}
              />
            )}
            {sel.type === "image" && !sel.parent && <QuickButton uid={sel.uid} kind="size" open={quickFor?.uid === sel.uid && quickFor.kind === "size"} onToggle={() => toggleQuick(sel.uid, "size")} />}
            {!sel.parent && sel.type !== "hero" && <QuickButton uid={sel.uid} kind="space" open={quickFor?.uid === sel.uid && quickFor.kind === "space"} onToggle={() => toggleQuick(sel.uid, "space")} />}
            {!sel.parent && sel.type !== "hero" && <QuickButton uid={sel.uid} kind="width" open={quickFor?.uid === sel.uid && quickFor.kind === "width"} onToggle={() => toggleQuick(sel.uid, "width")} />}
            {(!sel.parent || hasFondWrapper(sel.uid)) && <FondButton uid={sel.uid} open={fondFor === sel.uid} onToggle={() => { setFrameFor(null); setImgBgFor(null); setQuickFor(null); setFondFor((o) => (o === sel.uid ? null : sel.uid)); }} />}
            <button type="button" aria-label="Monter" title="Monter" disabled={siblingsOf(sel)[0]?.uid === sel.uid} onClick={() => orderOp("up", sel)}>
              ↑
            </button>
            <button type="button" aria-label="Descendre" title="Descendre" disabled={siblingsOf(sel).at(-1)?.uid === sel.uid} onClick={() => orderOp("down", sel)}>
              ↓
            </button>
            {sel.parent && (
              <button type="button" aria-label="Sortir du bloc" title="Sortir du bloc (placé juste après lui)" onClick={() => post({ kind: "op", op: "out", uid: sel.uid })}>
                ⇱
              </button>
            )}
            {enterable(sel) && (
              <button
                type="button"
                aria-label={`Entrer dans « ${enterable(sel)!.label} »`}
                title={`Entrer dans « ${enterable(sel)!.label} »`}
                onClick={() => post({ kind: "op", op: "in", uid: sel.uid })}
              >
                ⇲
              </button>
            )}
            <button type="button" aria-label="Dupliquer" title="Dupliquer" onClick={() => post({ kind: "op", op: "duplicate", uid: sel.uid })}>
              ⧉
            </button>
            {/* Bloc verrouillé (lot 89, « Sortie ») : le bouton reste, désactivé, et dit pourquoi ; le clic est refusé par l'éditeur avec la même explication. */}
            {(() => {
              const locked = document.querySelector(`[data-edit-block="${CSS.escape(sel.uid)}"]`)?.getAttribute("data-edit-locked") ?? null;
              return (
                <button type="button" className="pe-danger" aria-label="Supprimer" aria-disabled={locked ? true : undefined} data-locked={locked ? "" : undefined} title={locked ?? "Supprimer (Suppr)"} style={locked ? { opacity: 0.45, cursor: "not-allowed" } : undefined} onClick={() => post({ kind: "op", op: "delete", uid: sel.uid })}>
                  ✕
                </button>
              );
            })()}
          </div>
          )}
          {fondFor === sel.uid && (!sel.parent || hasFondWrapper(sel.uid)) && (
            <FondMenu
              uid={sel.uid}
              anchor='.pe-tools [data-testid="fond-button"]'
              onClose={() => setFondFor(null)}
              onChanged={() => bump((n) => n + 1)}
            />
          )}
          {(sel.type === "image" || sel.type === "video-single") && frameFor === sel.uid && (
            <FrameWindow
              what={sel.type === "image" ? "photo" : "vidéo"}
              anchor='.pe-tools [data-testid="frame-button"]'
              value={lookOf(sel.uid).frame}
              onChange={(frame) => {
                sendOwnMediaLook(sel.uid, { frame: frame ?? null });
                bump((n) => n + 1);
              }}
              onClose={() => setFrameFor(null)}
            />
          )}
          {quickFor?.uid === sel.uid && (
            <QuickMenu
              key={quickFor.kind}
              uid={sel.uid}
              kind={quickFor.kind}
              anchor={`.pe-tools [data-testid="${quickFor.kind}-button"]`}
              onClose={() => setQuickFor(null)}
              onChanged={() => bump((n) => n + 1)}
            />
          )}
          {sel.type === "image" && imgBgFor === sel.uid && (
            <ImageBgWindow
              anchor='.pe-tools [data-testid="imgbg-button"]'
              value={lookOf(sel.uid).imageBg}
              onChange={(imageBg) => {
                sendOwnMediaLook(sel.uid, { bg: (imageBg as ImageBg | undefined) ?? null });
                bump((n) => n + 1);
              }}
              onClose={() => setImgBgFor(null)}
            />
          )}
          {sel.type === "collection-tiles" && sizeFor === sel.uid && (
            <TileSizePicker uid={sel.uid} onClose={() => setSizeFor(null)} />
          )}
        </div>
      )}

      {tilePick && <TilePagePicker {...tilePick} onClose={() => setTilePick(null)} />}

      {topCount === 0 && (
        <div className="pe-empty" style={{ top: markerY(boxes, 0) }} data-over={drop !== null || undefined}>
          Page vide : glisse un bloc ici depuis « Ajouter », ou clique sur l&apos;un d&apos;eux.
        </div>
      )}

      {gap && !drag && !fondFor && !frameFor && !quickFor && !sizeFor && !projectPicker && (
        <div className="pe-gap" style={{ top: gap.top }}>
          <button type="button" data-edit-gap={gap.index} onClick={() => post({ kind: "insert", parent: null, index: gap.index, what: "choose" })}>
            <span aria-hidden="true">+</span> Ajouter un bloc
          </button>
        </div>
      )}

      {drag && dropContainer && (
        <div
          className="pe-drop-container"
          data-refused={drop?.refused || undefined}
          style={{ top: dropContainer.top, left: dropContainer.left, width: dropContainer.width, height: dropContainer.height }}
          aria-hidden="true"
        >
          <span>{drop?.refused ? `« ${dropContainer.label} » n'accepte pas ce bloc` : `Dans « ${dropContainer.label} »`}</span>
        </div>
      )}
      {innerMarker?.kind === "h" && <div className="pe-marker-inner" style={{ top: innerMarker.top, left: innerMarker.left, width: innerMarker.width }} aria-hidden="true" />}
      {innerMarker?.kind === "v" && <div className="pe-marker-inner-v" style={{ top: innerMarker.top, left: innerMarker.left, height: innerMarker.height }} aria-hidden="true" />}
      {drag && drop && !drop.parent && topCount > 0 && (
        <div className="pe-marker" style={{ top: markerY(boxes, drop.index) }} aria-hidden="true">
          <span>Déposer ici</span>
        </div>
      )}

      {drag?.source === "canvas" && (
        <div className="pe-ghost" style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 10}px)` }} aria-hidden="true">
          {drag.label}
        </div>
      )}

      {/* Grille unifiée (lot 31d) : barre de la grille, barre des cases, numéros. */}
      <GridLayer selected={selected} dragging={Boolean(drag)} announce={setAnnouncement} />
      {/* Planche libre (lot 42) : images posées librement, poignées, repères, barre de l'image. */}
      <FreeLayer selected={selected} dragging={Boolean(drag)} announce={setAnnouncement} />
      {/* Mise en page (lot 2) : espaces, textes, position du titre, cadrage. */}
      <LookLayer
        selected={sel ? { uid: sel.uid, type: sel.type, ...(sel.parent ? { parent: sel.parent, parentType: boxes.find((b) => b.uid === sel.parent)?.type } : {}) } : null}
        dragging={Boolean(drag)}
        announce={setAnnouncement}
      />
      {/* Palette et logo du site (lot 17f) : aperçu, surlignage d'un rôle de couleur, poignée du logo. */}
      <SiteLookLayer headerSelected={selected === "site-header"} dragging={Boolean(drag)} />

      {markBar && (
        <div className="pe-markbar" role="toolbar" aria-label="Surlignage de l'accroche" style={{ top: markBar.top, left: markBar.left }}>
          <button
            type="button"
            aria-pressed={markBar.state === true}
            disabled={markBar.state === null}
            title="Surligner la sélection (ou le mot sous le curseur) · Ctrl+Maj+H"
            // Garde le focus et la sélection dans le texte : sinon le champ se refermerait.
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const m = editing.current?.marked;
              if (!m) return;
              const on = markBar.state !== true;
              if (toggleMark(m.editor)) setAnnouncement(on ? "Passage surligné" : "Surlignage retiré");
              refreshMarkBar();
            }}
          >
            {markBar.state === true ? "Retirer le surlignage" : "Surligner"}
          </button>
          <span className="pe-markbar-hint">Sélectionne un mot · Entrée ou Échap valide</span>
        </div>
      )}

      {pendingLabel && (
        <p className="pe-pending" role="status">
          {pendingLabel}
        </p>
      )}

      <p className="pe-live" role="status" aria-live="polite">
        {drag && drop
          ? drop.refused
            ? "Ce bloc n'accepte pas ce type de bloc."
            : `${drop.parent ? `Dans « ${dropContainer?.label ?? "le bloc"} », p` : "P"}osition ${drop.index + 1}`
          : announcement}
      </p>
    </div>,
    host,
  );
  // Calque des blocs en premier : au clavier, Tab parcourt les blocs avant les outils.
  return (
    <>
      {blocksLayer}
      {boards}
      {site}
    </>
  );
}
