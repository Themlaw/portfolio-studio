"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

type Metrics = {
  /** Part visible du rail, 0 → 1. Donne la largeur du curseur. */
  ratio: number;
  /** Position de lecture, 0 → 1. */
  progress: number;
  /** Nombre de pixels scrollables. 0 = tout tient. */
  slack: number;
};

const EMPTY: Metrics = { ratio: 1, progress: 0, slack: 0 };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Largeur du curseur, en part de la piste : plafonnée (12–34 %) pour que son
 * déplacement se voie quelle que soit la longueur de la planche. Avec le
 * ratio brut, une planche qui déborde de peu donnait un curseur de 83 % qui
 * ne bougeait que de 17 % : l'œil voyait surtout la piste grise découverte
 * (retour de l'artiste sur Décors, v0.10.1).
 */
const thumbShare = (ratio: number) => clamp(ratio, 0.12, 0.34);

/**
 * Barre de glissement d'une planche de projet.
 *
 * Elle sert de rattrapage : on voit d'un coup d'œil où on en est dans le
 * projet et on peut y aller directement, sans dépendre des flèches.
 * Elle disparaît dès que la bande tient entièrement dans le cadre — une
 * barre qui ne peut pas bouger n'a rien à dire.
 */
export default function RailScrollbar({
  railRef,
  railId,
  label,
}: {
  railRef: RefObject<HTMLDivElement | null>;
  /** Id du rail piloté, pour aria-controls. */
  railId: string;
  label: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const grabOffset = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const measure = () => {
      const slack = rail.scrollWidth - rail.clientWidth;
      setMetrics({
        ratio: rail.scrollWidth > 0 ? rail.clientWidth / rail.scrollWidth : 1,
        progress: slack > 0 ? clamp(rail.scrollLeft / slack, 0, 1) : 0,
        slack: slack > 8 ? slack : 0,
      });
    };

    measure();
    rail.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(rail);

    return () => {
      rail.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [railRef]);

  /** Place le rail d'après la position du pointeur sur la piste. */
  const scrollFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      const rail = railRef.current;
      if (!track || !rail) return;

      const rect = track.getBoundingClientRect();
      const thumbWidth = rect.width * thumbShare(metrics.ratio);
      const travel = rect.width - thumbWidth;
      if (travel <= 0) return;

      const x = clamp(clientX - rect.left - grabOffset.current, 0, travel);
      rail.scrollLeft = (x / travel) * metrics.slack;
    },
    [metrics.ratio, metrics.slack, railRef],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || metrics.slack === 0) return;

    const rect = track.getBoundingClientRect();
    const thumbWidth = rect.width * thumbShare(metrics.ratio);
    const thumbLeft = rect.left + metrics.progress * (rect.width - thumbWidth);
    const onThumb =
      event.clientX >= thumbLeft && event.clientX <= thumbLeft + thumbWidth;

    // Sur le curseur on garde le point de saisie ; sur la piste on centre.
    grabOffset.current = onThumb
      ? event.clientX - thumbLeft
      : thumbWidth / 2;

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    scrollFromPointer(event.clientX);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    scrollFromPointer(event.clientX);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail || metrics.slack === 0) return;

    const step = Math.round(rail.clientWidth * 0.25);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    const behavior: ScrollBehavior = reduced ? "auto" : "smooth";

    const moves: Record<string, () => void> = {
      ArrowLeft: () => rail.scrollBy({ left: -step, behavior }),
      ArrowRight: () => rail.scrollBy({ left: step, behavior }),
      Home: () => rail.scrollTo({ left: 0, behavior }),
      End: () => rail.scrollTo({ left: metrics.slack, behavior }),
    };

    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };

  // Rien à piloter : la bande tient dans le cadre.
  if (metrics.slack === 0) return null;

  const widthPct = thumbShare(metrics.ratio) * 100;
  const leftPct = metrics.progress * (100 - widthPct);

  return (
    <div
      className="rail-bar"
      data-dragging={dragging}
      role="scrollbar"
      aria-label={label}
      aria-controls={railId}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(metrics.progress * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <div ref={trackRef} className="rail-bar-track">
        <div
          className="rail-bar-thumb"
          style={{ width: `${widthPct}%`, left: `${leftPct}%` }}
        />
      </div>
    </div>
  );
}
