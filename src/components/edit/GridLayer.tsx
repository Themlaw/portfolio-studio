"use client";

/**
 * Grille unifiée sur la toile (lot 31d) : le même outil pour la grille d'une page et celle d'une planche de projet.
 *
 * - Barre de la grille (grille choisie) : agencement (vignettes), espace entre les images, format des cases, « + Case »,
 *   « Adapter aux images », colonnes et inversion en « Sur mesure » (le Fond reste dans la barre de la rubrique).
 * - Barre d'une case remplie (au survol, ou au toucher) : poignée (glisser pour déplacer, ou déposer sur une autre case pour
 *   les ÉCHANGER), numéro, Remplacer, Retirer, Cadrer, Cadre, largeur et hauteur de la case.
 * - Numéros des cases de la grille choisie : on voit toujours dans quel ordre les images se rangent.
 *
 * Tout passe par le message `grid-op` (repères : grid-dom.ts) ; l'éditeur l'applique au brouillon de la page ou à la planche
 * du projet (Annuler / Rétablir comme tout le reste). Rien de ceci n'existe en public.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { FORMAT_KEYS, FORMAT_LABELS } from "@/lib/images/formats";
import { GRID_LAYOUT_LABELS, GRID_LAYOUTS, type GridLayout } from "@/blocks/grid-layouts";
import type { GridCanvasOp } from "@/lib/edit/protocol";
import { FrameControls } from "./FrameMenu";
import GridLayoutIcon from "./GridLayoutIcon";
import { lookOf, sendLook } from "./LookLayer";
import { postIntent } from "./optimistic";
import { cellIndex, cellsOf, gridRefOf, type GridRef } from "./grid-dom";
import { useDismiss } from "./useDismiss";
import type { Frame } from "@/lib/look";

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

type Menu = { kind: "layout" | "ratio"; top: number; left: number } | null;

/** Menu flottant de la barre de la grille (se ferme d'un clic ailleurs). */
function GridMenu({ top, left, label, onClose, children, className }: { top: number; left: number; label: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  return (
    <div ref={ref} className={`pe-gridmenu ${className ?? ""}`} role="radiogroup" aria-label={label} style={{ top, left }}>
      {children}
    </div>
  );
}

/** Menu « Taille » d'une case : quatre mots simples. */
function SizeMenu({ top, left, onClose, children }: { top: number; left: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  return (
    <div ref={ref} className="pe-gridmenu pe-gridmenu-ratios" role="menu" aria-label="Taille de la case" style={{ top, left, transform: "translateY(-100%)" }}>
      {children}
    </div>
  );
}

function GridBar({ grid, gref, rect, gridTop, minTop }: { grid: HTMLElement; gref: GridRef; rect: Rect; gridTop: number; minTop: number }) {
  const [menu, setMenu] = useState<Menu>(null);
  const layout = (grid.dataset.layout ?? "2") as GridLayout;
  const gap = grid.dataset.gap ?? "normal";
  const ratio = grid.dataset.ratio ?? "auto";
  const cols = Number(grid.dataset.cols ?? grid.dataset.gridCols ?? 3);
  const mirrored = grid.hasAttribute("data-mirror");
  const count = cellsOf(grid).filter((c) => c.hasAttribute("data-edit-cell")).length;
  const custom = layout === "custom";
  const open = (kind: "layout" | "ratio", e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu((m) => (m?.kind === kind ? null : { kind, top: r.bottom + window.scrollY + 6, left: Math.max(window.scrollX + 8, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - 340)) }));
  };
  // La barre se pose dans la marge au-dessus de la première rangée et du fil d'Ariane de la case choisie (jamais dessus), sous l'en-tête du site s'il est collé en haut,
  // et à gauche : la barre de la rubrique (Carte, Fond, flèches) reste libre à droite.
  const above = gridTop - 80;
  const top = Math.min(Math.max(minTop, above), rect.top + Math.max(6, rect.height - 44));
  // La barre de la rubrique (Carte, Fond, flèches), à droite, n'existe pas quand une case est choisie : toute la largeur est libre.
  const toolsRight = document.querySelector(".pe-tools") ? 340 : 24;
  const maxWidth = Math.max(380, Math.min(920, rect.width - toolsRight));
  const set = (patch: Omit<Extract<GridCanvasOp, { op: "set" }>, "op">) => send(gref, { op: "set", ...patch });
  return (
    <>
      <div className="pe-gridbar" role="toolbar" aria-label="Réglages de la grille" data-testid="gridbar" style={{ top, left: rect.left + 6, maxWidth }}>
        <button type="button" className="pe-gb-btn" aria-haspopup="menu" aria-expanded={menu?.kind === "layout"} data-testid="gridbar-layout" title="Agencement des images" onClick={(e) => open("layout", e)}>
          <GridLayoutIcon layout={layout} />
          <span>Agencement</span>
        </button>
        <span className="pe-gb-sep" aria-hidden="true" />
        <span className="pe-gb-group" role="radiogroup" aria-label="Espace entre les images" data-testid="gridbar-gap">
          <span className="pe-gb-label">Espace</span>
          {GAPS.map((g) => (
            <button key={g.value} type="button" role="radio" aria-checked={gap === g.value} data-gap={g.value} title={g.title} aria-label={g.title} className="pe-gb-seg" onClick={() => set({ gap: g.value as "none" | "tight" | "normal" | "wide" })}>
              {g.label}
            </button>
          ))}
        </span>
        <span className="pe-gb-sep" aria-hidden="true" />
        <button type="button" className="pe-gb-btn" aria-haspopup="menu" aria-expanded={menu?.kind === "ratio"} data-testid="gridbar-ratio" title="Format des cases" onClick={(e) => open("ratio", e)}>
          <span>Format : {ratio === "auto" ? "Libre" : ratio === "1:1" ? "Carré" : ratio}</span>
        </button>
        {custom && (
          <>
            <span className="pe-gb-sep" aria-hidden="true" />
            <span className="pe-gb-group" role="radiogroup" aria-label="Colonnes" data-testid="gridbar-cols">
              <span className="pe-gb-label">Colonnes</span>
              {[2, 3, 4].map((c) => (
                <button key={c} type="button" role="radio" aria-checked={cols === c} data-cols={c} className="pe-gb-seg" onClick={() => set({ cols: c })}>
                  {c}
                </button>
              ))}
            </span>
            <button type="button" role="switch" aria-checked={mirrored} className="pe-gb-btn" data-testid="gridbar-mirror" title="Inverser la gauche et la droite" onClick={() => set({ mirror: !mirrored })}>
              Inverser
            </button>
          </>
        )}
        <span className="pe-gb-sep" aria-hidden="true" />
        <button type="button" className="pe-gb-btn" data-testid="gridbar-add" title="Ajouter une image ou une vidéo à la suite" onClick={() => send(gref, { op: "pick", index: count })}>
          + Case
        </button>
        <button type="button" className="pe-gb-btn" data-testid="gridbar-adapt" disabled={count === 0} title="Donne à chaque case la forme de son image : un portrait sur deux rangées, un panorama sur deux colonnes" onClick={() => send(gref, { op: "adapt" })}>
          Adapter aux images
        </button>
      </div>
      {menu?.kind === "layout" && (
        <GridMenu top={menu.top} left={menu.left} label="Agencement de la grille" className="pe-gridmenu-layouts" onClose={() => setMenu(null)}>
          {GRID_LAYOUTS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={layout === l}
              aria-label={GRID_LAYOUT_LABELS[l]}
              title={GRID_LAYOUT_LABELS[l]}
              data-layout={l}
              className="pe-gm-layout"
              onClick={() => {
                set({ layout: l });
                setMenu(null);
              }}
            >
              <GridLayoutIcon layout={l} />
              <span>{GRID_LAYOUT_LABELS[l]}</span>
            </button>
          ))}
        </GridMenu>
      )}
      {menu?.kind === "ratio" && (
        <GridMenu top={menu.top} left={menu.left} label="Format des cases" className="pe-gridmenu-ratios" onClose={() => setMenu(null)}>
          {FORMAT_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={ratio === k}
              data-ratio={k}
              className="pe-gm-ratio"
              onClick={() => {
                set({ ratio: k });
                setMenu(null);
              }}
            >
              {FORMAT_LABELS[k]}
            </button>
          ))}
          <p className="pe-gm-hint">Les vidéos gardent leur cadre 16:9.</p>
        </GridMenu>
      )}
    </>
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
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-selected", "data-layout", "data-gap", "data-ratio", "data-cols", "data-mirror", "data-cell-w", "data-cell-h"] });
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
  const activeRef = active ? gridRefOf(active) : null;
  // Barre : la case survolée, sinon la case choisie (page : l'image sélectionnée dans la grille).
  const selectedCell = selected && !selected.startsWith("site-") ? (document.querySelector(`[data-edit-block="${CSS.escape(selected)}"]`)?.closest<HTMLElement>(".block-grid-cell[data-edit-cell]") ?? null) : null;
  const hoverCell = hover && document.contains(hover) ? hover : selectedCell;
  const hoverGrid = hoverCell?.parentElement?.matches("[data-edit-grid]") ? hoverCell.parentElement : null;
  const hoverRef = hoverGrid ? gridRefOf(hoverGrid) : null;
  // Numéros : sur la grille choisie et sur celle qu'on survole.
  const numbered = [active, hoverGrid].filter((g, i, a): g is HTMLElement => Boolean(g) && a.indexOf(g) === i);

  const section = active?.closest<HTMLElement>(".block-grid-section") ?? active;
  const sectionRect = section ? docRect(section) : null;

  const hdr = document.querySelector("header");
  const stuck = hdr && ["fixed", "sticky"].includes(getComputedStyle(hdr).position) ? hdr.getBoundingClientRect().bottom : 0;
  const minTop = window.scrollY + Math.max(0, stuck) + 8;
  const gridTop = active ? docRect(active).top : 0;

  const cellBar = (cell: HTMLElement, gref: GridRef) => {
    const uid = cell.dataset.editCell ?? "";
    const index = cellIndex(cell);
    const type = cell.dataset.cellType ?? "image";
    const image = type === "image";
    // Une case de texte (page) n'a ni image à remplacer ni cadre : seulement sa place et sa taille.
    const media = type === "image" || type === "video-single";
    const r = docRect(cell);
    const w = Number(cell.dataset.cellW ?? 1);
    const h = Number(cell.dataset.cellH ?? 1);
    const cols = Number(gref.grid.dataset.cols ?? gref.grid.dataset.gridCols ?? 3);
    const maxW = gref.grid.dataset.layout === "custom" ? cols : Number(gref.grid.dataset.gridCols ?? 2);
    const n = index + 1;
    return (
      <div
        key={`bar-${uid}`}
        className="pe-cellbar"
        role="toolbar"
        aria-label={`Case ${n}`}
        data-testid="cellbar"
        data-cell={uid}
        // En bas à gauche de la case (jamais sur le fil d'Ariane ni les outils du haut), dans la partie visible de l'écran.
        style={{
          top: Math.max(r.top + 56, Math.min(r.top + r.height - 8, window.scrollY + window.innerHeight - 10)),
          left: r.left + 6,
          maxWidth: Math.max(160, r.width - 12),
          transform: "translateY(-100%)",
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
            setSizeMenu((m) => (m?.uid === uid ? null : { uid, top: bb.top + window.scrollY - 4, left: Math.max(window.scrollX + 8, Math.min(bb.left + window.scrollX, window.scrollX + window.innerWidth - 190)) }));
          }}
        >
          Taille ▾
        </button>
        {sizeMenu?.uid === uid && (
          <SizeMenu top={sizeMenu.top} left={sizeMenu.left} onClose={() => setSizeMenu(null)}>
            {(
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
      </div>
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
      {active && activeRef && sectionRect && <GridBar key={activeRef.uid} grid={active} gref={activeRef} rect={sectionRect} gridTop={gridTop} minTop={minTop} />}
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
