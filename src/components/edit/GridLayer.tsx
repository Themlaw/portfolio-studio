"use client";

/**
 * Grille unifiée sur la toile (lot 31d, retouches du lot 31e) : le même outil pour la grille d'une page et celle d'une planche.
 *
 * - Fenêtre « Réglages » (bouton « Réglages » de la barre du bloc grille, page ou planche) : une fenêtre BLANCHE, au style de la
 *   fenêtre « Aa » du texte, ancrée sous la barre : agencement (vignettes), espace entre les images, format des cases, colonnes
 *   et inversion (Sur mesure), « + Case », « Adapter aux images », « Plus de réglages… » (panneau de gauche). Rien ne s'ouvre
 *   tout seul : choisir la grille ne montre que la barre habituelle du bloc.
 * - Barre d'une case remplie (au survol, ou au toucher) : blanche aussi, accrochée à l'image ou à la vidéo elle-même (en haut à
 *   gauche, jamais au bas d'une case plus haute que l'image) : poignée (glisser pour déplacer, ou déposer sur une autre case
 *   pour les ÉCHANGER), numéro, Remplacer, Retirer, Cadrer, Cadre, Taille.
 * - Numéros des cases de la grille choisie : on voit toujours dans quel ordre les images se rangent.
 *
 * Tout passe par le message `grid-op` (repères : grid-dom.ts) ; l'éditeur l'applique au brouillon de la page ou à la planche
 * du projet (Annuler / Rétablir comme tout le reste). Rien de ceci n'existe en public.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { FORMAT_KEYS, FORMAT_LABELS } from "@/lib/images/formats";
import { AUTO_HINT, GRID_LAYOUT_LABELS, GRID_LAYOUTS, JUSTIFY_HINT, type GridLayout } from "@/blocks/grid-layouts";
import type { GridCanvasOp } from "@/lib/edit/protocol";
import { FrameControls } from "./FrameMenu";
import GridLayoutIcon from "./GridLayoutIcon";
import { lookOf, sendLook } from "./LookLayer";
import { postIntent } from "./optimistic";
import { cellIndex, cellsOf, gridRefOf, type GridRef } from "./grid-dom";
import { useDismiss } from "./useDismiss";
import type { Frame } from "@/lib/look";
import { VIDEO_MODE_HINTS, VIDEO_MODE_LABELS, VIDEO_MODES } from "@/blocks/video-mode";

type Rect = { top: number; left: number; width: number; height: number };

const docRect = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
};

const GAPS: { value: string; label: string; title: string }[] = [
  { value: "none", label: "Aucun", title: "Aucun espace entre les images" },
  { value: "tight", label: "S", title: "Petit espace" },
  { value: "normal", label: "M", title: "Espace moyen" },
  { value: "wide", label: "L", title: "Grand espace" },
];

/** Envoie une opération de grille à l'éditeur. */
function send(ref: GridRef, op: GridCanvasOp) {
  postIntent({ kind: "grid-op", uid: ref.uid, ...(ref.board ? { board: ref.board, ...(ref.props ? { props: ref.props } : {}) } : {}), op });
}

/** La grille (page ou planche) que la sélection actuelle désigne, ou null. */
function activeGrid(selected: string | null): HTMLElement | null {
  const board = document.querySelector<HTMLElement>("[data-edit-bitem][data-selected] .block-grid[data-edit-grid]");
  if (board) return board;
  if (!selected || selected.startsWith("site-")) return null;
  const wrapper = document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(selected)}"]`);
  if (!wrapper) return null;
  if (wrapper.dataset.editType === "grid") return wrapper.querySelector<HTMLElement>(".block-grid[data-edit-grid]");
  return wrapper.parentElement?.closest<HTMLElement>(".block-grid[data-edit-grid]") ?? null;
}

/** Hauteur approximative d'une barre de case (une rangée). */
const CELLBAR_H = 40;

/** Haut de la barre de case (document) : sur l'image, 36 px sous son bord (fil d'Ariane de la case choisie) ; sinon, juste dessous. */
function cellBarTop(r: Rect, stuck: number): number {
  const visibleTop = window.scrollY + Math.max(0, stuck) + 6;
  const onTop = r.top + 36;
  // Image trop basse pour porter la barre : juste en dessous, collée à son bord.
  if (r.height < CELLBAR_H + 44) return r.top + r.height + 6;
  const top = Math.max(onTop, visibleTop);
  return Math.max(r.top + 4, Math.min(top, r.top + r.height - CELLBAR_H - 4, window.scrollY + window.innerHeight - CELLBAR_H - 6));
}

/** Menu « Taille » d'une case : quatre mots simples (frère de la barre, jamais son enfant : la barre a un `transform`). */
function SizeMenu({ top, left, onClose, children }: { top: number; left: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  return (
    <div ref={ref} className="pe-gridmenu pe-gridmenu-ratios" role="menu" aria-label="Taille de la case" style={{ top, left }}>
      {children}
    </div>
  );
}

/** Grille désignée par la fenêtre Réglages : une rubrique de page (`uid`) ou un composant de planche (`uid` + `board`). */
type SettingsFor = { uid: string; board?: number };

/** La grille, et la barre du bloc où la fenêtre s'ancre. */
function settingsTarget(t: SettingsFor): { grid: HTMLElement; bar: HTMLElement | null; frame: HTMLElement | null } | null {
  if (t.board) {
    const frame = document.querySelector<HTMLElement>(`[data-edit-bitem="${CSS.escape(t.uid)}"][data-board="${t.board}"]`);
    const grid = frame?.querySelector<HTMLElement>(".block-grid[data-edit-grid]");
    return frame && grid ? { grid, bar: frame.querySelector<HTMLElement>(".pe-bitem-bar"), frame } : null;
  }
  const wrapper = document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(t.uid)}"]`);
  const grid = wrapper?.dataset.editType === "grid" ? wrapper.querySelector<HTMLElement>(".block-grid[data-edit-grid]") : null;
  return grid ? { grid, bar: document.querySelector<HTMLElement>(".pe-tools"), frame: null } : null;
}

/** Fenêtre « Réglages » de la grille : blanche, au style de la fenêtre « Aa » (classes `sm tc`, tokens `--lk-*`). */
function GridSettings({ grid, gref, top, left, onClose }: { grid: HTMLElement; gref: GridRef; top: number; left: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose, { ignore: (t) => Boolean(t.closest("[data-grid-settings-button]")) });
  // Échap ferme la fenêtre et rien d'autre : la grille reste choisie (sinon le même Échap remonterait aussi au parent).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const layout = (grid.dataset.layout ?? "2") as GridLayout;
  const gap = grid.dataset.gap ?? "normal";
  const ratio = grid.dataset.ratio ?? "auto";
  const cols = Number(grid.dataset.cols ?? grid.dataset.gridCols ?? 3);
  const mirrored = grid.hasAttribute("data-mirror");
  const count = cellsOf(grid).filter((c) => c.hasAttribute("data-edit-cell")).length;
  const custom = layout === "custom";
  const auto = layout === "auto";
  const set = (patch: Omit<Extract<GridCanvasOp, { op: "set" }>, "op">) => send(gref, { op: "set", ...patch });
  return (
    <div ref={ref} className="sm tc pe-gs" role="dialog" aria-label="Réglages de la grille" data-testid="gridsettings" style={{ top, left, right: "auto" }}>
      <div className="pe-gs-head">
        <span className="pe-gs-title">Réglages de la grille</span>
        <button type="button" className="pe-gs-close" aria-label="Fermer" data-testid="gridsettings-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="pe-gs-block">
        <span className="sm-label pe-gs-label" id="pe-gs-layout">
          Agencement
        </span>
        <div className="pe-gs-layouts" role="radiogroup" aria-labelledby="pe-gs-layout" data-testid="gridbar-layout">
          {GRID_LAYOUTS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={layout === l} aria-label={GRID_LAYOUT_LABELS[l]} title={GRID_LAYOUT_LABELS[l]} data-layout={l} className="pe-gm-layout pe-gs-layout" onClick={() => set({ layout: l })}>
              <GridLayoutIcon layout={l} />
              <span>{GRID_LAYOUT_LABELS[l]}</span>
            </button>
          ))}
        </div>
        {(auto || grid.hasAttribute("data-justify")) && (
          <p className="sm-hint" data-testid="gridsettings-auto-hint">
            {grid.hasAttribute("data-justify") ? JUSTIFY_HINT : AUTO_HINT}
          </p>
        )}
      </div>
      <div className="tc-row pe-gs-row">
        <span className="sm-label" id="pe-gs-gap">
          Espace entre les images
        </span>
        <span className="pe-gs-seg" role="radiogroup" aria-labelledby="pe-gs-gap" data-testid="gridbar-gap">
          {GAPS.map((g) => (
            <button key={g.value} type="button" role="radio" aria-checked={gap === g.value} data-gap={g.value} title={g.title} aria-label={g.title} onClick={() => set({ gap: g.value as "none" | "tight" | "normal" | "wide" })}>
              {g.label}
            </button>
          ))}
        </span>
      </div>
      <div className="pe-gs-block">
        <span className="sm-label pe-gs-label" id="pe-gs-ratio">
          Format des cases
        </span>
        <div className="pe-gs-seg pe-gs-ratios" role="radiogroup" aria-labelledby="pe-gs-ratio" data-testid="gridbar-ratio">
          {FORMAT_KEYS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={ratio === k} data-ratio={k} className="pe-gm-ratio" onClick={() => set({ ratio: k })}>
              {FORMAT_LABELS[k]}
            </button>
          ))}
        </div>
        <p className="sm-hint">Les vidéos gardent leur cadre 16:9.</p>
      </div>
      {(custom || auto) && (
        <div className="tc-row pe-gs-row">
          <span className="sm-label" id="pe-gs-cols">
            Colonnes
          </span>
          <span className="pe-gs-seg" role="radiogroup" aria-labelledby="pe-gs-cols" data-testid="gridbar-cols">
            {[2, 3, 4].map((c) => (
              <button key={c} type="button" role="radio" aria-checked={cols === c} data-cols={c} onClick={() => set({ cols: c })}>
                {c}
              </button>
            ))}
          </span>
          {custom && (
            <button type="button" role="switch" aria-checked={mirrored} data-testid="gridbar-mirror" title="Inverser la gauche et la droite" onClick={() => set({ mirror: !mirrored })}>
              Inverser
            </button>
          )}
        </div>
      )}
      <div className="tc-row pe-gs-row pe-gs-actions">
        <button type="button" data-testid="gridbar-add" title="Ajouter une image ou une vidéo à la suite" onClick={() => send(gref, { op: "pick", index: count })}>
          + Case
        </button>
        {!auto && (
          <button type="button" data-testid="gridbar-adapt" disabled={count === 0} title="Donne à chaque case la forme de son image : un portrait sur deux rangées, un panorama sur toute la largeur" onClick={() => send(gref, { op: "adapt" })}>
            Adapter aux images
          </button>
        )}
        <button
          type="button"
          className="pe-gs-more"
          data-testid="gridsettings-more"
          title="Ouvre le panneau de gauche : alignement, titre, espace au-dessus…"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("pe:open-panel", { detail: { uid: gref.uid, ...(gref.board ? { board: gref.board } : {}) } }));
            onClose();
          }}
        >
          Plus de réglages…
        </button>
      </div>
    </div>
  );
}

type CellDrag = { grid: HTMLElement; ref: GridRef; from: number; x: number; y: number; target: number | null; active: boolean };

/** Fenêtre « Cadre » d'une case (même contenu que le bouton Cadre d'une image seule). */
function CellFrame({ uid, top, left, onClose }: { uid: string; top: number; left: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const [frame, setFrame] = useState<Frame | undefined>(() => lookOf(uid).frame);
  return (
    <div ref={ref} className="sm tc" role="dialog" aria-label="Cadre de la photo" data-testid="frame-menu" style={{ top, left, right: "auto" }}>
      <FrameControls
        value={frame}
        onChange={(next) => {
          setFrame(next);
          sendLook(uid, { ...lookOf(uid), frame: next });
        }}
      />
    </div>
  );
}

export default function GridLayer({ selected, dragging, announce }: { selected: string | null; dragging: boolean; announce: (s: string) => void }) {
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<HTMLElement | null>(null);
  const [frameFor, setFrameFor] = useState<{ uid: string; top: number; left: number } | null>(null);
  const [drag, setDrag] = useState<CellDrag | null>(null);
  const [sizeMenu, setSizeMenu] = useState<{ uid: string; top: number; left: number } | null>(null);
  const [settings, setSettings] = useState<SettingsFor | null>(null);
  const dragRef = useRef<CellDrag | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const startDrag = useCallback((d: CellDrag) => {
    dragRef.current = d;
  }, []);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(bump);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-selected", "data-layout", "data-gap", "data-ratio", "data-cols", "data-mirror", "data-cell-w", "data-cell-h", "data-justify", "data-jalone"] });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("load", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("load", schedule, true);
    };
  }, [bump]);

  // « Réglages » du bloc grille (page : barre de la rubrique ; planche : barre du composant) : ouvre ou ferme la fenêtre.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ uid?: string; board?: number }>).detail;
      if (!d?.uid) return;
      setSettings((cur) => (cur && cur.uid === d.uid && cur.board === d.board ? null : { uid: d.uid!, ...(d.board ? { board: d.board } : {}) }));
      setFrameFor(null);
      setSizeMenu(null);
      // Une seule fenêtre à la fois : les autres (Fond, Cadre, Carte, Aa) se ferment.
      window.dispatchEvent(new CustomEvent("pe:popups-close", { detail: { except: "grid-settings" } }));
    };
    const onClose = (e: Event) => {
      if ((e as CustomEvent<{ except?: string }>).detail?.except !== "grid-settings") setSettings(null);
    };
    window.addEventListener("pe:grid-settings", onOpen);
    window.addEventListener("pe:popups-close", onClose);
    return () => {
      window.removeEventListener("pe:grid-settings", onOpen);
      window.removeEventListener("pe:popups-close", onClose);
    };
  }, []);

  // Le composant de planche garde sa barre visible tant que sa fenêtre Réglages est ouverte.
  useEffect(() => {
    if (!settings?.board) return;
    const frame = settingsTarget(settings)?.frame;
    frame?.setAttribute("data-grid-settings", "");
    return () => frame?.removeAttribute("data-grid-settings");
  }, [settings]);

  // Survol (ou toucher) d'une case remplie : sa barre s'affiche.
  useEffect(() => {
    const inLayer = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest(".pe-layer"));
    const cellAt = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>(".block-grid-cell[data-edit-cell]") : null);
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) return;
      if (inLayer(e.target)) {
        clearTimeout(hideTimer.current);
        return;
      }
      const cell = cellAt(e.target);
      clearTimeout(hideTimer.current);
      if (cell) setHover((h) => (h === cell ? h : cell));
      else hideTimer.current = setTimeout(() => setHover(null), 450);
    };
    const onDown = (e: PointerEvent) => {
      if (inLayer(e.target)) return;
      const cell = cellAt(e.target);
      setHover(cell);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown, true);
      clearTimeout(hideTimer.current);
    };
  }, []);

  // Glisser une case (poignée de sa barre) : sur une autre case, elles s'échangent ; sur une place libre, elle passe en dernier.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !el.closest(".pe-layer"));
      const cell = hit?.closest<HTMLElement>(".block-grid-cell[data-cell-index]");
      const same = cell && cell.parentElement === d.grid ? cell : null;
      const target = same ? cellIndex(same) : null;
      const next = { ...d, x: e.clientX, y: e.clientY, active: true, target };
      if (!d.active) {
        document.documentElement.setAttribute("data-edit-dragging", "");
        try {
          window.getSelection()?.removeAllRanges();
        } catch {}
      }
      dragRef.current = next;
      setDrag(next);
      if (e.clientY < 64) window.scrollBy(0, -14);
      else if (e.clientY > window.innerHeight - 64) window.scrollBy(0, 14);
    };
    const end = (commit: boolean) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      document.documentElement.removeAttribute("data-edit-dragging");
      if (!d.active) return;
      // Le clic qui suit un glisser ne sélectionne rien.
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      document.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", swallow, { capture: true }), 0);
      if (!commit || d.target === null || d.target === d.from) return;
      const filled = cellsOf(d.grid).filter((c) => c.hasAttribute("data-edit-cell")).length;
      if (d.target < filled) {
        send(d.ref, { op: "swap", a: d.from, b: d.target });
        announce(`Les images des cases ${d.from + 1} et ${d.target + 1} sont échangées.`);
      } else if (d.from !== filled - 1) {
        send(d.ref, { op: "move", from: d.from, to: filled - 1 });
        announce(`L'image de la case ${d.from + 1} passe en dernier.`);
      }
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && end(false);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancel, true);
      document.removeEventListener("keydown", esc, true);
    };
  }, [announce]);

  if (dragging) return null;
  void tick;
  const active = activeGrid(selected);
  // Barre : la case survolée, sinon la case choisie (page : l'image sélectionnée dans la grille).
  const selectedCell = selected && !selected.startsWith("site-") ? (document.querySelector(`[data-edit-block="${CSS.escape(selected)}"]`)?.closest<HTMLElement>(".block-grid-cell[data-edit-cell]") ?? null) : null;
  const hoverCell = hover && document.contains(hover) ? hover : selectedCell;
  const hoverGrid = hoverCell?.parentElement?.matches("[data-edit-grid]") ? hoverCell.parentElement : null;
  const hoverRef = hoverGrid ? gridRefOf(hoverGrid) : null;
  // Numéros : sur la grille choisie et sur celle qu'on survole.
  const numbered = [active, hoverGrid].filter((g, i, a): g is HTMLElement => Boolean(g) && a.indexOf(g) === i);

  // Fenêtre Réglages : sous la barre du bloc (à son bord droit), jamais hors de l'écran.
  const target = settings ? settingsTarget(settings) : null;
  const settingsRef = target ? gridRefOf(target.grid) : null;
  let settingsView: React.ReactNode = null;
  if (settings && target && settingsRef) {
    const width = Math.min(460, document.documentElement.clientWidth - 16);
    const bar = target.bar ? docRect(target.bar) : null;
    const g = docRect(target.grid);
    const right = bar ? bar.left + bar.width : g.left + g.width;
    const top = bar ? bar.top + bar.height + 6 : g.top + 8;
    const left = Math.max(window.scrollX + 8, Math.min(right - width, window.scrollX + document.documentElement.clientWidth - width - 8));
    settingsView = <GridSettings key={`${settings.board ?? 0}-${settings.uid}`} grid={target.grid} gref={settingsRef} top={top} left={left} onClose={() => setSettings(null)} />;
  }

  const hdr = document.querySelector("header");
  const stuck = hdr && ["fixed", "sticky"].includes(getComputedStyle(hdr).position) ? hdr.getBoundingClientRect().bottom : 0;

  const hdrBottom = Math.max(0, stuck);
  const cellBar = (cell: HTMLElement, gref: GridRef) => {
    const uid = cell.dataset.editCell ?? "";
    const index = cellIndex(cell);
    const type = cell.dataset.cellType ?? "image";
    const image = type === "image";
    // Une case de texte (page) n'a ni image à remplacer ni cadre : seulement sa place et sa taille.
    const media = type === "image" || type === "video-single";
    // La barre s'accroche à l'image ou à la vidéo elle-même (pas à la case, qui peut être bien plus haute : une place vide voisine,
    // un portrait sur deux rangées…) : en haut à gauche de ce que l'on voit, dans la partie visible de l'écran.
    const mediaEl = cell.querySelector<HTMLElement>(".block-image-media, [data-edit-media] img, video, img");
    const mr = mediaEl ? docRect(mediaEl) : null;
    const r = mr && mr.width > 0 && mr.height > 0 ? mr : docRect(cell);
    const w = Number(cell.dataset.cellW ?? 1);
    const h = Number(cell.dataset.cellH ?? 1);
    const cols = Number(gref.grid.dataset.cols ?? gref.grid.dataset.gridCols ?? 3);
    // Rangées justifiées (lots 37, 37b) : la taille se résume à « Seule sur sa ligne » ou « Avec les autres ».
    const justified = gref.grid.hasAttribute("data-justify");
    const alone = cell.hasAttribute("data-jalone");
    const maxW = gref.grid.dataset.layout === "custom" ? cols : Number(gref.grid.dataset.gridCols ?? 2);
    const n = index + 1;
    return (
      <Fragment key={`bar-${uid}`}>
      <div
        className="pe-cellbar"
        role="toolbar"
        aria-label={`Case ${n}`}
        data-testid="cellbar"
        data-cell={uid}
        // Collée au haut de l'image (sous le fil d'Ariane de la case choisie), à gauche ; si le haut sort de l'écran, elle reste dans
        // la partie visible de l'image. Une image très peu haute : la barre passe juste dessous, jamais loin dans le vide.
        style={{
          top: cellBarTop(r, mediaEl ? hdrBottom : 0),
          left: r.left + 6,
          maxWidth: Math.max(160, r.width - 12),
        }}
      >
        <span
          className="pe-cb-handle"
          role="button"
          tabIndex={0}
          aria-label={`Déplacer la case ${n} : glisse-la sur une autre case pour échanger les deux images`}
          title="Glisse sur une autre case pour échanger les deux images"
          data-testid="cell-handle"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const d: CellDrag = { grid: gref.grid, ref: gref, from: index, x: e.clientX, y: e.clientY, target: null, active: false };
            startDrag(d);
          }}
        >
          ⠿
        </span>
        <span className="pe-cb-num" aria-hidden="true">
          {n}
        </span>
        {media && (
          <button type="button" className="pe-cb-btn" data-cb="replace" onClick={() => send(gref, { op: "pick", index })}>
            Remplacer
          </button>
        )}
        <button type="button" className="pe-cb-btn pe-cb-danger" data-cb="remove" onClick={() => send(gref, { op: "remove", index })}>
          Retirer
        </button>
        {type === "video-single" && cell.querySelector("[data-video-mode]") && (
          <span className="pe-seg" role="group" aria-label="Lecture de la vidéo" data-testid="cell-video-mode">
            <span className="pe-seg-label" aria-hidden="true">
              Lecture
            </span>
            {VIDEO_MODES.map((m) => (
              <button
                key={m}
                type="button"
                className="pe-cb-btn"
                data-cb={`video-${m}`}
                aria-pressed={cell.querySelector("[data-video-mode]")?.getAttribute("data-video-mode") === m}
                title={VIDEO_MODE_HINTS[m]}
                onClick={() => send(gref, { op: "video-mode", index, mode: m })}
              >
                {VIDEO_MODE_LABELS[m]}
              </button>
            ))}
          </span>
        )}
        {image && (
          <>
            <button type="button" className="pe-cb-btn" data-cb="crop" onClick={() => window.dispatchEvent(new CustomEvent("pe:crop", { detail: { cell: uid } }))}>
              Cadrer
            </button>
            <button
              type="button"
              className="pe-cb-btn"
              data-cb="frame"
              aria-haspopup="dialog"
              aria-expanded={frameFor?.uid === uid}
              onClick={(e) => {
                const b = e.currentTarget.getBoundingClientRect();
                setFrameFor((f) => (f?.uid === uid ? null : { uid, top: b.bottom + window.scrollY + 4, left: Math.max(window.scrollX + 8, Math.min(b.left + window.scrollX - 120, window.scrollX + window.innerWidth - 348)) }));
              }}
            >
              Cadre
            </button>
          </>
        )}
        <button
          type="button"
          className="pe-cb-btn"
          data-cb="size"
          aria-haspopup="menu"
          aria-expanded={sizeMenu?.uid === uid}
          onClick={(e) => {
            const bb = e.currentTarget.getBoundingClientRect();
            setSizeMenu((m) => (m?.uid === uid ? null : { uid, top: bb.bottom + window.scrollY + 4, left: Math.max(window.scrollX + 8, Math.min(bb.left + window.scrollX, window.scrollX + window.innerWidth - 190)) }));
          }}
        >
          Taille ▾
        </button>
      </div>
        {sizeMenu?.uid === uid && (
          <SizeMenu top={sizeMenu.top} left={sizeMenu.left} onClose={() => setSizeMenu(null)}>
            {justified
              ? (
                  [
                    ["alone", "Seule sur sa ligne", true],
                    ["with-others", "Avec les autres", false],
                  ] as const
                ).map(([k, label, value]) => (
                  <button key={k} type="button" role="menuitemradio" aria-checked={alone === value} className="pe-gm-ratio" data-cb={k} onClick={() => { send(gref, { op: "alone", index, alone: value }); setSizeMenu(null); }}>
                    {label}
                  </button>
                ))
              : (
              [
                ["wider", "Plus large", w >= maxW, { dw: 1 }],
                ["narrower", "Moins large", w <= 1, { dw: -1 }],
                ["taller", "Plus haute", h >= 2, { dh: 1 }],
                ["shorter", "Moins haute", h <= 1, { dh: -1 }],
              ] as const
            ).map(([k, label, off, step]) => (
              <button key={k} type="button" role="menuitem" className="pe-gm-ratio" data-cb={k} disabled={off} onClick={() => { send(gref, { op: "span", index, ...step }); setSizeMenu(null); }}>
                {label}
              </button>
            ))}
          </SizeMenu>
        )}
      </Fragment>
    );
  };

  const dragTarget = drag?.active && drag.target !== null ? cellsOf(drag.grid).find((c) => cellIndex(c) === drag.target) : null;
  const dragSource = drag?.active ? cellsOf(drag.grid).find((c) => cellIndex(c) === drag.from) : null;
  const filledCount = drag ? cellsOf(drag.grid).filter((c) => c.hasAttribute("data-edit-cell")).length : 0;

  return (
    <div className="pe-layer pe-grid-layer" lang="fr">
      {numbered.flatMap((g) =>
        cellsOf(g)
          .filter((c) => c.hasAttribute("data-edit-cell") && c !== hoverCell)
          .map((c) => {
            const r = docRect(c);
            return (
              <span key={`n-${c.dataset.editCell}`} className="pe-cell-badge" aria-hidden="true" style={{ top: r.top + 6, left: r.left + 6 }}>
                {cellIndex(c) + 1}
              </span>
            );
          }),
      )}
      {settingsView}
      {!drag && hoverCell && hoverRef && cellBar(hoverCell, hoverRef)}
      {frameFor && <CellFrame uid={frameFor.uid} top={frameFor.top} left={frameFor.left} onClose={() => setFrameFor(null)} />}
      {dragSource && (() => {
        const r = docRect(dragSource);
        return <div className="pe-cell-source" style={{ top: r.top, left: r.left, width: r.width, height: r.height }} aria-hidden="true" />;
      })()}
      {dragTarget && (() => {
        const r = docRect(dragTarget);
        const free = dragTarget.hasAttribute("data-edit-cell-free");
        return (
          <div className="pe-cell-target" data-testid="cell-target" style={{ top: r.top, left: r.left, width: r.width, height: r.height }} aria-hidden="true">
            <span>{free ? `Passe en dernier (case ${filledCount})` : `Échange avec la case ${cellIndex(dragTarget) + 1}`}</span>
          </div>
        );
      })()}
      {drag?.active && (
        <div className="pe-cell-ghost" style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 10}px)` }} aria-hidden="true">
          Case {drag.from + 1}
        </div>
      )}
    </div>
  );
}
