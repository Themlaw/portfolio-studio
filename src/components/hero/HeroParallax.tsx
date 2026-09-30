"use client";

import { useEffect, useRef } from "react";

import Eyebrow from "@/components/Eyebrow";
import ScrollHint from "@/components/hero/ScrollHint";
import type { HeroContent } from "@/components/hero/types";

/** Amplitude de la parallaxe par rang de calque, de l'arrière vers l'avant :
 *  `depth` en px pour le curseur, `scroll` en ratio du défilement.
 *  C'est du comportement, pas de l'apparence : les images viennent du thème. */
const MOTION = [
  { depth: 4, scroll: 0.04 },
  { depth: 9, scroll: 0.09 },
  { depth: 16, scroll: 0.15 },
  { depth: 26, scroll: 0.22 },
  { depth: 40, scroll: 0.3 },
];

function motionFor(index: number) {
  return MOTION[Math.min(index, MOTION.length - 1)];
}

/** Hero « parallax-layers » : décor illustré en calques (assets.heroLayers). */
export default function HeroParallax({ layers, content }: { layers: string[]; content: HeroContent }) {
  const layerRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return;

    const pointer = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };
    let scroll = 0;
    let frame = 0;

    const onPointerMove = (event: PointerEvent) => {
      const { innerWidth, innerHeight } = window;
      pointer.x = (event.clientX / innerWidth) * 2 - 1;
      pointer.y = (event.clientY / innerHeight) * 2 - 1;
    };

    const onScroll = () => {
      scroll = window.scrollY;
    };

    const tick = () => {
      eased.x += (pointer.x - eased.x) * 0.06;
      eased.y += (pointer.y - eased.y) * 0.06;

      layerRefs.current.forEach((node, i) => {
        if (!node) return;
        const m = motionFor(i);
        const x = -eased.x * m.depth;
        const y = -eased.y * m.depth * 0.6 + scroll * m.scroll;
        node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      });

      frame = window.requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <section
      className="hero hero-parallax relative isolate flex min-h-[calc(100svh-var(--header-h))] flex-col justify-end overflow-hidden"
      aria-label={content.name}
    >
      {/* Décor illustré en couches */}
      <div className="absolute inset-0 -z-10">
        {layers.map((src, i) => (
          <div
            key={src}
            ref={(node) => {
              layerRefs.current[i] = node;
            }}
            className="absolute inset-[-8%] will-change-transform"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover"
              draggable={false}
            />
          </div>
        ))}
        {/* Voile papier : raccorde le décor au fond du site. Court et discret,
            sinon il delave les couches froides et efface les sapins. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[16%] bg-gradient-to-b from-transparent via-bg/25 to-bg/85"
        />
      </div>

      {/* hero-halo : halo typographique serré (token heroHalo) sur les petits
          textes qui traversent le décor. Le titre, en très grand corps, tient seul. */}
      <div className="shell relative pb-20 pt-40 md:pb-28">
        <Eyebrow className="text-ink">{content.eyebrow}</Eyebrow>
        <h1 className="mt-5 font-display text-[clamp(3rem,11vw,9rem)] leading-[0.92] text-ink">
          {content.name}
        </h1>
        <p className="hero-halo caption-text mt-6 max-w-xl font-caption text-[0.78rem] tracking-[0.2em] uppercase text-ink">
          {content.role}
        </p>
      </div>

      <div className="shell relative pb-10">
        <div className="hero-halo">
          <ScrollHint ink />
        </div>
      </div>
    </section>
  );
}
