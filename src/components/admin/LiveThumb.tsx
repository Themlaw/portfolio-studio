"use client";

/**
 * Vignette RÉELLE de l'accueil (lot 60) : la vraie page d'accueil du site, rendue avec un thème (`<thème>`) ou une version de Mon thème
 * (`<thème>@<n>`), dans un cadre réduit. Le proxy donne l'aperçu à CETTE requête seulement (`?vignette=`, session admin vérifiée) :
 * plusieurs vignettes montrent chacune leur thème sur le même écran. Chargement différé : les vignettes hors écran (ou dans une
 * section repliée) ne sont pas demandées.
 */
import { useEffect, useRef, useState } from "react";

const WIDTH = 1280;
const HEIGHT = 800;

export default function LiveThumb({ themeRef, stamp }: { themeRef: string; /** Change quand le thème change : recharge le cadre. */ stamp?: string | number }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.375);
  // Le cadre ne se charge qu'un instant APRÈS l'écran (la page d'accueil entière, ce n'est pas rien) : l'écran Thèmes reste vif et se dit « chargé » sans attendre les vignettes.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 3500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const src = `/fr?vignette=${encodeURIComponent(themeRef)}${stamp !== undefined ? `&t=${encodeURIComponent(String(stamp))}` : ""}`;
  return (
    <div ref={box} className="a-theme-thumb a-live-thumb" data-testid="live-thumb" data-ref={themeRef} aria-hidden="true">
      {armed && <iframe src={src} title="" tabIndex={-1} loading="lazy" referrerPolicy="same-origin" style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})` }} />}
    </div>
  );
}
