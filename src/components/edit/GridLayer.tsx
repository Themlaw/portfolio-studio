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
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { formatOptions } from "@/lib/images/formats";
import { GRID_LAYOUTS, keepsShape, type GridLayout } from "@/blocks/grid-layouts";
import type { GridCanvasOp } from "@/lib/edit/protocol";
import FrameWindow from "./FrameMenu";
import ImageBgWindow from "./ImageBgMenu";
import Popover, { type PopoverAnchor } from "./Popover";
import GridLayoutIcon from "./GridLayoutIcon";
import { lookOf, sendOwnMediaLook } from "./LookLayer";
import type { ImageBg } from "@/lib/look";
import { hasFondWrapper, postIntent } from "./optimistic";
import FondMenu, { FondButton } from "./FondMenu";
import { cellIndex, cellsOf, gridRefOf, type GridRef } from "./grid-dom";
import { VIDEO_MODES } from "@/blocks/video-mode";
import VideoSoundSeg from "./VideoSoundSeg";

type Rect = { top: number; left: number; width: number; height: number };

const docRect = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
};

const GAPS: { value: string; label: string; title: string }[] = [
  { value: "none", label: "gapNone", title: "gapNoneTitle" },
  { value: "tight", label: "S", title: "gapSmall" },
  { value: "normal", label: "M", title: "gapMedium" },
  { value: "wide", label: "L", title: "gapLarge" },
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

/** Le bouton `data-cb="<k>"` de la barre de la case `uid` : l'ancre de sa fenêtre (retrouvée à chaque calcul). */
const cellAnchor = (uid: string, k: string) => `[data-testid="cellbar"][data-cell="${CSS.escape(uid)}"] [data-cb="${k}"]`;

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
function SizeMenu({ anchor, onClose, children }: { anchor: PopoverAnchor; onClose: () => void; children: React.ReactNode }) {
  const t = useTranslations("editMenusGrid");
  return (
    <Popover anchor={anchor} className="pe-gridmenu pe-gridmenu-ratios" role="menu" label={t("sizeOfCell")} onClose={onClose}>
      {children}
    </Popover>
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
function GridSettings({ grid, gref, anchor, onClose }: { grid: HTMLElement; gref: GridRef; anchor: PopoverAnchor; onClose: () => void }) {
  const t = useTranslations("editMenusGrid");
  const tl = useTranslations("blockRegLabels");
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
    <Popover anchor={anchor} className="sm tc pe-gs" label={t("settings")} testId="gridsettings" onClose={onClose} ignoreDismiss={(el) => Boolean(el.closest("[data-grid-settings-button]"))}>
      <div className="pe-gs-head">
        <span className="pe-gs-title">{t("settings")}</span>
        <button type="button" className="pe-gs-close" aria-label={t("close")} data-testid="gridsettings-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="pe-gs-block">
        <span className="sm-label pe-gs-label" id="pe-gs-layout">
          {t("layout")}
        </span>
        <div className="pe-gs-layouts" role="radiogroup" aria-labelledby="pe-gs-layout" data-testid="gridbar-layout">
          {GRID_LAYOUTS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={layout === l} aria-label={tl(`gridLayout.${l.replace(/\+/g, "_")}`)} title={tl(`gridLayout.${l.replace(/\+/g, "_")}`)} data-layout={l} className="pe-gm-layout pe-gs-layout" onClick={() => set({ layout: l })}>
              <GridLayoutIcon layout={l} />
              <span>{tl(`gridLayout.${l.replace(/\+/g, "_")}`)}</span>
            </button>
          ))}
        </div>
        {keepsShape({ layout, ratio: grid.dataset.ratio }) && (
          <p className="sm-hint" data-testid="gridsettings-keep-hint">
            {tl("keepShapeHint")}
          </p>
        )}
        {(auto || (grid.hasAttribute("data-justify") && !keepsShape({ layout, ratio: grid.dataset.ratio }))) && (
          <p className="sm-hint" data-testid="gridsettings-auto-hint">
            {grid.hasAttribute("data-justify") ? tl("justifyHint") : tl("autoHint")}
          </p>
        )}
      </div>
      <div className="tc-row pe-gs-row">
        <span className="sm-label" id="pe-gs-gap">
          {t("gap")}
        </span>
        <span className="pe-gs-seg" role="radiogroup" aria-labelledby="pe-gs-gap" data-testid="gridbar-gap">
          {GAPS.map((g) => (
            <button key={g.value} type="button" role="radio" aria-checked={gap === g.value} data-gap={g.value} title={t(g.title)} aria-label={t(g.title)} onClick={() => set({ gap: g.value as "none" | "tight" | "normal" | "wide" })}>
              {g.value === "none" ? t("gapNone") : g.label}
            </button>
          ))}
        </span>
      </div>
      <div className="pe-gs-block">
        <span className="sm-label pe-gs-label" id="pe-gs-ratio">
          {t("ratio")}
        </span>
        <div className="pe-gs-seg pe-gs-ratios" role="radiogroup" aria-labelledby="pe-gs-ratio" data-testid="gridbar-ratio">
          {/* Les mêmes formats que le panneau ; un ancien format déjà choisi (4:5, 16:9) reste coché au lieu de ne rien montrer. */}
          {formatOptions(ratio).map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={ratio === o.value} data-ratio={o.value} className="pe-gm-ratio" onClick={() => set({ ratio: o.value as "auto" })}>
              {o.label}
            </button>
          ))}
        </div>
        <p className="sm-hint">{t("videoRatioHint")}</p>
      </div>
      {(custom || auto) && (
        <div className="tc-row pe-gs-row">
          <span className="sm-label" id="pe-gs-cols">
            {t("columns")}
          </span>
          <span className="pe-gs-seg" role="radiogroup" aria-labelledby="pe-gs-cols" data-testid="gridbar-cols">
            {[2, 3, 4].map((c) => (
              <button key={c} type="button" role="radio" aria-checked={cols === c} data-cols={c} onClick={() => set({ cols: c })}>
                {c}
              </button>
            ))}
          </span>
          {custom && (
            <button type="button" role="switch" aria-checked={mirrored} data-testid="gridbar-mirror" title={t("mirrorTitle")} onClick={() => set({ mirror: !mirrored })}>
              {t("mirror")}
            </button>
          )}
        </div>
      )}
      <div className="tc-row pe-gs-row pe-gs-actions">
        <button type="button" data-testid="gridbar-add" title={t("addTitle")} onClick={() => send(gref, { op: "pick", index: count })}>
          {t("addCell")}
        </button>
        {!auto && (
          <button type="button" data-testid="gridbar-adapt" disabled={count === 0} title={t("adaptTitle")} onClick={() => send(gref, { op: "adapt" })}>
            {t("adapt")}
          </button>
        )}
        <button
          type="button"
          className="pe-gs-more"
          data-testid="gridsettings-more"
          title={t("moreTitle")}
          onClick={() => {
            window.dispatchEvent(new CustomEvent("pe:open-panel", { detail: { uid: gref.uid, ...(gref.board ? { board: gref.board } : {}) } }));
            onClose();
          }}
        >
          {t("more")}
        </button>
      </div>
    </Popover>
  );
}

type CellDrag = { grid: HTMLElement; ref: GridRef; from: number; x: number; y: number; target: number | null; active: boolean };

export default function GridLayer({ selected, dragging, announce }: { selected: string | null; dragging: boolean; announce: (s: string) => void }) {
  const t = useTranslations("editMenusGrid");
  const tl = useTranslations("blockRegLabels");
  const lang = useLocale().slice(0, 2);
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<HTMLElement | null>(null);
  const [frameFor, setFrameFor] = useState<{ uid: string } | null>(null);
  const [imgBgFor, setImgBgFor] = useState<{ uid: string } | null>(null);
  const [fondFor, setFondFor] = useState<string | null>(null);
  const [drag, setDrag] = useState<CellDrag | null>(null);
  const [sizeMenu, setSizeMenu] = useState<{ uid: string } | null>(null);
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
      setImgBgFor(null);
      setSizeMenu(null);
      // Une seule fenêtre à la fois : les autres (Fond, Cadre, Carte, Aa) se ferment.
      window.dispatchEvent(new CustomEvent("pe:popups-close", { detail: { except: "grid-settings" } }));
    };
    const onClose = (e: Event) => {
      if ((e as CustomEvent<{ except?: string }>).detail?.except !== "grid-settings") {
        setSettings(null);
        setImgBgFor(null);
      }
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
        announce(t("swapped", { from: d.from + 1, to: d.target + 1 }));
      } else if (d.from !== filled - 1) {
        send(d.ref, { op: "move", from: d.from, to: filled - 1 });
        announce(t("movedLast", { from: d.from + 1 }));
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
  }, [announce, t]);

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

  // Fenêtre Réglages : sous le bouton « Réglages » de la barre du bloc (Popover : jamais hors de l'écran).
  const target = settings ? settingsTarget(settings) : null;
  const settingsRef = target ? gridRefOf(target.grid) : null;
  let settingsView: React.ReactNode = null;
  if (settings && target && settingsRef) {
    const barButton = settings.board
      ? `[data-edit-bitem="${CSS.escape(settings.uid)}"][data-board="${settings.board}"] .pe-bitem-bar [data-grid-settings-button]`
      : '.pe-tools [data-grid-settings-button]';
    settingsView = <GridSettings key={`${settings.board ?? 0}-${settings.uid}`} grid={target.grid} gref={settingsRef} anchor={barButton} onClose={() => setSettings(null)} />;
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
    const mediaEl = cell.querySelector<HTMLElement>(".media-frame, [data-edit-media] img, video, img");
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
        aria-label={t("cellLabel", { n })}
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
          aria-label={t("handleLabel", { n })}
          title={t("handleTitle")}
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
            {t("replace")}
          </button>
        )}
        <button type="button" className="pe-cb-btn pe-cb-danger" data-cb="remove" onClick={() => send(gref, { op: "remove", index })}>
          {t("remove")}
        </button>
        {type === "video-single" && cell.querySelector("[data-video-mode]") && (
          <span className="pe-seg" role="group" aria-label={t("videoMode")} data-testid="cell-video-mode">
            <span className="pe-seg-label" aria-hidden="true">
              {t("videoModeShort")}
            </span>
            {VIDEO_MODES.map((m) => (
              <button
                key={m}
                type="button"
                className="pe-cb-btn"
                data-cb={`video-${m}`}
                aria-pressed={cell.querySelector("[data-video-mode]")?.getAttribute("data-video-mode") === m}
                title={tl(`videoMode.hint.${m}`)}
                onClick={() => send(gref, { op: "video-mode", index, mode: m })}
              >
                {tl(`videoMode.label.${m}`)}
              </button>
            ))}
          </span>
        )}
        {type === "video-single" && cell.querySelector("[data-video-audio]") && (
          // Son au départ (lot 127) : seulement pour une vidéo qui a du son (`data-video-audio`).
          <VideoSoundSeg
            now={cell.querySelector("[data-video-audio]")?.getAttribute("data-video-sound") === "off" ? "off" : "on"}
            onChange={(sound) => send(gref, { op: "video-sound", index, sound })}
            testId="cell-video-sound"
            attr="data-cb"
            prefix="sound-"
            className="pe-cb-btn"
          />
        )}
        {image && (
          <>
            <button type="button" className="pe-cb-btn" data-cb="crop" onClick={() => window.dispatchEvent(new CustomEvent("pe:crop", { detail: { cell: uid } }))}>
              {t("crop")}
            </button>
          </>
        )}
        {media && (
        <button
          type="button"
          className="pe-cb-btn"
          data-cb="frame"
          aria-haspopup="dialog"
          aria-expanded={frameFor?.uid === uid}
          onClick={() => {
            setImgBgFor(null);
            setFrameFor((f) => (f?.uid === uid ? null : { uid }));
          }}
        >
          {t("frame")}
        </button>
        )}
        {image && (
          <>
            <button
              type="button"
              className="pe-cb-btn"
              data-cb="imgbg"
              aria-haspopup="dialog"
              aria-expanded={imgBgFor?.uid === uid}
              title={t("bgTitle")}
              onClick={() => {
                const spot = { uid };
                const wasOpen = imgBgFor?.uid === uid;
                // Une seule fenêtre à la fois : pe:popups-close ferme celles des autres couches (et la nôtre), puis on ouvre la sienne.
                window.dispatchEvent(new CustomEvent("pe:popups-close"));
                setFrameFor(null);
                setSizeMenu(null);
                setImgBgFor(wasOpen ? null : spot);
              }}
            >
              {t("bg")}
            </button>
          </>
        )}
        {hasFondWrapper(uid) && (
          <span className="pe-cb-fond" data-cb="fond">
            <FondButton
              compact
              uid={uid}
              open={fondFor === uid}
              onToggle={() => {
                window.dispatchEvent(new CustomEvent("pe:popups-close"));
                setFrameFor(null);
                setImgBgFor(null);
                setSizeMenu(null);
                setFondFor((o) => (o === uid ? null : uid));
              }}
            />
          </span>
        )}
        <button
          type="button"
          className="pe-cb-btn"
          data-cb="size"
          aria-haspopup="menu"
          aria-expanded={sizeMenu?.uid === uid}
          onClick={() => setSizeMenu((m) => (m?.uid === uid ? null : { uid }))}
        >
          {t("size")}
        </button>
      </div>
        {sizeMenu?.uid === uid && (
          <SizeMenu anchor={cellAnchor(uid, "size")} onClose={() => setSizeMenu(null)}>
            {justified
              ? (
                  [
                    ["alone", t("alone"), true],
                    ["with-others", t("withOthers"), false],
                  ] as const
                ).map(([k, label, value]) => (
                  <button key={k} type="button" role="menuitemradio" aria-checked={alone === value} className="pe-gm-ratio" data-cb={k} onClick={() => { send(gref, { op: "alone", index, alone: value }); setSizeMenu(null); }}>
                    {label}
                  </button>
                ))
              : (
              [
                ["wider", t("wider"), w >= maxW, { dw: 1 }],
                ["narrower", t("narrower"), w <= 1, { dw: -1 }],
                ["taller", t("taller"), h >= 2, { dh: 1 }],
                ["shorter", t("shorter"), h <= 1, { dh: -1 }],
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
    <div className="pe-layer pe-grid-layer" lang={lang}>
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
      {imgBgFor && (
        <ImageBgWindow
          key={imgBgFor.uid}
          anchor={cellAnchor(imgBgFor.uid, "imgbg")}
          value={lookOf(imgBgFor.uid).imageBg}
          onChange={(imageBg) => sendOwnMediaLook(imgBgFor.uid, { bg: (imageBg as ImageBg | undefined) ?? null })}
          onClose={() => setImgBgFor(null)}
        />
      )}
      {fondFor && (
        <FondMenu
          key={fondFor}
          uid={fondFor}
          anchor={cellAnchor(fondFor, "fond") + ' [data-testid="fond-button"]'}
          onClose={() => setFondFor(null)}
          onChanged={() => {}}
        />
      )}
      {frameFor && (
        <FrameWindow
          key={frameFor.uid}
          testId="frame-menu"
          what={document.querySelector<HTMLElement>(`[data-edit-cell="${CSS.escape(frameFor.uid)}"]`)?.dataset.cellType === "video-single" ? "vidéo" : "photo"}
          anchor={cellAnchor(frameFor.uid, "frame")}
          value={lookOf(frameFor.uid).frame}
          onChange={(frame) => sendOwnMediaLook(frameFor.uid, { frame: frame ?? null })}
          onClose={() => setFrameFor(null)}
        />
      )}
      {dragSource && (() => {
        const r = docRect(dragSource);
        return <div className="pe-cell-source" style={{ top: r.top, left: r.left, width: r.width, height: r.height }} aria-hidden="true" />;
      })()}
      {dragTarget && (() => {
        const r = docRect(dragTarget);
        const free = dragTarget.hasAttribute("data-edit-cell-free");
        return (
          <div className="pe-cell-target" data-testid="cell-target" style={{ top: r.top, left: r.left, width: r.width, height: r.height }} aria-hidden="true">
            <span>{free ? t("toLast", { n: filledCount }) : t("swapWith", { n: cellIndex(dragTarget) + 1 })}</span>
          </div>
        );
      })()}
      {drag?.active && (
        <div className="pe-cell-ghost" style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 10}px)` }} aria-hidden="true">
          {t("ghost", { n: drag.from + 1 })}
        </div>
      )}
    </div>
  );
}
