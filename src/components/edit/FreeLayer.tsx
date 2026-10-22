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

import { FREE_MAX_W, FREE_MIN_W, snapBox, type FreeBox, type FreeGuides } from "@/blocks/free-board";
import { imageBgCss, RADII, RADIUS_LABELS, type Frame, type ImageBg, type Radius } from "@/lib/look";
import type { FreeCanvasOp } from "@/lib/edit/protocol";

import { FrameControls } from "./FrameMenu";
import { ImageBgControls } from "./ImageBgControls";
import { clearAspect, clearItem, findItem, findZone, freeKey, freeRefOf, ITEM_SELECTOR, itemsOf, readItem, writeAspect, writeItem, type FreeGeom, type FreeRef } from "./free-dom";
import { postIntent, setOverlay } from "./optimistic";
import { useDismiss } from "./useDismiss";

type Sel = { key: string; id: string };
type Place = Partial<Pick<FreeGeom, "x" | "y" | "w" | "rot">>;

/** Envoie une opération à l'éditeur ; renvoie le numéro de l'intention. */
function send(ref: FreeRef, op: FreeCanvasOp): number {
  return postIntent({ kind: "free-op", uid: ref.uid, ...(ref.board ? { board: ref.board, ...(ref.props ? { props: ref.props } : {}) } : {}), op });
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
function commitAspect(ref: FreeRef, aspect: number) {
  const key = freeKey(ref);
  const seq = send(ref, { op: "set", aspect });
  setOverlay(`free-h:${key}`, seq, {
    apply: () => {
      const z = findZone(key);
      if (z) writeAspect(z, aspect);
    },
    clear: () => {
      const z = findZone(key);
      if (z) clearAspect(z);
    },
  });
}

type Rect = { top: number; left: number; width: number; height: number };
const docRect = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
};

/** Hauteur d'une image en % de la hauteur de la zone, d'après les mesures réelles (largeur de la zone, hauteur de la zone). */
const hPct = (g: FreeGeom, zr: { width: number; height: number }) => ((g.w / 100) * zr.width) / g.ratio / zr.height * 100;

type Gesture = {
  kind: "move" | "resize" | "rotate" | "height";
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
  lastAspect?: number;
  angle0: number;
  corner: { x: number; y: number };
  anchor: { x: number; y: number };
  center: { x: number; y: number };
  H0: number;
};

const norm = (deg: number) => {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180 && deg > 0) d = 180;
  return d;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Fenêtre « Cadre » de l'image : mêmes réglages que le cadre d'une image seule. */
function ItemFrame({ box, frame, onChange, onClose, what }: { box: Rect; frame: Frame | undefined; onChange: (f: Frame | undefined) => void; onClose: () => void; what: "photo" | "vidéo" }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const width = Math.min(330, document.documentElement.clientWidth - 24);
  const left = Math.max(window.scrollX + 8, Math.min(box.left, window.scrollX + document.documentElement.clientWidth - width - 8));
  return (
    <div ref={ref} className="sm tc pe-slot-frame" role="dialog" aria-label={`Cadre de la ${what}`} data-testid="free-frame" style={{ top: box.top + box.height + 8, left, right: "auto" }}>
      <FrameControls value={frame} onChange={onChange} what={what} />
    </div>
  );
}

/** Fenêtre « Fond image » de l'image (lot 41) : mêmes choix que le fond d'une image seule. */
function ItemBg({ box, bg, onChange, onClose }: { box: Rect; bg: string | undefined; onChange: (b: string | undefined) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const width = Math.min(330, document.documentElement.clientWidth - 24);
  const left = Math.max(window.scrollX + 8, Math.min(box.left, window.scrollX + document.documentElement.clientWidth - width - 8));
  return (
    <div ref={ref} className="sm tc pe-slot-frame" role="dialog" aria-label="Fond de l'image" data-testid="free-imgbg" style={{ top: box.top + box.height + 8, left, right: "auto" }}>
      <ImageBgControls value={bg} onChange={onChange} />
    </div>
  );
}

export default function FreeLayer({ selected, dragging, announce }: { selected: string | null; dragging: boolean; announce: (s: string) => void }) {
  const [tick, setTick] = useState(0);
  const [sel, setSelState] = useState<Sel | null>(null);
  const [frameOpen, setFrameOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [guides, setGuides] = useState<(FreeGuides & { zone: Rect }) | null>(null);
  const [gesturing, setGesturing] = useState(false);
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
      const g0 = el ? readItem(el) : { id: "", x: 0, y: 0, w: 30, rot: 0, ratio: 1 };
      const p = { x: ((e.clientX - zr.left) / zr.width) * 100, y: ((e.clientY - zr.top) / zr.height) * 100 };
      const key = freeKey(ref);
      // Géométrie en pixels de la zone (origine = son coin haut gauche), pour les poignées de coin et de rotation.
      const pw = (g0.w / 100) * zr.width;
      const ph = pw / g0.ratio;
      const c = { x: ((g0.x + g0.w / 2) / 100) * zr.width, y: (g0.y / 100) * zr.height + ph / 2 };
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
                return { x: g.x, y: g.y, w: g.w, h: hPct(g, zr) };
              })
          : [],
        active: false,
        last: {},
        angle0: Math.atan2(e.clientY - (zr.top + c.y), e.clientX - (zr.left + c.x)),
        corner: { x: c.x + off.x, y: c.y + off.y },
        anchor: { x: c.x - off.x, y: c.y - off.y },
        center: c,
        H0: zr.height,
      };
    },
    [],
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
      if (g.kind === "height") {
        const min = zr.width / 4;
        const max = zr.width / 0.4;
        const h = Math.min(max, Math.max(min, g.H0 + (e.clientY - g.start.y)));
        g.lastAspect = Math.round((zr.width / h) * 1000) / 1000;
        writeAspect(zone, g.lastAspect);
        bump();
        return;
      }
      const p = { x: ((e.clientX - zr.left) / zr.width) * 100, y: ((e.clientY - zr.top) / zr.height) * 100 };
      if (g.kind === "move") {
        const h = hPct(g.g0, zr);
        let x = p.x - g.grab.x;
        let y = p.y - g.grab.y;
        if (!e.altKey) {
          const s = snapBox({ x, y, w: g.g0.w, h }, g.others, (6 / zr.width) * 100, (6 / zr.height) * 100);
          x = s.box.x;
          y = s.box.y;
          setGuides({ ...s.guides, zone: docRect(zone) });
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
        const ph = ((w / 100) * zr.width) / g.g0.ratio;
        g.last = { w: r2(w), x: r2((c.x / zr.width) * 100 - w / 2), y: r2(((c.y - ph / 2) / zr.height) * 100) };
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
      if (g.kind === "height") {
        if (commit && g.lastAspect !== undefined) {
          commitAspect(g.ref, g.lastAspect);
          announce("Hauteur de la zone changée.");
        } else clearAspect(g.ref.zone);
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
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    return () => {
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
    const width = (g.w / 100) * zr.width;
    const height = width / g.ratio;
    const left = zr.left + (g.x / 100) * zr.width;
    const top = zr.top + (g.y / 100) * zr.height;
    const bb = docRect(itemEl);
    let style: { radius?: Radius; frame?: Frame; bg?: string } = {};
    try {
      style = JSON.parse(itemEl.dataset.freeStyle ?? "{}") as typeof style;
    } catch {}
    const isVideo = Boolean(itemEl.querySelector("video"));
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
          <div className="pe-slot-tools" role="toolbar" aria-label="Image de la planche libre" data-testid="free-bar" style={{ top: barTop, left: barLeft, width: "max-content", maxWidth: 760 }}>
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
              <select aria-label="Arrondi de cette image" data-testid="free-radius" value={style.radius ?? "none"} onChange={(e) => send(ref, { op: "style", id: sel.id, radius: e.target.value === "none" ? null : (e.target.value as Radius) })}>
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
                <span className="sm-dot" data-on={imageBgCss(style.bg) ? "" : undefined} style={imageBgCss(style.bg) ? { background: imageBgCss(style.bg) ?? undefined } : undefined} aria-hidden="true" />
                Fond image
              </button>
            )}
            <RotationField key={`${sel.id}-${g.rot}`} value={g.rot} onCommit={(rot) => commitPlace(ref, sel.id, { rot })} />
            <span data-free-bar-extra="" />
          </div>
        )}
        {bgOpen && !gesturing && (
          <ItemBg box={bb} bg={style.bg} onClose={() => setBgOpen(false)} onChange={(bg) => send(ref, { op: "style", id: sel.id, bg: (bg as ImageBg | undefined) ?? null })} />
        )}
        {frameOpen && !gesturing && (
          <ItemFrame what={isVideo ? "vidéo" : "photo"} box={bb} frame={style.frame} onClose={() => setFrameOpen(false)} onChange={(frame) => send(ref, { op: "style", id: sel.id, frame: frame ?? null })} />
        )}
      </Fragment>
    );
  }

  let heightView: React.ReactNode = null;
  if (handleZone && handleRef && !dragging) {
    const zr = docRect(handleZone);
    heightView = (
      <span
        className="pe-free-height"
        data-testid="free-height"
        role="presentation"
        title="Glisser pour changer la hauteur de la zone"
        style={{ left: zr.left + zr.width / 2, top: zr.top + zr.height - 30 }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          startGesture("height", e, handleRef, null);
        }}
      />
    );
  }

  return (
    <div className="pe-layer pe-free-layer" lang="fr">
      {selView}
      {heightView}
      {guides?.v.map((v) => <span key={`v${v}`} className="pe-free-guide" data-axis="v" data-testid="free-guide" style={{ left: guides.zone.left + (v / 100) * guides.zone.width, top: guides.zone.top, height: guides.zone.height }} />)}
      {guides?.h.map((h) => <span key={`h${h}`} className="pe-free-guide" data-axis="h" data-testid="free-guide" style={{ top: guides.zone.top + (h / 100) * guides.zone.height, left: guides.zone.left, width: guides.zone.width }} />)}
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
