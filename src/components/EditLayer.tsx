"use client";

/**
 * Couche d'édition de la toile de l'éditeur visuel. Rendue seulement en vue
 * brouillon (admin vérifié, draft mode, cookie de la toile : voir
 * src/lib/draft-view.ts) et inactive tant que la fenêtre parente — l'éditeur,
 * même origine — ne l'a pas allumée (`mode`). En « aperçu », elle ne dessine
 * rien : la page est exactement celle du brouillon.
 *
 * Elle repère les blocs par leurs enveloppes (data-edit-block, posées par
 * BlockList) et dessine par-dessus, dans un calque à part : contour au
 * survol, étiquette et barre d'outils de la sélection, poignée pour
 * réordonner, repère d'insertion pendant un glisser. Les textes déclarés
 * `inline` au registre (data-inline) se modifient en place (double-clic, ou
 * Entrée sur le bloc choisi). Toute modification part vers l'éditeur, qui
 * tient le brouillon, l'enregistre puis demande un rafraîchissement.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { acceptToCanvas, EDIT_MSG, insertionIndex, type BlockInfo, type FromCanvas } from "@/lib/edit/protocol";

import BoardLayer from "./BoardLayer";

import "@/app/admin/edit-layer.css";

type Box = BlockInfo & { top: number; left: number; width: number; height: number };
type Mode = "off" | "edit" | "preview";
type Drag = { source: "canvas"; uid: string; label: string; x: number; y: number } | { source: "palette"; label: string; x: number; y: number };

const EDGE = 64;

function post(msg: FromCanvas) {
  window.parent.postMessage({ type: EDIT_MSG, ...msg }, window.location.origin);
}

function blockElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-edit-block]")];
}

/** Boîte d'un bloc : réunion des boîtes de ses enfants (l'enveloppe est en display: contents). */
function measure(): Box[] {
  const sx = window.scrollX;
  const sy = window.scrollY;
  let lastBottom = 0;
  return blockElements().map((el) => {
    let top = Infinity;
    let left = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const child of el.children) {
      const r = child.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      top = Math.min(top, r.top);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    const info = { uid: el.dataset.editBlock ?? "", type: el.dataset.editType ?? "", label: el.dataset.editLabel ?? "" };
    if (top === Infinity) return { ...info, top: lastBottom, left: 0, width: document.documentElement.clientWidth, height: 0 };
    const box = { ...info, top: top + sy, left: left + sx, width: right - left, height: bottom - top };
    lastBottom = box.top + box.height;
    return box;
  });
}

function markerY(boxes: Box[], index: number): number {
  if (!boxes.length) {
    const main = document.getElementById("contenu");
    return (main?.getBoundingClientRect().top ?? 0) + window.scrollY + 24;
  }
  if (index <= 0) return boxes[0].top;
  if (index >= boxes.length) return boxes[boxes.length - 1].top + boxes[boxes.length - 1].height;
  const prev = boxes[index - 1];
  return (prev.top + prev.height + boxes[index].top) / 2;
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export default function EditLayer() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("off");
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [viewTop, setViewTop] = useState(0);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const editing = useRef<{ el: HTMLElement; uid: string; original: string } | null>(null);
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
    setViewTop(window.scrollY);
    if (pendingScroll.current) {
      const box = next.find((b) => b.uid === pendingScroll.current);
      if (box) {
        pendingScroll.current = null;
        window.scrollTo({ top: Math.max(0, box.top - 80), behavior: "smooth" });
      }
    }
    const order = next.map((b) => b.uid).join(",");
    if (order !== lastOrder.current) {
      lastOrder.current = order;
      post({ kind: "blocks", blocks: next.map(({ uid, type, label }) => ({ uid, type, label })) });
    }
  }, []);

  const select = useCallback((uid: string | null, notify = true) => {
    setSelected(uid);
    if (notify) post({ kind: "select", uid });
  }, []);

  /* ---- Texte en place ---------------------------------------------------- */

  const finishEdit = useCallback((commit: boolean) => {
    const current = editing.current;
    if (!current) return;
    editing.current = null;
    const { el, uid, original } = current;
    const value = (el.textContent ?? "").replace(/\s*\n\s*/g, " ");
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-editing");
    if (!commit) {
      el.textContent = original;
      return;
    }
    const locale = document.documentElement.lang === "en" ? "en" : "fr";
    if (value !== original) post({ kind: "text", uid, path: el.dataset.inline ?? "", locale, value: value.slice(0, 2000) });
  }, []);

  const startEdit = useCallback(
    (el: HTMLElement) => {
      const block = el.closest<HTMLElement>("[data-edit-block]");
      if (!block?.dataset.editBlock) return;
      finishEdit(true);
      select(block.dataset.editBlock);
      editing.current = { el, uid: block.dataset.editBlock, original: el.textContent ?? "" };
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
          router.refresh();
          break;
        case "drag": {
          // Média glissé : cible d'une planche (BoardLayer), pas d'un bloc.
          if (msg.payload === "media") break;
          const y = msg.y + window.scrollY;
          const index = insertionIndex(
            boxesRef.current.map((b) => b.top + b.height / 2),
            y,
          );
          setDrag({ source: "palette", label: msg.label, x: msg.x, y: msg.y });
          setDropIndex(index);
          post({ kind: "drag-index", index });
          if (msg.y < EDGE) window.scrollBy(0, -16);
          else if (msg.y > window.innerHeight - EDGE) window.scrollBy(0, 16);
          break;
        }
        case "drag-end":
          setDrag(null);
          setDropIndex(null);
          break;
      }
    };
    window.addEventListener("message", onMessage);
    const blocks = measure().map(({ uid, type, label }) => ({ uid, type, label }));
    lastOrder.current = blocks.map((b) => b.uid).join(",");
    post({ kind: "ready", path: window.location.pathname, locale: document.documentElement.lang, blocks });
    return () => {
      window.removeEventListener("message", onMessage);
      hostEl?.remove();
    };
  }, [router, finishEdit]);

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
    mutations.observe(document.getElementById("contenu") ?? document.body, { childList: true, subtree: true });
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

  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-edit-mode", mode === "edit");
    return () => root.removeAttribute("data-edit-mode");
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
    const blockOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-edit-block]") : null);

    const onMove = (e: PointerEvent) => {
      if (inLayer(e.target)) return;
      setHover(blockOf(e.target)?.dataset.editBlock ?? null);
    };
    const onLeave = () => setHover(null);
    const onClick = (e: MouseEvent) => {
      if (inLayer(e.target)) return;
      if (editing.current && e.target instanceof Node && editing.current.el.contains(e.target)) return;
      // Liens, boutons et visionneuses du site restent inertes en édition.
      e.preventDefault();
      e.stopPropagation();
      const uid = blockOf(e.target)?.dataset.editBlock ?? null;
      finishEdit(true);
      select(uid);
    };
    const onDblClick = (e: MouseEvent) => {
      if (inLayer(e.target)) return;
      const field = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-inline]") : null;
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
        if (uid) select(null);
        else post({ kind: "key", key: "escape" });
        return;
      }
      if (!uid) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        post({ kind: "op", op: "delete", uid });
      } else if (e.key === "Enter" && (!inLayer(e.target) || (e.target instanceof HTMLElement && e.target.dataset.uid === uid))) {
        // Entrée sur le bloc choisi (ou hors des boutons) : son premier texte se modifie.
        const field = document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(uid)}"] [data-inline]`);
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

  /* ---- Réordonner par la poignée ------------------------------------------ */

  const onGripDown = (e: React.PointerEvent<HTMLButtonElement>, box: Box) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    finishEdit(true);
    document.documentElement.setAttribute("data-edit-dragging", "");
    let index: number | null = null;
    let raf = 0;
    let lastY = e.clientY;
    const update = (x: number, y: number) => {
      lastY = y;
      index = insertionIndex(
        boxesRef.current.map((b) => b.top + b.height / 2),
        y + window.scrollY,
      );
      setDrag({ source: "canvas", uid: box.uid, label: box.label, x, y });
      setDropIndex(index);
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
      setDrag(null);
      setDropIndex(null);
      const from = boxesRef.current.findIndex((b) => b.uid === box.uid);
      if (commit && index !== null && from >= 0 && index !== from && index !== from + 1) post({ kind: "move", uid: box.uid, index });
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

  const boards = <BoardLayer mode={mode} host={host} announce={setAnnouncement} />;
  if (mode !== "edit" || !host) return boards;

  const sel = boxes.find((b) => b.uid === selected);
  const hov = hover && hover !== selected ? boxes.find((b) => b.uid === hover) : undefined;
  const index = (uid: string) => boxes.findIndex((b) => b.uid === uid);
  const draggingUid = drag?.source === "canvas" ? drag.uid : null;

  const blocksLayer = createPortal(
    <div className="pe-layer" lang="fr">
      {/* Cibles clavier : Tab parcourt les blocs, Entrée en choisit un. */}
      {boxes.map((b, i) => (
        <button
          key={`f-${b.uid}`}
          type="button"
          className="pe-focus"
          aria-label={`Bloc ${i + 1} sur ${boxes.length} : ${b.label}${b.uid === selected ? " (sélectionné)" : ""}`}
          aria-pressed={b.uid === selected}
          style={{ top: b.top, left: b.left, width: b.width, height: Math.max(b.height, 8) }}
          onFocus={() => setHover(b.uid)}
          onBlur={() => setHover(null)}
          data-uid={b.uid}
          onClick={() => select(b.uid)}
        />
      ))}

      {hov && (
        <div className="pe-box pe-hover" style={{ top: hov.top, left: hov.left, width: hov.width, height: hov.height }} aria-hidden="true">
          <span className="pe-tag pe-tag-soft">{hov.label}</span>
        </div>
      )}

      {sel && (
        <div
          className="pe-box pe-selected"
          data-dragging={draggingUid === sel.uid || undefined}
          style={{ top: sel.top, left: sel.left, width: sel.width, height: sel.height }}
        >
          <span className="pe-tag">{sel.label}</span>
          <div
            className="pe-tools"
            role="toolbar"
            aria-label={`Bloc ${sel.label}`}
            // Reste visible quand le haut du bloc sort de l'écran.
            style={{ top: Math.min(Math.max(0, viewTop + 8 - sel.top), Math.max(0, sel.height - 34)) }}
          >
            <button type="button" className="pe-grip" aria-label="Glisser pour déplacer" title="Glisser pour déplacer" onPointerDown={(e) => onGripDown(e, sel)}>
              <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                {[3, 8, 13].flatMap((y) => [2.5, 7.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" fill="currentColor" />))}
              </svg>
            </button>
            <button type="button" aria-label="Monter" title="Monter" disabled={index(sel.uid) === 0} onClick={() => post({ kind: "op", op: "up", uid: sel.uid })}>
              ↑
            </button>
            <button
              type="button"
              aria-label="Descendre"
              title="Descendre"
              disabled={index(sel.uid) === boxes.length - 1}
              onClick={() => post({ kind: "op", op: "down", uid: sel.uid })}
            >
              ↓
            </button>
            <button type="button" aria-label="Dupliquer" title="Dupliquer" onClick={() => post({ kind: "op", op: "duplicate", uid: sel.uid })}>
              ⧉
            </button>
            <button type="button" className="pe-danger" aria-label="Supprimer" title="Supprimer (Suppr)" onClick={() => post({ kind: "op", op: "delete", uid: sel.uid })}>
              ✕
            </button>
          </div>
        </div>
      )}

      {boxes.length === 0 && (
        <div className="pe-empty" style={{ top: markerY(boxes, 0) }} data-over={dropIndex !== null || undefined}>
          Page vide : glisse un composant ici depuis « Ajouter », ou clique sur l&apos;un d&apos;eux.
        </div>
      )}

      {drag && dropIndex !== null && boxes.length > 0 && (
        <div className="pe-marker" style={{ top: markerY(boxes, dropIndex) }} aria-hidden="true">
          <span>Déposer ici</span>
        </div>
      )}

      {drag?.source === "canvas" && (
        <div className="pe-ghost" style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 10}px)` }} aria-hidden="true">
          {drag.label}
        </div>
      )}

      <p className="pe-live" role="status" aria-live="polite">
        {drag && dropIndex !== null ? `Position ${dropIndex + 1} sur ${boxes.length + (drag.source === "palette" ? 1 : 0)}` : announcement}
      </p>
    </div>,
    host,
  );
  return (
    <>
      {boards}
      {blocksLayer}
    </>
  );
}
