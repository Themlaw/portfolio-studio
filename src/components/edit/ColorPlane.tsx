"use client";

/**
 * Carré saturation × luminosité et bande de teinte du sélecteur de couleur (lot 29), à la manière du panneau
 * « Couleur » de Photoshop : carré (saturation de gauche à droite, luminosité de bas en haut, rond comme curseur)
 * et bande verticale de teinte (rouge en haut, magenta, bleu, cyan, vert, jaune, rouge en bas) avec une flèche.
 *
 * Fait maison (pointer events + capture du pointeur : un glisser sorti du cadre continue, `touch-action: none` :
 * la page ne défile pas sous le doigt). Les dégradés sont calculés par src/lib/color.ts (aucune couleur écrite
 * à la main) et posés en styles en ligne : aucune feuille injectée, la toile reste sous CSP.
 * Clavier : flèches (Maj = pas de 10) ; rôles slider avec une valeur lisible (`aria-valuetext`).
 */
import { useRef } from "react";

import { hueStripGradient, planeToSv, saturationPlane, stripToHue } from "@/lib/color";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Lot 110 : un texte est en cours de saisie (contenteditable avec le focus) et la barre « Aa » ouvre cette roue. Lui prendre le focus
 * (carré, bande, ouverture) terminait la saisie et refermait la barre avec la roue : on le lui laisse. La souris et le doigt
 * n'ont pas besoin du focus pour glisser (capture du pointeur) ; seul le clavier du carré attend un clic hors de la saisie.
 */
export function textHoldsFocus(doc: Document): boolean {
  const a = doc.activeElement;
  return a instanceof HTMLElement && a !== doc.body && (a.isContentEditable || a.hasAttribute("data-editing"));
}

/** Glisser dans un élément : rappel en fractions (0-1) depuis le coin haut gauche, bornées. */
function useDrag(onPoint: (fx: number, fy: number) => void) {
  const dragging = useRef(false);
  const at = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onPoint(r.width ? clamp((e.clientX - r.left) / r.width, 0, 1) : 0, r.height ? clamp((e.clientY - r.top) / r.height, 0, 1) : 0);
  };
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault(); // pas de sélection de texte ni de focus à la souris : on le donne nous-mêmes
      if (!textHoldsFocus(e.currentTarget.ownerDocument)) e.currentTarget.focus({ preventScroll: true });
      e.currentTarget.setPointerCapture(e.pointerId);
      dragging.current = true;
      at(e);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (dragging.current) at(e);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      dragging.current = false;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onPointerCancel: () => {
      dragging.current = false;
    },
  };
}

const pct = (n: number) => Math.round(n * 100);

export function SaturationPlane({ h, s, v, onChange }: { h: number; s: number; v: number; onChange: (s: number, v: number) => void }) {
  const drag = useDrag((fx, fy) => {
    const p = planeToSv(fx, fy);
    onChange(p.s, p.v);
  });
  return (
    <div
      className="cp-sv"
      tabIndex={0}
      role="slider"
      aria-label="Saturation et luminosité : flèches gauche et droite pour la saturation, haut et bas pour la luminosité, Maj pour aller plus vite"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct(s)}
      aria-valuetext={`Saturation ${pct(s)} %, luminosité ${pct(v)} %`}
      style={saturationPlane(h)}
      {...drag}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.01;
        const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
        const k = d[e.key];
        if (!k) return;
        e.preventDefault();
        onChange(clamp(Math.round((s + k[0]) * 100) / 100, 0, 1), clamp(Math.round((v + k[1]) * 100) / 100, 0, 1));
      }}
    >
      <span className="cp-sv-dot" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
    </div>
  );
}

export function HueStrip({ h, onChange }: { h: number; onChange: (h: number) => void }) {
  const drag = useDrag((_fx, fy) => onChange(stripToHue(fy)));
  return (
    <div
      className="cp-hue"
      tabIndex={0}
      role="slider"
      aria-orientation="vertical"
      aria-label="Teinte : flèches haut et bas, Maj pour aller plus vite"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(h)}
      aria-valuetext={`Teinte ${Math.round(h)}°`}
      style={{ backgroundImage: hueStripGradient() }}
      {...drag}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1;
        const d: Record<string, number> = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step };
        if (!(e.key in d)) return;
        e.preventDefault();
        onChange(clamp(Math.round(h) + d[e.key], 0, 360));
      }}
    >
      <span className="cp-hue-arrow" style={{ top: `${(1 - h / 360) * 100}%` }} />
    </div>
  );
}
