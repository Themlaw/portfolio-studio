"use client";

import { useEffect, useRef, type CSSProperties } from "react";

import { animStyle, DEFAULT_FPS, type AnimFps, type AnimMeta } from "@/lib/animation/sheet";

/**
 * Lot 132 — animation dessinée image par image : la bande WebP (images côte à côte) défile en CSS (`steps(N, jump-none)` sur
 * `background-position-x`, src/app/animation.css). Le HTML est celui du serveur (aucun script n'est nécessaire pour voir l'animation) ;
 * le seul script est un IntersectionObserver qui met l'animation en pause hors écran (`data-vis="0"`) et la reprend à l'écran.
 * Accessibilité : `role="img"` + texte alternatif ; « réduire les animations » : la première image, fixe (CSS).
 * Boucle (`loop` absent / true) ou un seul tour (`loop === false`, il s'arrête sur la dernière image).
 */
export default function AnimatedSheet({ src, meta, fps = DEFAULT_FPS, loop = true, alt, className }: { src: string; meta: AnimMeta; fps?: AnimFps; loop?: boolean; alt: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) el.dataset.vis = e.isIntersecting ? "1" : "0";
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <span
      ref={ref}
      role="img"
      aria-label={alt}
      className={className ? `anim-sheet ${className}` : "anim-sheet"}
      {...(loop === false ? { "data-loop": "once" } : {})}
      style={{ backgroundImage: `url("${src}")`, ...animStyle(meta, fps) } as CSSProperties}
    />
  );
}
