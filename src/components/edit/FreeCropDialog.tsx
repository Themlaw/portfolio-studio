"use client";

/**
 * « Cadrer l'image », mode Libre (lot 17d) : un rectangle quelconque posé sur
 * l'image ENTIÈRE, poignées aux coins et sur les bords, glissé pour le déplacer.
 * Formats rapides : Libre, Original, puis la liste commune des formats (le rectangle garde alors son
 * format aux coins ; il se pose dans la zone déjà choisie). Le résultat est un
 * rectangle normalisé {x, y, w, h} (src/lib/images/crop.ts), enregistré dans
 * `look.crop` du bloc par la couche (LookLayer) : jamais l'image elle-même.
 * Souris, tactile (touch-action: none) et clavier (flèches, + / −, Entrée, Échap).
 * `square` (lot 83, icône de l'onglet) : le même outil, verrouillé sur un carré ; seul le format « Carré 1:1 » est proposé.
 */
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { FORMAT_KEYS, FORMAT_LABELS } from "@/lib/images/formats";
import { fromUnits, isWholeImage, MIN_SIDE, toUnits, type Rect } from "@/lib/images/crop";

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Libre, Original, puis la liste de formats commune à tous les réglages (src/lib/images/formats.ts). */
export const FORMATS: { id: string; label: string; ratio: number | null }[] = [
  { id: "libre", label: FORMAT_LABELS.auto, ratio: null },
  { id: "original", label: "Original", ratio: null },
  ...FORMAT_KEYS.filter((k) => k !== "auto").map((k) => {
    const [w, h] = k.split(":").map(Number);
    return { id: k, label: FORMAT_LABELS[k], ratio: w / h };
  }),
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Rectangle après un glissé de la poignée `mode` (dx, dy en fractions de l'image) ; `aspect` = w/h normalisé si le format est verrouillé. */
export function dragRect(mode: Handle | "move", start: Rect, dx: number, dy: number, aspect: number | null): Rect {
  if (mode === "move") return { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) };
  const west = mode.includes("w");
  const east = mode.includes("e");
  const north = mode.includes("n");
  const south = mode.includes("s");
  if (aspect && (west || east) && (north || south)) {
    // Format verrouillé : le coin opposé reste en place, la taille suit le plus grand déplacement.
    const ax = west ? start.x + start.w : start.x;
    const ay = north ? start.y + start.h : start.y;
    const px = (west ? start.x : start.x + start.w) + dx;
    const py = (north ? start.y : start.y + start.h) + dy;
    const maxW = west ? ax : 1 - ax;
    const maxH = north ? ay : 1 - ay;
    let w = Math.max(Math.abs(px - ax), Math.abs(py - ay) * aspect);
    w = Math.min(w, maxW, maxH * aspect);
    w = Math.max(w, MIN_SIDE, MIN_SIDE * aspect);
    const h = w / aspect;
    return { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h };
  }
  let { x, y, w, h } = start;
  if (west) {
    const nx = clamp(start.x + dx, 0, start.x + start.w - MIN_SIDE);
    w = start.x + start.w - nx;
    x = nx;
  }
  if (east) w = clamp(start.w + dx, MIN_SIDE, 1 - start.x);
  if (north) {
    const ny = clamp(start.y + dy, 0, start.y + start.h - MIN_SIDE);
    h = start.y + start.h - ny;
    y = ny;
  }
  if (south) h = clamp(start.h + dy, MIN_SIDE, 1 - start.y);
  return { x, y, w, h };
}

/** Plus grand rectangle de rapport `aspect` (w/h normalisé) dans `inner`, centré dessus. */
export function fitAspect(inner: Rect, aspect: number): Rect {
  const w = Math.min(inner.w, inner.h * aspect);
  const h = w / aspect;
  return { x: clamp(inner.x + (inner.w - w) / 2, 0, 1 - w), y: clamp(inner.y + (inner.h - h) / 2, 0, 1 - h), w, h };
}

export default function FreeCropDialog({
  src,
  px,
  initial,
  tabs,
  square = false,
  onSave,
  onClose,
}: {
  /** Image entière (jamais la variante recadrée). */
  src: string;
  /** Dimensions de l'image entière en pixels (rapport l/h = px.w / px.h). */
  px: { w: number; h: number };
  initial: Rect | null;
  tabs?: ReactNode;
  /** Recadrage carré verrouillé (icône de l'onglet). */
  square?: boolean;
  /** null : retirer le recadrage (image entière). */
  onSave: (rect: Rect | null) => void;
  onClose: () => void;
}) {
  const t = useTranslations("editMenusCrop");
  const ir = px.w / px.h;
  const [rect, setRect] = useState<Rect>(initial ?? (square ? fitAspect({ x: 0, y: 0, w: 1, h: 1 }, 1 / ir) : { x: 0, y: 0, w: 1, h: 1 }));
  // Format verrouillé : rapport en pixels (l/h) ; null = libre.
  const [lock, setLock] = useState<number | null>(square ? 1 : null);
  const [format, setFormat] = useState(square ? "1:1" : "libre");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => dialog.current?.focus(), []);
  const [win, setWin] = useState({ w: typeof window === "undefined" ? 1200 : window.innerWidth, h: typeof window === "undefined" ? 800 : window.innerHeight });
  useEffect(() => {
    const on = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  // L'image entière tient dans 86 % × 52 % de la fenêtre (le reste : titre, formats, boutons).
  const sw = Math.max(120, Math.min(win.w * 0.86, win.h * 0.52 * ir));
  const sh = sw / ir;
  const aspect = lock ? lock / ir : null;

  const apply = (mode: Handle | "move", start: Rect, dx: number, dy: number) => setRect(dragRect(mode, start, dx / sw, dy / sh, aspect));
  const begin = (mode: Handle | "move") => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = rect;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => apply(mode, start, ev.clientX - sx, ev.clientY - sy);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const choose = (f: (typeof FORMATS)[number]) => {
    setFormat(f.id);
    if (f.id === "libre") return setLock(null);
    if (f.id === "original") {
      setLock(null);
      return setRect({ x: 0, y: 0, w: 1, h: 1 });
    }
    setLock(f.ratio);
    setRect((r) => fitAspect(r, (f.ratio as number) / ir));
  };
  const step = (dx: number, dy: number) => setRect((r) => dragRect("move", r, dx, dy, null));
  const scale = (f: number) =>
    setRect((r) => {
      const a = aspect ?? r.w / r.h;
      const w = clamp(r.w * f, MIN_SIDE, 1);
      const h = clamp(w / a, MIN_SIDE, 1);
      const ww = Math.min(w, h * a);
      const hh = ww / a;
      return { x: clamp(r.x + (r.w - ww) / 2, 0, 1 - ww), y: clamp(r.y + (r.h - hh) / 2, 0, 1 - hh), w: ww, h: hh };
    });
  const save = () => {
    const snapped = fromUnits(toUnits(rect));
    onSave(isWholeImage(snapped) ? null : snapped);
  };
  const pw = Math.round(rect.w * px.w);
  const ph = Math.round(rect.h * px.h);

  return (
    <div className="lk-crop-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="lk-crop"
        role="dialog"
        aria-modal="true"
        aria-label={square ? t("cropIcon") : t("cropImage")}
        tabIndex={-1}
        onKeyDown={(e) => {
          const big = e.shiftKey ? 0.1 : 0.02;
          const keys: Record<string, () => void> = {
            ArrowLeft: () => step(-big, 0),
            ArrowRight: () => step(big, 0),
            ArrowUp: () => step(0, -big),
            ArrowDown: () => step(0, big),
            "+": () => scale(1.1),
            "=": () => scale(1.1),
            "-": () => scale(0.9),
            Escape: onClose,
            Enter: save,
          };
          if (keys[e.key] && !(e.target instanceof HTMLButtonElement && e.key === "Enter")) {
            e.preventDefault();
            e.stopPropagation();
            keys[e.key]();
          }
        }}
      >
        <p className="lk-crop-title">{square ? t("cropIcon") : t("cropImage")}</p>
        {tabs}
        <p className="lk-crop-help">
          {t("help", { square: String(square) })}
        </p>
        <div className="lk-crop-formats" role="group" aria-label={t("formats")}>
          {FORMATS.filter((f) => !square || f.id === "1:1").map((f) => (
            <button key={f.id} type="button" aria-pressed={format === f.id} data-format={f.id} onClick={() => choose(f)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="lk-crop-stage lk-crop-free" data-testid="crop-stage" style={{ width: sw, height: sh, backgroundImage: `url("${src.replace(/"/g, "%22")}")` }}>
          <div
            className="lk-crop-window"
            data-testid="crop-window"
            data-rect={`${rect.x.toFixed(4)},${rect.y.toFixed(4)},${rect.w.toFixed(4)},${rect.h.toFixed(4)}`}
            style={{ left: rect.x * sw, top: rect.y * sh, width: rect.w * sw, height: rect.h * sh }}
            onPointerDown={begin("move")}
          >
            {HANDLES.filter((h) => !aspect || h.length === 2).map((h) => (
              <span key={h} className="lk-crop-handle" data-handle={h} role="presentation" title={t(`h_${h}`)} onPointerDown={begin(h)} />
            ))}
          </div>
        </div>
        <p className="lk-crop-size" data-testid="crop-size" aria-live="polite">
          {pw} × {ph} px · {(pw / Math.max(1, ph)).toFixed(2)}:1
        </p>
        <div className="lk-crop-actions">
          <button
            type="button"
            onClick={() => {
              setRect(square ? fitAspect({ x: 0, y: 0, w: 1, h: 1 }, 1 / ir) : { x: 0, y: 0, w: 1, h: 1 });
              setLock(square ? 1 : null);
              setFormat(square ? "1:1" : "libre");
            }}
          >
            {square ? t("recenter") : t("whole")}
          </button>
          <span className="lk-spacer" />
          <button type="button" onClick={onClose}>
            {t("closeNoSave")}
          </button>
          <button type="button" className="lk-primary" onClick={save}>
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
