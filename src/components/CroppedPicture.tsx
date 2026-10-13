"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import type { PictureSources } from "@/lib/images/variants";

import type { CropFallback } from "./Picture";
import PictureMarkup from "./PictureMarkup";

/** Attentes avant chaque nouvel essai de la variante recadrée (ms) ; au-delà, l'image entière reste. */
export const RETRY_DELAYS_MS = [4000, 10_000, 30_000, 60_000, 120_000];

/**
 * Variante recadrée, générée par le serveur à la première demande (une à la fois : sous charge la route répond
 * 503). Si elle ne s'affiche pas, la page ne montre PAS une image cassée : l'image entière (variante standard)
 * prend sa place, cadrée en CSS comme avant la v0.17 (rectangle libre : positionnée dans un cadre au rapport de la
 * zone ; ancien cadrage : `object-position` et `scale` de la page, inchangés). Une sonde invisible redemande la
 * variante recadrée après un délai croissant ; dès qu'elle arrive, elle remplace l'image entière.
 */
export default function CroppedPicture({
  sources,
  alt,
  width,
  height,
  sizes,
  className,
  priority,
  fallback,
}: {
  sources: PictureSources;
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  className?: string;
  priority?: boolean;
  fallback: CropFallback;
}) {
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const [probing, setProbing] = useState(false);
  const mainRef = useRef<HTMLImageElement>(null);

  // Échec survenu avant l'hydratation (aucun gestionnaire d'erreur posé encore) : l'image est « terminée » sans pixel.
  useEffect(() => {
    const img = mainRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  // Image entière affichée : nouvel essai de la variante recadrée après un délai croissant.
  useEffect(() => {
    if (!failed || probing || tries >= RETRY_DELAYS_MS.length) return;
    // Délai décalé au hasard : les images d'une même page ne redemandent pas toutes au même instant.
    const timer = setTimeout(() => setProbing(true), RETRY_DELAYS_MS[tries] * (0.6 + Math.random() * 0.8));
    return () => clearTimeout(timer);
  }, [failed, probing, tries]);

  const restored = useCallback(() => {
    setFailed(false);
    setProbing(false);
    setTries(0);
  }, []);
  const stillFailing = useCallback(() => {
    setProbing(false);
    setTries((n) => n + 1);
  }, []);

  if (!failed) {
    return <PictureMarkup sources={sources} alt={alt} width={width} height={height} sizes={sizes} className={className} priority={priority} cropped imgRef={mainRef} onError={() => setFailed(true)} />;
  }

  const probe = probing ? (
    <PictureMarkup key={tries} sources={sources} alt="" width={1} height={1} sizes={sizes} cropped eager hidden onLoad={restored} onError={stillFailing} style={PROBE} />
  ) : null;
  const whole = fallback.sources;
  if (!whole) return probe;
  const { rect } = fallback;
  if (!rect) {
    // Ancien cadrage (ou fenêtre centrée d'un décor) : l'image entière avec les classes de la page, qui la cadrent en CSS.
    return (
      <>
        <PictureMarkup sources={whole} alt={alt} width={fallback.width} height={fallback.height} sizes={fallback.sizes ?? sizes} className={className} priority={priority} />
        {probe}
      </>
    );
  }
  // Recadrage libre : l'image entière, agrandie et décalée dans un cadre qui a le rapport de la zone gardée.
  const ratio = (rect.w * fallback.width) / (rect.h * fallback.height);
  const frame: CSSProperties = { display: "block", position: "relative", overflow: "hidden", aspectRatio: String(ratio), height: "auto" };
  const inner: CSSProperties = {
    position: "absolute",
    maxWidth: "none",
    width: `${100 / rect.w}%`,
    height: `${100 / rect.h}%`,
    left: `${(-rect.x / rect.w) * 100}%`,
    top: `${(-rect.y / rect.h) * 100}%`,
    aspectRatio: "auto",
    objectFit: "fill",
  };
  return (
    <>
      <span className={className} style={frame} data-crop-fallback="">
        <PictureMarkup sources={whole} alt={alt} width={fallback.width} height={fallback.height} sizes={fallback.sizes ?? sizes} priority={priority} style={inner} />
      </span>
      {probe}
    </>
  );
}

const PROBE: CSSProperties = { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" };
