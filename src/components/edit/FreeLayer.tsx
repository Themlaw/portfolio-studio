"use client";

/**
 * Planche libre sur la toile (lot 42) : images posées librement dans une zone (rubrique de page ou composant de planche).
 *
 * - Choisir une image : un appui dessus. Elle reçoit un cadre avec quatre poignées de coin (redimensionner, ratio conservé,
 *   à partir du coin opposé), une poignée de rotation au-dessus (Maj : par pas de 15°), et une barre d'outils.
 * - Déplacer : glisser l'image. Repères magnétiques (6 px) sur les bords et le centre de la zone et des autres images ; Alt
 *   les désactive. Le centre de l'image reste dans la zone.
 * - Barre de l'image (même présentation que celle d'une image de carrousel, `.pe-slot-tools`) : Remplacer, Supprimer, Devant,
 *   Derrière, Arrondi, Cadre, Rotation (degrés, pas de 1°). Point d'accroche : le « Fond de l'image » (lot 41) et la légende (lot 39)
 *   viendront s'ajouter ici (`data-free-bar-extra`).
 * - Clavier (image choisie) : flèches = 1 % de la zone, Maj + flèches = 5 %, Suppr = retirer, Échap = désélectionner.
 * - Poignée du bas de la zone : la hauteur libre.
 *
 * Chaque geste est UN message `free-op` (un pas d'historique : Annuler / Rétablir de l'éditeur). Pendant le geste, l'aperçu est
 * posé dans des variables CSS d'aperçu (`--px…`, voir free-dom.ts) ; au relâchement il devient un aperçu gardé jusqu'à
 * l'acquittement du serveur (edit/optimistic.ts : refus = valeur d'origine rétablie). Rien de ceci n'existe en public.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { clampCrop, contentBounds, FREE_MAX_W, FREE_MIN_W, snapBox, snapCrop, type FreeBox, type FreeCrop, type FreeGuides, type FreeItem } from "@/blocks/free-board";
import { imageBgCss, RADII, RADIUS_LABELS, type Frame, type ImageBg, type Radius } from "@/lib/look";
import type { MediaPatch } from "@/lib/edit/media-look";
import type { FreeCanvasOp } from "@/lib/edit/protocol";

import FrameWindow from "./FrameMenu";
import ImageBgWindow from "./ImageBgMenu";
import { clearCrop, clearItem, findItem, findZone, frameBoxOf, freeKey, freeRefOf, ITEM_SELECTOR, itemsOf, readItem, writeCrop, writeItem, zoneAspectOf, type FreeGeom, type FreeRef } from "./free-dom";
import { sendMediaLook } from "./LookLayer";
import VideoModeSeg from "./VideoModeSeg";
import { isVideoMode } from "@/blocks/video-mode";
import { postIntent, setOverlay } from "./optimistic";

type Sel = { key: string; id: string };
type Place = Partial<Pick<FreeGeom, "x" | "y" | "w" | "rot">>;

/** Envoie une opération à l'éditeur ; renvoie le numéro de l'intention. */
function send(ref: FreeRef, op: FreeCanvasOp): number {
  return postIntent({ kind: "free-op", uid: ref.uid, ...(ref.board ? { board: ref.board, ...(ref.props ? { props: ref.props } : {}) } : {}), op });
}

/** Habillage d'une image (cadre, fond, arrondi) : l'écriture commune `media-look` (lot 75), cible = cette image de la planche libre. */
function sendFreeLook(ref: FreeRef, id: string, patch: MediaPatch): number {
  return sendMediaLook({ kind: "free", uid: ref.uid, ...(ref.board ? { board: ref.board, ...(ref.props ? { props: ref.props } : {}) } : {}), id }, patch);
}

/** Aperçu gardé jusqu'à l'acquittement : la valeur voulue reste à l'écran par-dessus la page rendue en retard ; refus = valeur d'origine. */
function commitPlace(ref: FreeRef, id: string, patch: Place) {
  const key = freeKey(ref);
  const seq = send(ref, { op: "place", id, ...patch });
  setOverlay(`free:${key}:${id}`, seq, {
    apply: () => {
      const el = findItem(key, id);
      if (el) writeItem(el, patch);
    },
    clear: () => {
      const el = findItem(key, id);
      if (el) clearItem(el);
    },
  });
}
/** Recadrage du cadre (lot 113) : un geste = une opération `crop` (toutes les marges, absolues) = un pas d'historique. */
function commitCrop(ref: FreeRef, crop: FreeCrop, canvasAspect: number) {
  const key = freeKey(ref);
  const seq = send(ref, { op: "crop", ...crop });
  setOverlay(`free-c:${key}`, seq, {
    apply: () => {
      const z = findZone(key);
      if (z) writeCrop(z, crop, canvasAspect);
    },
    clear: () => {
      const z = findZone(key);
      if (z) clearCrop(z);
    },
  });
}

/** Case de grille qui porte la planche (lot 113) : sa grille (rubrique de la page), son rang et ses colonnes ; null hors grille. */
function cellOf(zone: HTMLElement): { grid: string; index: number; cols: number; gridW: number; justified: boolean } | null {
  const cell = zone.closest<HTMLElement>(".block-grid-cell[data-cell-index]");
  const child = zone.closest<HTMLElement>("[data-edit-block][data-edit-parent]");
  const gridEl = cell?.closest<HTMLElement>(".block-grid");
  const grid = child?.dataset.editParent;
  const index = Number(cell?.dataset.cellIndex);
  if (!cell || !gridEl || !grid || !Number.isInteger(index)) return null;
  const cols = Number(gridEl.dataset.cols ?? gridEl.dataset.gridCols ?? 2) || 2;
  return { grid, index, cols, gridW: gridEl.getBoundingClientRect().width, justified: gridEl.hasAttribute("data-justify") };
}

type Rect = { top: number; left: number; width: number; height: number };
const docRect = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
};

/**
 * Hauteur d'une image en % de la hauteur du PLAN, d'après les mesures réelles. Les coordonnées des images sont celles du plan ; le cadre
 * (recadrage, lot 113) en montre une fenêtre `fb` : un pixel de la zone vaut `fb.w / zr.width` points de plan en largeur.
 */
const hPct = (g: FreeGeom, zr: { width: number; height: number }, fb: { w: number; h: number } = { w: 100, h: 100 }) => ((((g.w / fb.w) * zr.width) / g.ratio / zr.height) * fb.h);

type Gesture = {
  kind: "move" | "resize" | "rotate" | "crop";
  /** Recadrage : bord ou coin tenu, marges de départ, dimensions du plan en pixels, contenu pour le magnétisme. */
  crop0?: FreeCrop;
  canvas?: { w: number; h: number; aspect: number };
  content?: ReturnType<typeof contentBounds>;
  lastCrop?: FreeCrop;
  lastSnap?: string;
  cell?: ReturnType<typeof cellOf>;
  dCols?: number;
  fb: { l: number; t: number; w: number; h: number };
  ref: FreeRef;
  key: string;
  el: HTMLElement;
  id: string;
  handle?: string;
  start: { x: number; y: number };
  g0: FreeGeom;
  grab: { x: number; y: number };
  others: FreeBox[];
  active: boolean;
  last: Place;
  angle0: number;
  corner: { x: number; y: number };
  anchor: { x: number; y: number };
  center: { x: number; y: number };
  H0: number;
};

/**
 * Garde la barre de l'image entièrement dans la fenêtre : calée à `left`, elle passe à la ligne si la place à droite est assez large
 * (300 px), sinon elle est ramenée vers la gauche.
 */
function keepInView(el: HTMLElement | null, left: number) {
  if (!el) return;
  const doc = el.ownerDocument;
  const win = doc.defaultView ?? window;
  const vw = doc.documentElement.clientWidth;
  const room = win.scrollX + vw - 6 - left;
  el.style.maxWidth = `min(760px, ${Math.max(300, room)}px, calc(100vw - 12px))`;
  el.style.left = `${Math.max(win.scrollX + 6, Math.min(left, win.scrollX + vw - 6 - el.offsetWidth))}px`;
}

const norm = (deg: number) => {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180 && deg > 0) d = 180;
  return d;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function FreeLayer({ selected, dragging, announce }: { selected: string | null; dragging: boolean; announce: (s: string) => void }) {
  const [tick, setTick] = useState(0);
  const [sel, setSelState] = useState<Sel | null>(null);
  const [frameOpen, setFrameOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [guides, setGuides] = useState<(FreeGuides & { zone: Rect; fb: { l: number; t: number; w: number; h: number } }) | null>(null);
  const [gesturing, setGesturing] = useState(false);
  const [badge, setBadge] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const selRef = useRef<Sel | null>(null);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const setSel = useCallback((s: Sel | null) => {
    selRef.current = s;
    setSelState(s);
    if (!s) setFrameOpen(false);
  }, []);

  // Repositionner le calque quand la page bouge (rendu, défilement, taille, images chargées).
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(bump);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-selected", "style"] });
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

  const startGesture = useCallback(
    (kind: Gesture["kind"], e: { clientX: number; clientY: number }, ref: FreeRef, el: HTMLElement | null, handle?: string) => {
      const zr = ref.zone.getBoundingClientRect();
      const fb = frameBoxOf(ref.zone);
      const g0 = el ? readItem(el) : { id: "", x: 0, y: 0, w: 30, rot: 0, ratio: 1 };
      // Coordonnées du PLAN (lot 113) : le cadre en montre la fenêtre `fb` ; sans recadrage, fb = tout le plan.
      const p = { x: fb.l + ((e.clientX - zr.left) / zr.width) * fb.w, y: fb.t + ((e.clientY - zr.top) / zr.height) * fb.h };
      const key = freeKey(ref);
      // Géométrie en pixels de la zone (origine = son coin haut gauche), pour les poignées de coin et de rotation.
      const pw = (g0.w / fb.w) * zr.width;
      const ph = pw / g0.ratio;
      const c = { x: ((g0.x + g0.w / 2 - fb.l) / fb.w) * zr.width, y: ((g0.y - fb.t) / fb.h) * zr.height + ph / 2 };
      const th = (g0.rot * Math.PI) / 180;
      const local = handle === "nw" ? [-1, -1] : handle === "ne" ? [1, -1] : handle === "sw" ? [-1, 1] : [1, 1];
      const rot = (lx: number, ly: number) => ({ x: lx * Math.cos(th) - ly * Math.sin(th), y: lx * Math.sin(th) + ly * Math.cos(th) });
      const off = rot((local[0] * pw) / 2, (local[1] * ph) / 2);
      gesture.current = {
        kind,
        ref,
        key,
        el: el ?? ref.zone,
        id: g0.id,
        handle,
        start: { x: e.clientX, y: e.clientY },
        g0,
        grab: { x: p.x - g0.x, y: p.y - g0.y },
        others: el
          ? itemsOf(ref.zone)
              .filter((o) => o !== el)
              .map((o) => {
                const g = readItem(o);
                return { x: g.x, y: g.y, w: g.w, h: hPct(g, zr, fb) };
              })
          : [],
        active: false,
        last: {},
        angle0: Math.atan2(e.clientY - (zr.top + c.y), e.clientX - (zr.left + c.x)),
        corner: { x: c.x + off.x, y: c.y + off.y },
        anchor: { x: c.x - off.x, y: c.y - off.y },
        center: c,
        H0: zr.height,
        fb,
      };
    },
    [],
  );

  /** Début d'un recadrage par un bord ou un coin du cadre (lot 113) : les marges de départ, le plan en pixels, le contenu pour le magnétisme. */
  const startCrop = useCallback(
    (e: { clientX: number; clientY: number }, ref: FreeRef, handle: string) => {
      startGesture("crop", e, ref, null, handle);
      const g = gesture.current;
      if (!g) return;
      const zone = ref.zone;
      const zr = zone.getBoundingClientRect();
      const fb = frameBoxOf(zone);
      const aspect = zoneAspectOf(zone);
      const w = (zr.width / fb.w) * 100;
      g.canvas = { w, h: w / aspect, aspect };
      g.crop0 = { t: fb.t, l: fb.l, r: 100 - fb.l - fb.w, b: 100 - fb.t - fb.h };
      g.cell = cellOf(zone);
      const geoms = itemsOf(zone).map((el) => readItem(el));
      const ratios: Record<string, number> = {};
      for (const m of geoms) ratios[m.id] = m.ratio;
      g.content = contentBounds(geoms.map((m) => ({ id: m.id, media: 1, x: m.x, y: m.y, w: m.w, rot: m.rot, z: 0 })) as FreeItem[], aspect, ratios);
    },
    [startGesture],
  );

  // Pointeur : sélection, déplacement, poignées.
  useEffect(() => {
    const inLayer = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest(".pe-layer"));
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (inLayer(e.target)) return;
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>(ITEM_SELECTOR) : null;
      const ref = el ? freeRefOf(el) : null;
      if (!el || !ref || el.parentElement !== ref.zone) {
        if (selRef.current) setSel(null);
        return;
      }
      e.preventDefault();
      // Un champ de la barre (rotation) validé avant que l'on touche à l'image.
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest(".pe-layer")) document.activeElement.blur();
      setSel({ key: freeKey(ref), id: el.dataset.freeItem! });
      // Le clavier (flèches, Suppr) s'adresse à la toile, même si le focus était dans le panneau de l'éditeur.
      try {
        window.focus();
      } catch {}
      startGesture("move", e, ref, el);
    };
    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      if (!g.active && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < 3) return;
      if (!g.active) {
        g.active = true;
        document.documentElement.setAttribute("data-free-dragging", "");
        try {
          window.getSelection()?.removeAllRanges();
        } catch {}
        setGesturing(true);
      }
      const zone = g.ref.zone;
      const zr = zone.getBoundingClientRect();
      if (g.kind === "crop") {
        const hd = g.handle ?? "";
        const c0 = g.crop0!;
        const cv = g.canvas!;
        const dx = e.clientX - g.start.x;
        const dy = e.clientY - g.start.y;
        const want = { ...c0 };
        const moved: ("t" | "r" | "b" | "l")[] = [];
        if (hd.includes("n")) {
          want.t = c0.t + (dy / cv.h) * 100;
          moved.push("t");
        }
        if (hd.includes("s")) {
          want.b = c0.b - (dy / cv.h) * 100;
          moved.push("b");
        }
        // Dans une case de grille, les bords latéraux changent la largeur de la case (colonnes), pas le recadrage.
        if (!g.cell && hd.includes("w")) {
          want.l = c0.l + (dx / cv.w) * 100;
          moved.push("l");
        }
        if (!g.cell && hd.includes("e")) {
          want.r = c0.r - (dx / cv.w) * 100;
          moved.push("r");
        }
        let c = clampCrop(want, cv.aspect);
        const sn = snapCrop(c, moved, { zone: cv.aspect, tol: e.altKey ? 0 : 0.02, content: g.content ?? null, tolPct: e.altKey ? 0 : (6 / Math.min(cv.w, cv.h)) * 100 });
        c = clampCrop(sn.crop, cv.aspect);
        g.lastCrop = c;
        g.lastSnap = sn.snap;
        writeCrop(zone, c, cv.aspect);
        const wpx = Math.round((cv.w * (100 - c.l - c.r)) / 100);
        const hpx = Math.round((cv.h * (100 - c.t - c.b)) / 100);
        if (g.cell && (hd.includes("e") || hd.includes("w"))) {
          const colW = g.cell.gridW / g.cell.cols;
          g.dCols = Math.round((hd.includes("e") ? dx : -dx) / colW);
        }
        setBadge(`${wpx} × ${hpx} px${sn.snap ? ` · ${sn.snap === "contenu" ? "contenu" : sn.snap}` : ""}${g.cell && g.dCols ? ` · ${g.dCols > 0 ? "+" : ""}${g.dCols} colonne${Math.abs(g.dCols) > 1 ? "s" : ""}` : ""}`);
        bump();
        return;
      }
      const fb = g.fb;
      const p = { x: fb.l + ((e.clientX - zr.left) / zr.width) * fb.w, y: fb.t + ((e.clientY - zr.top) / zr.height) * fb.h };
      if (g.kind === "move") {
        const h = hPct(g.g0, zr, fb);
        let x = p.x - g.grab.x;
        let y = p.y - g.grab.y;
        if (!e.altKey) {
          const s = snapBox({ x, y, w: g.g0.w, h }, g.others, (6 / zr.width) * fb.w, (6 / zr.height) * fb.h);
          x = s.box.x;
          y = s.box.y;
          setGuides({ ...s.guides, zone: docRect(zone), fb });
        } else setGuides(null);
        x = Math.min(100 - g.g0.w / 2, Math.max(-g.g0.w / 2, x));
        y = Math.min(100 - h / 2, Math.max(-h / 2, y));
        g.last = { x: r2(x), y: r2(y) };
      } else if (g.kind === "resize") {
        const P = { x: e.clientX - zr.left, y: e.clientY - zr.top };
        const u = { x: g.corner.x - g.anchor.x, y: g.corner.y - g.anchor.y };
        const d0 = Math.hypot(u.x, u.y) || 1;
        let s = ((P.x - g.anchor.x) * u.x + (P.y - g.anchor.y) * u.y) / (d0 * d0);
        const w = Math.min(FREE_MAX_W, Math.max(FREE_MIN_W, g.g0.w * s));
        s = w / g.g0.w;
        const c = { x: g.anchor.x + (g.center.x - g.anchor.x) * s, y: g.anchor.y + (g.center.y - g.anchor.y) * s };
        const ph = ((w / fb.w) * zr.width) / g.g0.ratio;
        g.last = { w: r2(w), x: r2(fb.l + (c.x / zr.width) * fb.w - w / 2), y: r2(fb.t + ((c.y - ph / 2) / zr.height) * fb.h) };
      } else {
        const a = Math.atan2(e.clientY - (zr.top + g.center.y), e.clientX - (zr.left + g.center.x));
        let rot = g.g0.rot + ((a - g.angle0) * 180) / Math.PI;
        if (e.shiftKey) rot = Math.round(rot / 15) * 15;
        g.last = { rot: norm(Math.round(rot)) };
      }
      writeItem(g.el, g.last);
      bump();
    };
    const end = (commit: boolean) => {
      const g = gesture.current;
      gesture.current = null;
      setGuides(null);
      setGesturing(false);
      if (!g) return;
      document.documentElement.removeAttribute("data-free-dragging");
      if (!g.active) return;
      // Le clic qui suit un glisser ne sélectionne rien d'autre.
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      document.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", swallow, { capture: true }), 0);
      if (g.kind === "crop") {
        setBadge(null);
        const c = g.lastCrop;
        if (commit && c && JSON.stringify(c) !== JSON.stringify(g.crop0)) {
          commitCrop(g.ref, c, g.canvas!.aspect);
          announce("Cadre de la planche recadré.");
        } else clearCrop(g.ref.zone);
        if (commit && g.cell && g.dCols) {
          postIntent({ kind: "grid-op", uid: g.cell.grid, op: g.cell.justified ? { op: "alone", index: g.cell.index, alone: g.dCols > 0 } : { op: "span", index: g.cell.index, dw: g.dCols } });
          announce("Largeur de la case changée.");
        }
        return;
      }
      if (!commit || !Object.keys(g.last).length) {
        clearItem(g.el);
        return;
      }
      commitPlace(g.ref, g.id, g.last);
      announce(g.kind === "move" ? "Image déplacée." : g.kind === "resize" ? "Image redimensionnée." : "Image pivotée.");
    };
    const up = () => end(true);
    const cancel = () => end(false);
    // Échap annule le geste en cours (déplacer, redimensionner, pivoter, recadrer) : l'aperçu est retiré, rien n'est écrit, le relâchement ne fait plus rien.
    const onEsc = (e: KeyboardEvent) => {
      const g = gesture.current;
      if (e.key !== "Escape" || !g?.active) return;
      e.preventDefault();
      e.stopPropagation();
      end(false);
    };
    window.addEventListener("keydown", onEsc, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    return () => {
      window.removeEventListener("keydown", onEsc, true);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancel, true);
    };
  }, [announce, bump, setSel, startGesture]);

  // « + Image » au centre d'une zone vide ; clavier (flèches, Suppr, Échap) sur l'image choisie.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      const add = e.target.closest("[data-edit-free-add]");
      const ref = add ? freeRefOf(add) : null;
      if (!add || !ref) return;
      e.preventDefault();
      send(ref, { op: "pick" });
    };
    const onKey = (e: KeyboardEvent) => {
      const s = selRef.current;
      if (!s || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.target.closest(".sm"))) return;
      const el = findItem(s.key, s.id);
      const zone = findZone(s.key);
      const ref = zone ? freeRefOf(zone) : null;
      if (!el || !ref) return;
      const step = e.shiftKey ? 5 : 1;
      const dir: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (Object.hasOwn(dir, e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const g = readItem(el);
        const [dx, dy] = dir[e.key];
        const patch = { x: r2(g.x + dx), y: r2(g.y + dy) };
        writeItem(el, patch);
        commitPlace(ref, s.id, patch);
        bump();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        send(ref, { op: "remove", id: s.id });
        setSel(null);
        announce("Image retirée.");
      } else if (e.key === "Escape") {
        e.stopPropagation();
        setSel(null);
      }
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [announce, bump, setSel]);

  // L'image choisie n'existe plus (retirée, Annuler) : plus de sélection.
  useEffect(() => {
    if (sel && !gesture.current && !findItem(sel.key, sel.id)) setSel(null);
  }, [sel, tick, setSel]);

  // Une seule fenêtre à la fois (Fond, Cadre, Réglages…).
  useEffect(() => {
    const onClose = (e: Event) => {
      const except = (e as CustomEvent<{ except?: string }>).detail?.except;
      if (except !== "free-frame") setFrameOpen(false);
      if (except !== "free-bg") setBgOpen(false);
    };
    window.addEventListener("pe:popups-close", onClose);
    return () => window.removeEventListener("pe:popups-close", onClose);
  }, []);

  if (dragging) return null;
  void tick;
  const zoneEl = sel ? findZone(sel.key) : null;
  const itemEl = sel && zoneEl ? findItem(sel.key, sel.id) : null;
  const ref = zoneEl ? freeRefOf(zoneEl) : null;
  // Zone qui montre sa poignée de hauteur : celle de l'image choisie, sinon celle de la rubrique / du composant choisi.
  let handleZone: HTMLElement | null = zoneEl;
  if (!handleZone) {
    handleZone = document.querySelector<HTMLElement>("[data-edit-bitem][data-selected] [data-edit-free]");
    if (!handleZone && selected && !selected.startsWith("site-")) {
      const w = document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(selected)}"]`);
      if (w?.dataset.editType === "free-board") handleZone = w.querySelector<HTMLElement>("[data-edit-free]");
    }
  }
  const handleRef = handleZone ? freeRefOf(handleZone) : null;

  let selView: React.ReactNode = null;
  if (sel && itemEl && zoneEl && ref) {
    const g = readItem(itemEl);
    const zr = docRect(zoneEl);
    const fb = frameBoxOf(zoneEl);
    const width = (g.w / fb.w) * zr.width;
    const height = width / g.ratio;
    const left = zr.left + ((g.x - fb.l) / fb.w) * zr.width;
    const top = zr.top + ((g.y - fb.t) / fb.h) * zr.height;
    const bb = docRect(itemEl);
    let style: { radius?: Radius; frame?: Frame; bg?: string } = {};
    try {
      style = JSON.parse(itemEl.dataset.freeStyle ?? "{}") as typeof style;
    } catch {}
    // Une vidéo (lot 116) : repère posé par le rendu (en mode Lecteur il n'y a pas de <video> dans la boîte).
    const isVideo = itemEl.dataset.freeLecture !== undefined;
    const videoNow = isVideoMode(itemEl.dataset.freeLecture) ? itemEl.dataset.freeLecture : "loop";
    const hasPoster = Boolean(itemEl.dataset.freePoster);
    const hasAudio = itemEl.dataset.freeAudio === "1";
    // Sous l'image (la poignée de rotation est au-dessus) ; au-dessus seulement si le bas de l'écran est trop proche.
    const below = bb.top + bb.height + 14;
    const barTop = below + 44 > window.scrollY + window.innerHeight ? Math.max(window.scrollY + 8, bb.top - 64) : below;
    const barLeft = Math.max(window.scrollX + 6, Math.min(bb.left, window.scrollX + document.documentElement.clientWidth - 360));
    selView = (
      <Fragment>
        <div className="pe-free-sel" data-testid="free-sel" data-free-sel={sel.id} style={{ left, top, width, height, transform: `rotate(${g.rot}deg)` }}>
          {(["nw", "ne", "se", "sw"] as const).map((h) => (
            <span
              key={h}
              className="pe-free-handle"
              data-h={h}
              data-testid={`free-handle-${h}`}
              role="presentation"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                startGesture("resize", e, ref, itemEl, h);
              }}
            />
          ))}
          <span
            className="pe-free-handle"
            data-h="rot"
            data-testid="free-handle-rot"
            role="presentation"
            title="Faire pivoter (Maj : par pas de 15°)"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              startGesture("rotate", e, ref, itemEl, "rot");
            }}
          />
        </div>
        {!gesturing && (
          <div ref={(el) => keepInView(el, barLeft)} className="pe-slot-tools" role="toolbar" aria-label="Image de la planche libre" data-testid="free-bar" style={{ top: barTop, left: barLeft, width: "max-content" }}>
            <button type="button" data-testid="free-replace" onClick={() => send(ref, { op: "pick", id: sel.id })}>
              Remplacer
            </button>
            <button type="button" className="pe-danger" data-testid="free-remove" onClick={() => { send(ref, { op: "remove", id: sel.id }); setSel(null); }}>
              Supprimer
            </button>
            <button type="button" data-testid="free-front" title="Passer devant les autres images" onClick={() => send(ref, { op: "front", id: sel.id })}>
              Devant
            </button>
            <button type="button" data-testid="free-back" title="Passer derrière les autres images" onClick={() => send(ref, { op: "back", id: sel.id })}>
              Derrière
            </button>
            <label className="pe-slot-radius" title="Arrondi de cette image">
              <span>Arrondi</span>
              <select aria-label="Arrondi de cette image" data-testid="free-radius" value={style.radius ?? "none"} onChange={(e) => sendFreeLook(ref, sel.id, { radius: e.target.value === "none" ? null : (e.target.value as Radius) })}>
                {RADII.map((r) => (
                  <option key={r} value={r}>
                    {r === "none" ? "Aucun" : RADIUS_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={frameOpen}
                data-testid="free-frame-button"
                title={isVideo ? "Cadre autour de cette vidéo" : "Cadre autour de cette photo"}
                onClick={() => {
                  setFrameOpen((o) => !o);
                  window.dispatchEvent(new CustomEvent("pe:popups-close", { detail: { except: "free-frame" } }));
                }}
              >
                Cadre
              </button>
            {!isVideo && (
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={bgOpen}
                data-testid="free-imgbg-button"
                title="Fond derrière cette image (utile pour un PNG détouré)"
                onClick={() => {
                  setBgOpen((o) => !o);
                  window.dispatchEvent(new CustomEvent("pe:popups-close", { detail: { except: "free-bg" } }));
                }}
              >
                {imageBgCss(style.bg) && <span className="sm-swatch" data-testid="free-imgbg-swatch" style={{ background: imageBgCss(style.bg) ?? undefined }} aria-hidden="true" />}
                Fond image
              </button>
            )}
            {isVideo && <VideoModeSeg now={videoNow} onChange={(m) => sendFreeLook(ref, sel.id, { video: m })} testId="free-lecture-mode" attr="data-free-lecture-set" />}
            {isVideo && (
              <>
                <button type="button" data-testid="free-poster" title="Image d'attente de la vidéo (sinon une image de la vidéo)" onClick={() => send(ref, { op: "pick", id: sel.id, poster: true })}>
                  Affiche
                </button>
                {hasPoster && (
                  <button type="button" data-testid="free-poster-clear" title="Revenir à l'image de la vidéo" onClick={() => send(ref, { op: "poster", id: sel.id, media: null })}>
                    Sans affiche
                  </button>
                )}
                <span className="pe-free-sound" data-testid="free-sound-state" title={hasAudio ? "Cette vidéo a du son : un bouton son s'affiche sur le site" : "Cette vidéo est muette : pas de bouton son"}>
                  {hasAudio ? "Avec son" : "Sans son"}
                </span>
              </>
            )}
            <RotationField key={`${sel.id}-${g.rot}`} value={g.rot} onCommit={(rot) => commitPlace(ref, sel.id, { rot })} />
            <span data-free-bar-extra="" />
          </div>
        )}
        {bgOpen && !gesturing && (
          <ImageBgWindow testId="free-imgbg" anchor='[data-testid="free-imgbg-button"]' value={style.bg} onClose={() => setBgOpen(false)} onChange={(bg) => sendFreeLook(ref, sel.id, { bg: (bg as ImageBg | undefined) ?? null })} />
        )}
        {frameOpen && !gesturing && (
          <FrameWindow testId="free-frame" what={isVideo ? "vidéo" : "photo"} anchor='[data-testid="free-frame-button"]' value={style.frame} onClose={() => setFrameOpen(false)} onChange={(frame) => sendFreeLook(ref, sel.id, { frame: frame ?? null })} />
        )}
      </Fragment>
    );
  }

  // Poignées de recadrage du cadre (lot 113) : quatre bords, quatre coins.
  let cropView: React.ReactNode = null;
  if (handleZone && handleRef && !dragging) {
    const zr = docRect(handleZone);
    const inCell = Boolean(cellOf(handleZone));
    const at: Record<string, [number, number]> = { n: [0.5, 0], s: [0.5, 1], e: [1, 0.5], w: [0, 0.5], ne: [1, 0], nw: [0, 0], se: [1, 1], sw: [0, 1] };
    cropView = (
      <Fragment>
        {Object.entries(at).map(([h, [fx, fy]]) => (
          <span
            key={h}
            className="pe-free-crop"
            data-c={h}
            data-testid={`free-crop-${h}`}
            role="presentation"
            title={inCell && (h.includes("e") || h.includes("w")) ? "Glisser pour changer la largeur de la case (colonnes) et la hauteur de la planche" : "Glisser pour recadrer le cadre de la planche (Alt : sans magnétisme, Échap : annuler)"}
            style={{ left: zr.left + zr.width * fx, top: zr.top + zr.height * fy }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              try {
                window.focus();
              } catch {}
              startCrop(e, handleRef, h);
            }}
          />
        ))}
        {badge && gesturing && <span className="pe-free-badge" data-testid="free-crop-badge" style={{ left: zr.left + zr.width / 2, top: zr.top + zr.height + 8 }}>{badge}</span>}
      </Fragment>
    );
  }

  return (
    <div className="pe-layer pe-free-layer" lang="fr">
      {cropView}
      {selView}
      {guides?.v.map((v) => <span key={`v${v}`} className="pe-free-guide" data-axis="v" data-testid="free-guide" style={{ left: guides.zone.left + ((v - guides.fb.l) / guides.fb.w) * guides.zone.width, top: guides.zone.top, height: guides.zone.height }} />)}
      {guides?.h.map((h) => <span key={`h${h}`} className="pe-free-guide" data-axis="h" data-testid="free-guide" style={{ top: guides.zone.top + ((h - guides.fb.t) / guides.fb.h) * guides.zone.height, left: guides.zone.left, width: guides.zone.width }} />)}
    </div>
  );
}

/** Rotation en degrés, par pas de 1° (−180 à 180) : validée à Entrée ou en quittant le champ. */
function RotationField({ value, onCommit }: { value: number; onCommit: (rot: number) => void }) {
  const [text, setText] = useState(String(value));
  const apply = (raw: string) => {
    const n = Math.round(Number(raw));
    if (raw.trim() === "" || !Number.isFinite(n)) return setText(String(value));
    const rot = Math.min(180, Math.max(-180, n));
    setText(String(rot));
    if (rot !== value) onCommit(rot);
  };
  return (
    <label className="pe-free-rotlabel">
      <span>Rotation</span>
      <input
        className="pe-free-rot"
        type="number"
        inputMode="numeric"
        min={-180}
        max={180}
        step={1}
        value={text}
        aria-label="Rotation en degrés"
        data-testid="free-rotation"
        // Une saisie se valide à Entrée ou en quittant le champ (les flèches du champ aussi, au relâchement).
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => apply(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply((e.target as HTMLInputElement).value);
          e.stopPropagation();
        }}
      />
      <span aria-hidden="true">°</span>
    </label>
  );
}
