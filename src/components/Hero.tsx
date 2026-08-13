"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import Eyebrow from "@/components/Eyebrow";

/** Couches du décor, de l'arrière-plan vers l'avant.
 *  `depth` : amplitude de la parallaxe (px pour le curseur, ratio pour le scroll). */
const LAYERS = [
  { src: "/hero/layer-1-sky.svg", depth: 4, scroll: 0.04, alt: true },
  { src: "/hero/layer-2-far.svg", depth: 9, scroll: 0.09 },
  { src: "/hero/layer-3-mid.svg", depth: 16, scroll: 0.15 },
  { src: "/hero/layer-4-near.svg", depth: 26, scroll: 0.22 },
  { src: "/hero/layer-5-fore.svg", depth: 40, scroll: 0.3 },
];

export default function Hero() {
  const t = useTranslations("home.hero");
  const tSite = useTranslations("site");
  const sectionRef = useRef<HTMLElement | null>(null);
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

      LAYERS.forEach((layer, i) => {
        const node = layerRefs.current[i];
        if (!node) return;
        const x = -eased.x * layer.depth;
        const y = -eased.y * layer.depth * 0.6 + scroll * layer.scroll;
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
      ref={sectionRef}
      className="relative isolate flex min-h-[calc(100svh-var(--header-h))] flex-col justify-end overflow-hidden"
      aria-label={tSite("name")}
    >
      {/* Décor illustré en couches */}
      <div className="absolute inset-0 -z-10">
        {LAYERS.map((layer, i) => (
          <div
            key={layer.src}
            ref={(node) => {
              layerRefs.current[i] = node;
            }}
            className="absolute inset-[-8%] will-change-transform"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={layer.src}
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

      <div className="shell relative pb-20 pt-40 md:pb-28">
        <Eyebrow className="text-ink">{t("eyebrow")}</Eyebrow>
        <h1 className="mt-5 font-display text-[clamp(3rem,11vw,9rem)] leading-[0.92] text-ink">
          {tSite("name")}
        </h1>
        <p className="mt-6 max-w-xl font-caption text-[0.78rem] tracking-[0.2em] uppercase text-ink">
          {tSite("role")}
        </p>
      </div>

      <div className="shell relative pb-10">
        <div className="flex items-center gap-3 text-ink-soft">
          <span className="eyebrow">{t("scroll")}</span>
          <span aria-hidden="true" className="scroll-hint inline-block">
            <svg width="14" height="22" viewBox="0 0 14 22" fill="none">
              <path
                d="M7 1v19m0 0 5-5m-5 5-5-5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </div>
    </section>
  );
}
