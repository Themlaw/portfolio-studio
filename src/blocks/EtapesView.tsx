"use client";

import { useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { comparePos, keyIndex, turnIndex, type StepsMode, type StepsView } from "./etapes";

export type StepsTexts = { before: string; after: string; slider: string; prev: string; next: string; views: string; steps: string; view: string };
export type StepsViewItem = { label: string; caption: string };

type Props = {
  mode: StepsMode;
  view?: StepsView;
  /** Format commun des images, écrit `3:2` (« auto » ou absent : celui de la première image). */
  ratio?: string;
  /** Rapport largeur / hauteur de repli quand le format n'est pas imposé. */
  fallbackRatio?: number;
  start?: number;
  items: StepsViewItem[];
  /** Images déjà rendues par le serveur (une par étape). */
  pics: ReactNode[];
  texts: StepsTexts;
  /** Vue brouillon : repères de texte modifiable en place (jamais en public). */
  edit?: boolean;
  /** Style local (Aa) de chaque texte, par chemin (`items.0.label`). */
  styles?: Record<string, CSSProperties>;
  uid?: string;
};

/**
 * Étapes (lot 131). Rendu serveur lisible SANS JavaScript : comparer = deux moitiés d'images et leurs mots « Avant / Après » ;
 * étapes et tourner = toutes les images et légendes les unes sous les autres. `data-ready` (posé après l'hydratation) active
 * les commandes : curseur, onglets, vues. Aucune rotation automatique, aucune transition (mouvement réduit respecté de fait).
 */
export default function EtapesView(p: Props) {
  const id = useId();
  // Faux au rendu serveur et à l hydratation, vrai ensuite : les commandes ne s activent qu une fois le script en place.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState(Math.max(0, Math.min(100, p.start ?? 50)));
  const stage = useRef<HTMLDivElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const n = p.pics.length;
  const view = p.view ?? "tabs";
  const ratio = p.ratio && p.ratio !== "auto" ? p.ratio.replace(":", " / ") : p.fallbackRatio ? p.fallbackRatio.toFixed(4) : "3 / 2";
  const root = {
    className: "steps",
    "data-steps-mode": p.mode,
    "data-steps-view": p.mode === "steps" ? view : p.mode,
    ...(p.uid ? { "data-steps-uid": p.uid } : {}),
    ...(ready ? { "data-ready": "" } : {}),
    style: { "--sr": ratio, "--pos": `${pos}%` } as CSSProperties,
  };
  const text = (path: string, value: string, tag: "span" | "p" | "strong", cls: string, placeholder: string) => {
    if (!value && !p.edit) return null;
    const Tag = tag;
    return (
      <Tag className={cls} style={p.styles?.[path]} {...(p.edit ? { "data-inline": path, "data-placeholder": placeholder } : {})}>
        {value}
      </Tag>
    );
  };
  const caption = (i: number) => {
    const it = p.items[i] ?? { label: "", caption: "" };
    const label = text(`items.${i}.label`, it.label, "strong", "steps-label", "Titre de l'étape");
    const cap = text(`items.${i}.caption`, it.caption, "span", "steps-caption", "Légende");
    return label || cap ? (
      <figcaption className="steps-figcap">
        {label}
        {cap}
      </figcaption>
    ) : null;
  };
  const tabLabel = (i: number) => p.items[i]?.label || `${p.texts.steps} ${i + 1}`;

  if (p.mode === "compare") {
    const move = (e: PointerEvent<HTMLDivElement>) => {
      if (!drag.current || !stage.current) return;
      setPos(comparePos(e.clientX, stage.current.getBoundingClientRect()));
    };
    return (
      <div {...root}>
        <div
          ref={stage}
          className="steps-stage"
          data-steps-stage=""
          onDragStart={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            if (!ready || !stage.current) return;
            drag.current = { x: e.clientX, start: pos };
            e.currentTarget.setPointerCapture(e.pointerId);
            setPos(comparePos(e.clientX, stage.current.getBoundingClientRect()));
            range.current?.focus({ preventScroll: true });
          }}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <div className="steps-layer" data-steps-before="">
            {p.pics[0]}
          </div>
          <div className="steps-layer" data-steps-after="">
            {p.pics[1]}
          </div>
          <span className="steps-tag steps-tag-before">{p.texts.before}</span>
          <span className="steps-tag steps-tag-after">{p.texts.after}</span>
          <span className="steps-handle" aria-hidden="true" />
          <input
            ref={range}
            className="steps-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={pos}
            aria-label={p.texts.slider}
            aria-valuetext={`${pos} %`}
            onChange={(e) => setPos(Number(e.target.value))}
          />
        </div>
        {(p.items[0]?.label || p.items[0]?.caption || p.items[1]?.label || p.items[1]?.caption || p.edit) && (
          <div className="steps-pair">
            {[0, 1].map((i) => (
              <figure key={i} className="steps-pair-item">
                {caption(i)}
              </figure>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (p.mode === "turn") {
    const go = (next: number | null) => next !== null && setIndex(next);
    const label = `${index + 1} / ${n}`;
    return (
      <div {...root} role="group" aria-label={p.texts.views}>
        <div
          ref={stage}
          className="steps-stage"
          data-steps-stage=""
          tabIndex={0}
          aria-roledescription="carousel"
          onKeyDown={(e: KeyboardEvent) => {
            const next = keyIndex(e.key, index, n, true);
            if (next !== null) {
              e.preventDefault();
              go(next);
            }
          }}
          onDragStart={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            if (!ready) return;
            drag.current = { x: e.clientX, start: index };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current || !stage.current) return;
            go(turnIndex(drag.current.start, e.clientX - drag.current.x, stage.current.getBoundingClientRect().width, n, n));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          {p.pics.map((pic, i) => (
            <figure key={i} className="steps-frame" data-steps-frame={i} hidden={ready && i !== index}>
              {pic}
              {caption(i)}
            </figure>
          ))}
        </div>
        <div className="steps-nav">
          <button type="button" className="steps-btn" onClick={() => go(keyIndex("ArrowLeft", index, n, true))} aria-label={p.texts.prev}>
            ‹
          </button>
          <span className="steps-count" aria-live="polite">
            {label}
          </span>
          <button type="button" className="steps-btn" onClick={() => go(keyIndex("ArrowRight", index, n, true))} aria-label={p.texts.next}>
            ›
          </button>
        </div>
      </div>
    );
  }

  // Étapes.
  if (view !== "tabs") {
    return (
      <div {...root}>
        <div className="steps-list">
          {p.pics.map((pic, i) => (
            <figure key={i} className="steps-step">
              <div className="steps-stage steps-stage-solo">{pic}</div>
              {caption(i)}
            </figure>
          ))}
        </div>
      </div>
    );
  }
  const onTabKey = (e: KeyboardEvent) => {
    const next = keyIndex(e.key, index, n, false);
    if (next === null) return;
    e.preventDefault();
    setIndex(next);
    document.getElementById(`${id}-t${next}`)?.focus();
  };
  return (
    <div {...root}>
      {n > 1 && (
        <div className="steps-tabs" role="tablist" aria-label={p.texts.steps} onKeyDown={onTabKey}>
          {p.pics.map((_, i) => (
            <button key={i} id={`${id}-t${i}`} type="button" role="tab" className="steps-tab" aria-selected={i === index} aria-controls={`${id}-p${i}`} tabIndex={i === index ? 0 : -1} onClick={() => setIndex(i)}>
              {tabLabel(i)}
            </button>
          ))}
        </div>
      )}
      {p.pics.map((pic, i) => (
        <figure key={i} id={`${id}-p${i}`} role="tabpanel" aria-labelledby={n > 1 ? `${id}-t${i}` : undefined} className="steps-panel" hidden={ready && i !== index}>
          <div className="steps-stage steps-stage-solo">{pic}</div>
          {caption(i)}
        </figure>
      ))}
    </div>
  );
}
