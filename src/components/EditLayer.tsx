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
 * (data-site-inline) : double-clic, ou Entrée sur le bloc choisi. Toute
 * modification part vers l'éditeur, qui tient le brouillon, l'enregistre
 * puis demande un rafraîchissement.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { MAX_NESTING } from "@/blocks/tree";
import { acceptToCanvas, insertionIndex, moveTo, type BlockInfo, type FromCanvas } from "@/lib/edit/protocol";

import BoardLayer from "./BoardLayer";
import LookLayer from "./edit/LookLayer";
import GridLayoutIcon, { LAYOUT_LABELS } from "./edit/GridLayoutIcon";
import { noteSettle, observeOverlays, pendingOrder, postIntent, previewLayout, previewOrder, previewText, siblingWrappers } from "./edit/optimistic";
import { useDismiss } from "./edit/useDismiss";
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
const LAYOUTS = ["1", "1+2", "2", "3", "2x2", "4", "2+1"] as const;

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

/** Choix d'agencement d'une grille : se ferme d'un clic ailleurs. */
function LayoutPicker({ top, uid, onClose }: { top: number; uid: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  return (
    <div ref={ref} className="pe-layouts" role="radiogroup" aria-label="Agencement de la grille" style={{ top }}>
      {LAYOUTS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={document.querySelector(`[data-edit-block="${CSS.escape(uid)}"] .block-grid`)?.getAttribute("data-layout") === l}
          aria-label={LAYOUT_LABELS[l]}
          title={LAYOUT_LABELS[l]}
          onClick={() => {
            const seq = post({ kind: "layout", uid, layout: l });
            previewLayout(uid, l, seq);
          }}
        >
          <GridLayoutIcon layout={l} />
        </button>
      ))}
    </div>
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

type Editing = { el: HTMLElement; original: string; target: { kind: "block"; uid: string } | { kind: "site"; field: string; index?: number } };

export default function EditLayer() {
  const router = useRouter();
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
  const [layoutFor, setLayoutFor] = useState<string | null>(null);
  const [projectPicker, setProjectPicker] = useState<string | null>(null);
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
    const order = next.map((b) => `${b.parent ?? ""}/${b.uid}`).join(",");
    if (order !== lastOrder.current) {
      lastOrder.current = order;
      post({ kind: "blocks", blocks: next.map(({ uid, type, label, parent }) => ({ uid, type, label, ...(parent ? { parent } : {}) })) });
    }
  }, []);

  const select = useCallback((uid: string | null, notify = true) => {
    setSelected(uid);
    if (notify) post({ kind: "select", uid });
  }, []);

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

  const finishEdit = useCallback((commit: boolean) => {
    const current = editing.current;
    if (!current) return;
    editing.current = null;
    const { el, original, target } = current;
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
      previewText({ uid: target.uid, path }, value.slice(0, 2000), seq);
    } else {
      const seq = post({ kind: "site-text", field: target.field as "name", ...(target.index !== undefined ? { index: target.index } : {}), locale, value: value.slice(0, 200) });
      previewText({ field: target.field, ...(target.index !== undefined ? { index: target.index } : {}) }, value.slice(0, 200), seq);
    }
  }, []);

  const startEdit = useCallback(
    (el: HTMLElement) => {
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
      editing.current = { el, original: el.textContent ?? "", target };
      try {
        el.contentEditable = "plaintext-only";
      } catch {
        el.contentEditable = "true";
      }
      el.setAttribute("data-editing", "");
      el.focus();
      placeCaretAtEnd(el);
      el.addEventListener("blur", () => finishEdit(true), { once: true });
    },
    [finishEdit, select],
  );

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
        case "select": {
          setSelected(msg.uid);
          if (msg.uid && msg.scroll) {
            const box = boxesRef.current.find((b) => b.uid === msg.uid);
            if (box) window.scrollTo({ top: Math.max(0, box.top - 80), behavior: "smooth" });
            else pendingScroll.current = msg.uid;
          }
          break;
        }
        case "refresh":
          noteSettle(msg.rev, msg.upTo);
          router.refresh();
          break;
        case "settle":
          noteSettle(msg.rev, msg.upTo);
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
    /** Bloc (le plus profond) ou en-tête / pied sous la cible. */
    const targetOf = (t: EventTarget | null): string | null => {
      if (!(t instanceof Element)) return null;
      const block = t.closest<HTMLElement>("[data-edit-block]");
      if (block?.dataset.editBlock) return block.dataset.editBlock;
      const g = t.closest<HTMLElement>("[data-edit-global]")?.dataset.editGlobal;
      return g ? (GLOBAL_UIDS[g] ?? null) : null;
    };

    const onMove = (e: PointerEvent) => {
      if (inLayer(e.target)) return;
      setHover(targetOf(e.target));
    };
    const onLeave = () => setHover(null);
    const onClick = (e: MouseEvent) => {
      if (inLayer(e.target)) return;
      if (editing.current && e.target instanceof Node && editing.current.el.contains(e.target)) return;
      // Liens, boutons, formulaires et visionneuses du site restent inertes en édition.
      e.preventDefault();
      e.stopPropagation();
      finishEdit(true);
      select(targetOf(e.target));
    };
    const onDblClick = (e: MouseEvent) => {
      if (inLayer(e.target)) return;
      const field = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-inline], [data-site-inline]") : null;
      e.preventDefault();
      e.stopPropagation();
      if (field && editing.current?.el !== field) startEdit(field);
    };
    const onSubmit = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      // Saisie dans un champ de la couche (planche neuve, texte posé par-dessus) : rien ici.
      if (!editing.current && e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))) return;
      if (editing.current) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finishEdit(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finishEdit(false);
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
      if ((e.key === "Delete" || e.key === "Backspace") && !inLayer(e.target)) {
        e.preventDefault();
        post({ kind: "op", op: "delete", uid });
      } else if (e.key === "Enter" && (!inLayer(e.target) || (e.target instanceof HTMLElement && e.target.dataset.uid === uid))) {
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
    document.addEventListener("dblclick", onDblClick, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("dblclick", onDblClick, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("keydown", onKey);
      finishEdit(true);
    };
  }, [mode, select, startEdit, finishEdit]);

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
  const tagSide = (b: Rect) => (b.top < 28 ? "below" : "above");
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
        const where = b.parent ? ` dans « ${boxes.find((x) => x.uid === b.parent)?.label ?? "conteneur"} »` : "";
        return (
          <button
            key={`f-${b.uid}`}
            type="button"
            className="pe-focus"
            aria-label={`${b.parent ? "Composant" : "Bloc"} ${sibs.indexOf(b) + 1} sur ${sibs.length}${where} : ${b.label}${b.uid === selected ? " (sélectionné)" : ""}`}
            aria-pressed={b.uid === selected}
            style={{ top: b.top, left: b.left, width: b.width, height: Math.max(b.height, 8) }}
            onFocus={() => setHover(b.uid)}
            onBlur={() => setHover(null)}
            data-uid={b.uid}
            onClick={() => select(b.uid)}
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
          onClick={() => select(g.uid)}
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
          Glisse un composant ici
        </div>
      ))}

      {hovBlock && (
        <div className="pe-box pe-hover" data-child={hovBlock.parent ? "" : undefined} data-tag={tagSide(hovBlock)} style={{ top: hovBlock.top, left: hovBlock.left, width: hovBlock.width, height: hovBlock.height }} aria-hidden="true">
          <span className="pe-tag pe-tag-soft">{hovBlock.label}</span>
        </div>
      )}
      {hovGlobal && (
        <div className="pe-box pe-hover pe-global" data-tag={tagSide(hovGlobal)} style={{ top: hovGlobal.top, left: hovGlobal.left, width: hovGlobal.width, height: hovGlobal.height }} aria-hidden="true">
          <span className="pe-tag pe-tag-soft pe-tag-global">{hovGlobal.label}</span>
        </div>
      )}

      {selGlobal && (
        <div className="pe-box pe-selected pe-global" data-tag={tagSide(selGlobal)} style={{ top: selGlobal.top, left: selGlobal.left, width: selGlobal.width, height: selGlobal.height }}>
          <span className="pe-tag pe-tag-global">{selGlobal.label}</span>
        </div>
      )}

      {sel && (
        <div
          className="pe-box pe-selected"
          data-tag={tagSide(sel)}
          data-dragging={draggingUid === sel.uid || undefined}
          data-container={sel.accepts ? "" : undefined}
          style={{ top: sel.top, left: sel.left, width: sel.width, height: sel.height }}
        >
          {/* Fil d'Ariane : remonter au conteneur parent (comme Elementor). */}
          <nav className="pe-tag pe-crumbs" aria-label="Emplacement du bloc">
            {chain(sel).map((c) => (
              <span key={c.uid}>
                <button type="button" className="pe-crumb" onClick={() => select(c.uid)} title={`Sélectionner « ${c.label} »`}>
                  {c.label}
                </button>
                <span aria-hidden="true"> › </span>
              </span>
            ))}
            <span aria-current="true">{sel.label}</span>
          </nav>
          <div
            className="pe-tools"
            role="toolbar"
            aria-label={`Bloc ${sel.label}`}
            // Reste visible quand le haut du bloc sort de l'écran.
            style={{ top: Math.min(Math.max(0, viewTop + 8 - sel.top), Math.max(0, sel.height - 34)) }}
          >
            <button type="button" className="pe-grip" aria-label="Glisser pour déplacer" title="Glisser pour déplacer (dans un conteneur, ou hors de lui)" onPointerDown={(e) => onGripDown(e, sel)}>
              <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                {[3, 8, 13].flatMap((y) => [2.5, 7.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" fill="currentColor" />))}
              </svg>
            </button>
            {sel.type === "featured-project" && (
              <button type="button" className="pe-tool-text" aria-expanded={projectPicker === sel.uid} onClick={() => setProjectPicker(sel.uid)}>
                Changer de projet
              </button>
            )}
            {sel.type === "grid" && (
              <button type="button" className="pe-tool-text" aria-expanded={layoutFor === sel.uid} onClick={() => setLayoutFor((o) => (o === sel.uid ? null : sel.uid))}>
                Agencement
              </button>
            )}
            <button type="button" aria-label="Monter" title="Monter" disabled={siblingsOf(sel)[0]?.uid === sel.uid} onClick={() => orderOp("up", sel)}>
              ↑
            </button>
            <button type="button" aria-label="Descendre" title="Descendre" disabled={siblingsOf(sel).at(-1)?.uid === sel.uid} onClick={() => orderOp("down", sel)}>
              ↓
            </button>
            {sel.parent && (
              <button type="button" aria-label="Sortir du conteneur" title="Sortir du conteneur (placé juste après lui)" onClick={() => post({ kind: "op", op: "out", uid: sel.uid })}>
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
            <button type="button" className="pe-danger" aria-label="Supprimer" title="Supprimer (Suppr)" onClick={() => post({ kind: "op", op: "delete", uid: sel.uid })}>
              ✕
            </button>
          </div>
          {sel.type === "grid" && layoutFor === sel.uid && (
            <LayoutPicker uid={sel.uid} top={Math.min(Math.max(0, viewTop + 8 - sel.top), Math.max(0, sel.height - 34)) + 40} onClose={() => setLayoutFor(null)} />
          )}
        </div>
      )}

      {topCount === 0 && (
        <div className="pe-empty" style={{ top: markerY(boxes, 0) }} data-over={drop !== null || undefined}>
          Page vide : glisse un composant ici depuis « Ajouter », ou clique sur l&apos;un d&apos;eux.
        </div>
      )}

      {drag && dropContainer && (
        <div
          className="pe-drop-container"
          data-refused={drop?.refused || undefined}
          style={{ top: dropContainer.top, left: dropContainer.left, width: dropContainer.width, height: dropContainer.height }}
          aria-hidden="true"
        >
          <span>{drop?.refused ? `« ${dropContainer.label} » n'accepte pas ce composant` : `Dans « ${dropContainer.label} »`}</span>
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

      {/* Mise en page (lot 2) : espaces, textes, position du titre, cadrage. */}
      <LookLayer
        selected={sel ? { uid: sel.uid, type: sel.type, ...(sel.parent ? { parent: sel.parent, parentType: boxes.find((b) => b.uid === sel.parent)?.type } : {}) } : null}
        dragging={Boolean(drag)}
        announce={setAnnouncement}
      />

      <p className="pe-live" role="status" aria-live="polite">
        {drag && drop
          ? drop.refused
            ? "Ce conteneur n'accepte pas ce composant."
            : `${drop.parent ? `Dans « ${dropContainer?.label ?? "le conteneur"} », p` : "P"}osition ${drop.index + 1}`
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
