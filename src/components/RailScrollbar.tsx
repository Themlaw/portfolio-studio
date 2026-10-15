"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { clearRailTarget, scrollRailTo, stepRail } from "./rail-step";

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

/** Planificateur de rendu du curseur, par rail (le glisser le réveille). */
const schedulers = new WeakMap<HTMLElement, () => void>();

/** Pixels par cran de molette en mode « lignes » (Firefox). */
const LINE_PX = 40;

/**
 * Barre de glissement d'une planche de projet.
 *
 * Elle sert de rattrapage : on voit d'un coup d'œil où on en est dans le
 * projet et on peut y aller directement, sans dépendre des flèches.
 * Elle disparaît dès que la bande tient entièrement dans le cadre — une
 * barre qui ne peut pas bouger n'a rien à dire.
 *
 * Fluidité (lot médias) : aucun état React pendant le défilement. Le curseur
 * est déplacé par `transform` (composité, sans mise en page) dans un
 * requestAnimationFrame, une fois par image au plus ; le glisser et la
 * molette sont regroupés par image eux aussi. Pendant un glisser ou une
 * molette, l'accrochage de la bande est suspendu (`data-dragging` sur le
 * rail) : sinon le navigateur ré-accroche après chaque `scrollLeft` posé et
 * la bande recule par à-coups.
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
  const barRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  /** Mesures courantes (jamais dans l'état React : elles changent à chaque image). */
  const m = useRef({ slack: 0, trackW: 0, thumbW: 0 });
  const frame = useRef(0);
  const drag = useRef<{ grab: number; x: number | null } | null>(null);
  const wheelEnd = useRef<number | undefined>(undefined);
  const [active, setActive] = useState(false);

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const paint = () => {
      frame.current = 0;
      const bar = barRef.current;
      const thumb = thumbRef.current;
      const { slack, trackW, thumbW } = m.current;
      // Glisser en cours : on applique la dernière position du pointeur (une fois par image).
      const d = drag.current;
      if (d && d.x !== null && trackRef.current && slack > 0) {
        const rect = trackRef.current.getBoundingClientRect();
        const travel = rect.width - thumbW;
        if (travel > 0) rail.scrollLeft = (clamp(d.x - rect.left - d.grab, 0, travel) / travel) * slack;
        d.x = null;
      }
      if (!bar || !thumb) return;
      const progress = slack > 0 ? clamp(rail.scrollLeft / slack, 0, 1) : 0;
      thumb.style.transform = `translate3d(${(progress * (trackW - thumbW)).toFixed(2)}px, -50%, 0)`;
      const now = String(Math.round(progress * 100));
      if (bar.getAttribute("aria-valuenow") !== now) bar.setAttribute("aria-valuenow", now);
    };
    const schedule = () => {
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };

    const measure = () => {
      const slack = rail.scrollWidth - rail.clientWidth;
      const ratio = rail.scrollWidth > 0 ? rail.clientWidth / rail.scrollWidth : 1;
      const trackW = trackRef.current?.clientWidth ?? 0;
      const thumbW = trackW * thumbShare(ratio);
      m.current = { slack: slack > 8 ? slack : 0, trackW, thumbW };
      if (thumbRef.current) thumbRef.current.style.width = `${thumbW.toFixed(2)}px`;
      setActive(slack > 8);
      schedule();
    };

    measure();
    rail.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    if (trackRef.current) observer.observe(trackRef.current);
    // Le contenu du rail change de largeur (images chargées) sans que le rail change de taille.
    for (const child of rail.children) observer.observe(child);
    schedulers.set(rail, schedule);

    return () => {
      rail.removeEventListener("scroll", schedule);
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      schedulers.delete(rail);
    };
  }, [railRef, active]);

  /** Molette au-dessus de la barre : défilement horizontal (écouteur non passif, pour retenir la page). */
  useEffect(() => {
    const bar = barRef.current;
    const rail = railRef.current;
    if (!bar || !rail) return;
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta || m.current.slack === 0) return;
      event.preventDefault();
      clearRailTarget(rail);
      rail.setAttribute("data-dragging", "");
      rail.scrollLeft += event.deltaMode === 1 ? delta * LINE_PX : event.deltaMode === 2 ? delta * rail.clientWidth : delta;
      window.clearTimeout(wheelEnd.current);
      wheelEnd.current = window.setTimeout(() => rail.removeAttribute("data-dragging"), 160);
    };
    bar.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      bar.removeEventListener("wheel", onWheel);
      window.clearTimeout(wheelEnd.current);
    };
  }, [railRef, active]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    const rail = railRef.current;
    const { slack, thumbW } = m.current;
    if (!track || !rail || slack === 0 || event.button !== 0) return;

    const rect = track.getBoundingClientRect();
    const thumbLeft = rect.left + clamp(rail.scrollLeft / slack, 0, 1) * (rect.width - thumbW);
    const onThumb = event.clientX >= thumbLeft && event.clientX <= thumbLeft + thumbW;

    // Sur le curseur on garde le point de saisie ; sur la piste on centre.
    drag.current = { grab: onThumb ? event.clientX - thumbLeft : thumbW / 2, x: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.setAttribute("data-dragging", "true");
    clearRailTarget(rail);
    rail.setAttribute("data-dragging", "");
    schedulers.get(rail)?.();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!drag.current || !rail) return;
    drag.current.x = event.clientX;
    schedulers.get(rail)?.();
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.setAttribute("data-dragging", "false");
    railRef.current?.removeAttribute("data-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail || m.current.slack === 0) return;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => stepRail(rail, -1),
      ArrowRight: () => stepRail(rail, 1),
      PageUp: () => scrollRailTo(rail, Math.max(0, rail.scrollLeft - rail.clientWidth * 0.8)),
      PageDown: () => scrollRailTo(rail, Math.min(m.current.slack, rail.scrollLeft + rail.clientWidth * 0.8)),
      Home: () => scrollRailTo(rail, 0),
      End: () => scrollRailTo(rail, m.current.slack),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };

  return (
    <div
      ref={barRef}
      className="rail-bar"
      data-edit-native=""
      data-dragging="false"
      role="scrollbar"
      aria-label={label}
      aria-controls={railId}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      tabIndex={active ? 0 : -1}
      hidden={!active}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
    >
      <div ref={trackRef} className="rail-bar-track">
        <div ref={thumbRef} className="rail-bar-thumb" />
      </div>
    </div>
  );
}

