"use client";

/**
 * « Tuto du kit » : diaporama plein écran (dialogue modal) qui présente le
 * kit Photoshop slide par slide. Contenu : themes/tuto/slides.ts ; visuels :
 * public/admin/tuto (scripts/tuto-shots.mjs) ; annotations dessinées en SVG
 * par-dessus l'image, d'après les boîtes de shots.json.
 * Clavier : ← → (slides), Échap (fermer), Tab piégé dans le dialogue ;
 * balayage tactile ; dernière slide vue mémorisée (localStorage).
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import shots from "@/app/admin/(espace)/themes/tuto/shots.json";
import { TUTO_SLIDES, type TutoNote, type TutoSlide } from "@/app/admin/(espace)/themes/tuto/slides";

import KitDownloadButton from "./KitDownloadButton";

type Shot = { w: number; h: number; boxes: Record<string, number[]> };
const SHOTS = shots as Record<string, Shot>;
const STORE = "portfolio-tuto-kit";

function readStored(): number {
  try {
    const n = Number(localStorage.getItem(STORE));
    return Number.isInteger(n) && n >= 0 && n < TUTO_SLIDES.length ? n : 0;
  } catch {
    return 0;
  }
}
function store(n: number) {
  try {
    localStorage.setItem(STORE, String(n));
  } catch {
    // stockage indisponible : la reprise repart du début
  }
}

/** Point de la boîte le plus proche de (x, y) : bout du trait de rappel. */
const nearest = (bx: number[], x: number, y: number) => [Math.max(bx[0], Math.min(x, bx[0] + bx[2])), Math.max(bx[1], Math.min(y, bx[1] + bx[3]))];
/** Centre d'un bord de boîte (flèches entre deux étapes). */
const edge = (b: number[], side: "left" | "right") => [side === "left" ? b[0] : b[0] + b[2], b[1] + b[3] / 2];

/**
 * Position d'une étiquette : TOUJOURS hors du cadre annoté (au-dessus,
 * dessous, à côté) ou en un point libre de l'image (`at`) avec un trait de
 * rappel ; jamais sur le contenu désigné.
 */
function tagPosition(n: TutoNote, b: number[], shot: Shot): { x: number; y: number } {
  if (n.at) return { x: n.at[0] * shot.w, y: n.at[1] * shot.h };
  switch (n.place ?? "top") {
    case "bottom":
      return { x: b[0], y: b[1] + b[3] };
    case "right":
      return { x: b[0] + b[2], y: b[1] + b[3] / 2 };
    case "left":
      return { x: b[0], y: b[1] + b[3] / 2 };
    default:
      return { x: b[0], y: b[1] };
  }
}

function Figure({ slide, onZoom }: { slide: TutoSlide; onZoom: () => void }) {
  const t = useTranslations("kitTutorial");
  const tt = useTranslations("themeTuto");
  const alt = tt(`${slide.id}.alt`);
  const labelOf = (n: TutoNote) => tt(`${slide.id}.note_${n.box}`);
  const shot = SHOTS[slide.image];
  const id = useId();
  if (!shot) return null;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const notes = (slide.notes ?? []).filter((n) => shot.boxes[n.box]);
  return (
    <>
      <figure className="a-tuto-figure" style={{ aspectRatio: `${shot.w} / ${shot.h}`, ["--ratio" as string]: String(shot.w / shot.h) }}>
        <button type="button" className="a-tuto-zoomable" onClick={onZoom} aria-label={t("zoomImage", { alt })}>
          <picture>
            <source srcSet={`/admin/tuto/${slide.image}.avif`} type="image/avif" />
            <img src={`/admin/tuto/${slide.image}.webp`} alt={alt} width={shot.w} height={shot.h} decoding="async" data-tuto-image />
          </picture>
        </button>
        <svg className="a-tuto-notes" viewBox={`0 0 ${shot.w} ${shot.h}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id={`${id}-tip`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 Z" className="a-tuto-tip" />
            </marker>
          </defs>
          {notes.map((n) => {
            const b = shot.boxes[n.box];
            const t = tagPosition(n, b, shot);
            const [lx, ly] = nearest(b, t.x, t.y);
            return (
              <g key={n.box}>
                <rect x={b[0]} y={b[1]} width={b[2]} height={b[3]} rx="8" className="a-tuto-box" vectorEffect="non-scaling-stroke" />
                {n.at && <line x1={t.x} y1={t.y} x2={lx} y2={ly} className="a-tuto-leader" vectorEffect="non-scaling-stroke" />}
              </g>
            );
          })}
          {slide.arrows?.map(([from, to]) => {
            const a = shot.boxes[from];
            const b = shot.boxes[to];
            if (!a || !b) return null;
            const [x1, y1] = edge(a, "right");
            const [x2, y2] = edge(b, "left");
            return <line key={`${from}-${to}`} x1={x1 + 8} y1={y1} x2={x2 - 8} y2={y2} className="a-tuto-arrow" vectorEffect="non-scaling-stroke" markerEnd={`url(#${id}-tip)`} />;
          })}
        </svg>
        {notes.map((n, i) => {
          const b = shot.boxes[n.box];
          const t = tagPosition(n, b, shot);
          return (
            <span key={n.box} aria-hidden="true">
              <span className="a-tuto-tag" data-place={n.at ? "at" : (n.place ?? "top")} style={{ left: pct(t.x, shot.w), top: pct(t.y, shot.h) }}>
                {labelOf(n)}
              </span>
              {/* Petit écran : numéro hors du cadre, légende sous l'image. */}
              <span className="a-tuto-badge" style={{ left: pct(b[0], shot.w), top: pct(b[1], shot.h) }}>
                {i + 1}
              </span>
            </span>
          );
        })}
        <figcaption className="sr-only">{alt}</figcaption>
      </figure>
      {notes.length > 0 && (
        <ol className="a-tuto-legend" aria-hidden="true">
          {notes.map((n) => (
            <li key={n.box}>{labelOf(n)}</li>
          ))}
        </ol>
      )}
      <p className="a-tuto-hint">{t("zoomHint")}</p>
    </>
  );
}

/** Bouton qui ouvre le tuto. `themeId` : thème du bouton « Télécharger le kit » (slide 2). `fromTheme` : ouvert depuis l'écran d'un thème (slide 13 : « Renvoyer le kit »). */
export default function KitTutorial({ themeId, fromTheme = false, label, quiet = false }: { themeId: string; fromTheme?: boolean; label?: string; quiet?: boolean }) {
  const t = useTranslations("kitTutorial");
  const tt = useTranslations("themeTuto");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const touch = useRef<number | null>(null);
  const total = TUTO_SLIDES.length;
  const slide = TUTO_SLIDES[index];

  const go = useCallback(
    (n: number) => {
      const next = Math.max(0, Math.min(total - 1, n));
      setZoom(false);
      setIndex(next);
      store(next);
    },
    [total],
  );
  const close = useCallback(() => {
    setOpen(false);
    // Focus rendu au bouton qui a ouvert le tuto.
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>("[data-tuto-title]")?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Titre focalisé à chaque slide : annoncé par les lecteurs d'écran.
  useEffect(() => {
    if (open) dialog.current?.querySelector<HTMLElement>("[data-tuto-title]")?.focus({ preventScroll: true });
  }, [index, open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && zoom) {
      e.preventDefault();
      setZoom(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowRight" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      go(index + 1);
    } else if (e.key === "ArrowLeft" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      go(index - 1);
    } else if (e.key === "Tab") {
      // Focus piégé dans le dialogue.
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, [tabindex="0"]') ?? [])];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const sendKit = () => {
    close();
    requestAnimationFrame(() => {
      const target = document.getElementById("kit-send");
      target?.scrollIntoView({ block: "start" });
      document.querySelector<HTMLElement>(".a-kit-drop label")?.focus();
    });
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`a-btn${quiet ? " a-btn-quiet" : ""}`}
        onClick={() => {
          setIndex(readStored());
          setOpen(true);
        }}
        aria-haspopup="dialog"
        data-testid="tuto-open"
      >
        {label ?? t("label")}
      </button>
      {open && (
        <div className="a-tuto" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog} onKeyDown={onKey}>
          <header className="a-tuto-head">
            <p className="a-tuto-kicker">{t("kicker")}</p>
            <p className="a-tuto-count" aria-live="polite">
              {index + 1} / {total}
            </p>
            <button type="button" className="a-btn a-btn-quiet" onClick={close} data-testid="tuto-close">
              {t("close")}
            </button>
          </header>
          <div
            className="a-tuto-slide"
            key={slide.id}
            data-slide={slide.id}
            onPointerDown={(e) => {
              if (e.pointerType !== "mouse") touch.current = e.clientX;
            }}
            onPointerUp={(e) => {
              if (touch.current === null) return;
              const dx = e.clientX - touch.current;
              touch.current = null;
              if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
            }}
          >
            <div className="a-tuto-media">
              <Figure
                slide={slide}
                onZoom={() => {
                  // Agrandissement : petit écran seulement (en grand, l'image a déjà sa place).
                  if (window.matchMedia("(max-width: 900px)").matches) setZoom(true);
                }}
              />
            </div>
            <div className="a-tuto-text">
              <h2 id={titleId} tabIndex={-1} data-tuto-title>
                {tt(`${slide.id}.title`)}
              </h2>
              <ul>
                {Array.from({ length: slide.bullets }, (_, i) => (
                  <li key={i}>{tt(`${slide.id}.b${i + 1}`)}</li>
                ))}
              </ul>
              {slide.action === "download" && (
                <div className="a-tuto-action">
                  <KitDownloadButton themeId={themeId} />
                </div>
              )}
              {slide.action === "send" && fromTheme && (
                <div className="a-tuto-action">
                  <button type="button" className="a-btn a-btn-primary" onClick={sendKit}>
                    {t("sendKit")}
                  </button>
                </div>
              )}
            </div>
          </div>
          {zoom && (
            <div className="a-tuto-zoom" role="dialog" aria-label={t("zoomedImage", { alt: tt(`${slide.id}.alt`) })} onClick={() => setZoom(false)}>
              <picture>
                <source srcSet={`/admin/tuto/${slide.image}.avif`} type="image/avif" />
                <img src={`/admin/tuto/${slide.image}.webp`} alt={tt(`${slide.id}.alt`)} data-tuto-zoom />
              </picture>
              <button type="button" className="a-btn" autoFocus onClick={() => setZoom(false)}>
                {t("closeImage")}
              </button>
            </div>
          )}
          <footer className="a-tuto-foot">
            <button type="button" className="a-btn" onClick={() => go(index - 1)} disabled={index === 0}>
              {t("prev")}
            </button>
            {/* Petit écran : barre de progression fine (le compteur « 4 / 15 » est en haut). */}
            <div className="a-tuto-progress" role="progressbar" aria-label={t("progress")} aria-valuemin={1} aria-valuemax={total} aria-valuenow={index + 1}>
              <span style={{ width: `${((index + 1) / total) * 100}%` }} />
            </div>
            <ol className="a-tuto-dots">
              {TUTO_SLIDES.map((s, i) => (
                <li key={s.id}>
                  <button type="button" className="a-tuto-dot" aria-label={t("slideLabel", { n: i + 1, title: tt(`${s.id}.title`) })} aria-current={i === index ? "step" : undefined} onClick={() => go(i)} />
                </li>
              ))}
            </ol>
            {index < total - 1 ? (
              <button type="button" className="a-btn a-btn-primary" onClick={() => go(index + 1)}>
                {t("next")}
              </button>
            ) : (
              <button type="button" className="a-btn a-btn-primary" onClick={close}>
                {t("finish")}
              </button>
            )}
          </footer>
        </div>
      )}
    </>
  );
}
