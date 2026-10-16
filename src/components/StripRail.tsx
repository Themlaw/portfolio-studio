"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";

import Lightbox from "@/components/Lightbox";
import RailScrollbar from "@/components/RailScrollbar";
import { stepRail } from "@/components/rail-step";
import type { LocalizedArtwork } from "@/lib/gallery";
import { frameAttrs, type Frame } from "@/lib/look";
import { RADIUS_VALUES } from "@/themes/css";

import LoopFrame from "./LoopVideo";
import Picture from "./Picture";
import VideoViewer from "./VideoViewer";

/**
 * Largeur affichée d'une image de bande : hauteur du rail
 * (--strip-h = clamp(260px, 34vw, 420px)) × ratio de l'image.
 */
function stripSizes(width: number, height: number): string {
  const ratio = width / Math.max(1, height);
  const px = (h: number) => `${Math.ceil(h * ratio)}px`;
  return `(min-width: 1236px) ${px(420)}, (min-width: 765px) calc(34vw * ${ratio.toFixed(3)}), ${px(260)}`;
}


/**
 * La bande d'images qui défile (bande, flèches, barre de défilement, visionneuse) : celle des images d'un
 * PROJET (`ProjectStrip`, avec ses repères d'emplacement en vue brouillon) ou un carrousel à liste propre
 * de la planche (lot 31b, images de la médiathèque, sans légende). Un seul code pour les deux : même rendu.
 */
export default function StripRail({
  artworks,
  title,
  idKey,
  edit = false,
  projectRail = false,
  captions = true,
  slotRadius,
  slotFrame,
  videoMode,
}: {
  artworks: LocalizedArtwork[];
  /** Nom lu par les lecteurs d'écran (projet de la planche). */
  title: string;
  /** Identifiant propre à la bande (identifiant HTML de la bande). */
  idKey: string;
  /** Vue brouillon de l'éditeur. */
  edit?: boolean;
  /** Bande des images du projet : porte les repères de glissement de la toile (`data-edit-rail`). */
  projectRail?: boolean;
  /** Titre et année sous chaque image (images du projet) ; un carrousel à liste propre n'en a pas. */
  captions?: boolean;
  slotRadius?: Partial<Record<string, keyof typeof RADIUS_VALUES>>;
  /** Cadre par image (réglage `look.slotFrame` du bloc, par slug d'emplacement ; lot 34). */
  slotFrame?: Partial<Record<string, Frame>>;
  /**
   * Lecture des vidéos de la bande (lot 36) : « loop » = Boucle (muette, un clic met en pause), « player » = Lecteur
   * (un clic ouvre la vidéo en grand). Absent : chaque vidéo suit sa nature (une animation courte et muette en boucle,
   * une vidéo longue en lecteur), comme avant.
   */
  videoMode?: "loop" | "player";
}) {
  const t = useTranslations("projects");
  const tg = useTranslations("gallery");
  /** Variable d'arrondi d'une image réglée seule (sinon celle du bloc / du thème). */
  const radiusOf = (slug: string): CSSProperties | undefined => {
    const r = slotRadius && Object.hasOwn(slotRadius, slug) ? slotRadius[slug] : undefined;
    return r && Object.hasOwn(RADIUS_VALUES, r) ? ({ "--media-radius": RADIUS_VALUES[r] } as CSSProperties) : undefined;
  };
  /** Cadre d'une photo réglée seule (lot 34) : attribut + couleur sur l'image de la planche, jamais sur une vidéo en boucle. */
  const frameOf = (slug: string) => {
    const f = slotFrame && Object.hasOwn(slotFrame, slug) ? frameAttrs(slotFrame[slug]) : null;
    return f ? { "data-frame": f["data-frame"], style: f.style as CSSProperties } : null;
  };
  // Les places vides n'existent que sur la toile : ni compteur, ni visionneuse.
  const shownArtworks = edit ? artworks.filter((a) => !a.edit?.empty) : artworks;
  // Les vidéos ne passent pas par la visionneuse d'images : une boucle se met en pause sur place, un lecteur s'ouvre dans la visionneuse vidéo.
  const stills = shownArtworks.filter((a) => !a.video);
  const [viewing, setViewing] = useState<LocalizedArtwork | null>(null);
  const modeOf = (a: LocalizedArtwork): "loop" | "player" | null => (a.video ? (videoMode ?? (a.video.loop ? "loop" : "player")) : null);
  const railId = `rail-${idKey}`;
  const railRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lastFocused = useRef<number | null>(null);

  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [overflows, setOverflows] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const prevRef = useRef<HTMLButtonElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  // `disabled` des flèches n'est JAMAIS une prop JSX : React lit la prop (pas le DOM)
  // pour ignorer les clics d'un bouton désactivé, donc un `disabled` figé dans le JSX
  // rendait la flèche gauche morte même une fois réactivée par `paint`. L'état de
  // butée vit dans le DOM seul ; à l'insertion, on l'initialise depuis `data-at-*`.
  const prevNode = useCallback((node: HTMLButtonElement | null) => {
    prevRef.current = node;
    if (node) node.disabled = viewportRef.current?.dataset.atStart !== "false";
  }, []);
  const nextNode = useCallback((node: HTMLButtonElement | null) => {
    nextRef.current = node;
    if (node) node.disabled = viewportRef.current?.dataset.atEnd === "true";
  }, []);

  // Butées (début, fin) : écrites directement sur le DOM, une fois par image
  // au plus (requestAnimationFrame) — aucun rendu React pendant le défilement.
  // Elles pilotent le fondu des bords et l'état des flèches.
  useEffect(() => {
    const rail = railRef.current;
    const viewport = viewportRef.current;
    if (!rail || !viewport) return;

    let frame = 0;
    const paint = () => {
      frame = 0;
      const slack = rail.scrollWidth - rail.clientWidth;
      const over = slack > 8;
      const atStart = rail.scrollLeft <= 8;
      const atEnd = rail.scrollLeft >= slack - 8;
      // Écrire seulement ce qui change : un attribut réécrit à l'identique
      // invalide quand même le style (et le masque du fondu) à chaque image.
      const set = (key: "overflows" | "atStart" | "atEnd", value: boolean) => {
        if (viewport.dataset[key] !== String(value)) viewport.dataset[key] = String(value);
      };
      set("overflows", over);
      set("atStart", atStart);
      set("atEnd", atEnd);
      // Fondu de chaque bord : seulement sur une image réellement coupée par ce bord,
      // et jamais plus large que sa partie visible. Une image entièrement visible
      // (ou un bord sans rien à faire défiler) ne s'estompe pas.
      let cutL = 0;
      let cutR = 0;
      const view = rail.clientWidth;
      const visit = (parent: Element) => {
        for (const child of parent.children) {
          const el = child as HTMLElement;
          if (!el.offsetWidth) {
            visit(el); // enveloppe « display: contents » (vidéo en boucle, toile) : ses enfants comptent
            continue;
          }
          const x = el.offsetLeft - rail.scrollLeft;
          // Offsets arrondis à l'entier : le demi-pixel de marge évite de manquer une coupe d'un pixel.
          if (x < -0.5 && x + el.offsetWidth > 0.5) cutL = Math.max(cutL, Math.round(x + el.offsetWidth));
          if (x < view - 0.5 && x + el.offsetWidth > view + 0.5) cutR = Math.max(cutR, Math.round(view - x));
        }
      };
      visit(rail);
      // Largeur du fondu = partie visible de l'image coupée, plafonnée à --strip-fade ; « 0px » sans coupe.
      const fade = (name: string, px: number) => {
        const value = px > 0 ? `min(var(--strip-fade), ${px}px)` : "0px";
        if (rail.style.getPropertyValue(name) !== value) rail.style.setProperty(name, value);
      };
      fade("--strip-fade-l", over ? cutL : 0);
      fade("--strip-fade-r", over ? cutR : 0);
      setOverflows(over);
      const prev = prevRef.current;
      const next = nextRef.current;
      // Flèche en butée : désactivée ; si elle avait le focus, il passe à l'autre.
      if (prev && prev.disabled !== atStart) {
        if (atStart && document.activeElement === prev) next?.focus();
        prev.disabled = atStart;
      }
      if (next && next.disabled !== atEnd) {
        if (atEnd && document.activeElement === next) prev?.focus();
        next.disabled = atEnd;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    paint();
    rail.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(rail);
    for (const child of rail.children) observer.observe(child);

    return () => {
      rail.removeEventListener("scroll", schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [artworks.length, overflows]);

  const step = useCallback((direction: 1 | -1) => {
    const rail = railRef.current;
    if (rail) stepRail(rail, direction);
  }, []);

  // Rendre le focus à la vignette d'origine à la fermeture de la lightbox.
  useEffect(() => {
    if (openIndex !== null) {
      lastFocused.current = openIndex;
      return;
    }
    if (lastFocused.current !== null) {
      triggerRefs.current[lastFocused.current]?.focus();
      lastFocused.current = null;
    }
  }, [openIndex]);

  return (
    <>
      <div ref={viewportRef} className="strip-viewport" data-overflows="false" data-at-start="true" data-at-end="false">
      <div
        ref={railRef}
        id={railId}
        className="strip-rail"
        role="group"
        aria-label={title}
        {...(edit && projectRail ? { "data-edit-rail": "" } : {})}
      >
        {artworks.map((artwork) => {
          const index = stills.indexOf(artwork);
          const slot = artwork.edit;
          const caption = !captions ? null : (
            <span className="strip-caption-row flex items-baseline justify-between gap-4">
              <span
                className="strip-caption transition-colors group-hover:text-ink"
                {...(slot ? { "data-slot-inline": "title", "data-placeholder": "Titre" } : {})}
              >
                {artwork.title}
              </span>
              <span className="strip-caption shrink-0">
                {artwork.year}
              </span>
            </span>
          );
          // Légende : visible sur la toile seulement (la visionneuse l'affiche en ligne).
          const legend = slot ? (
            <span className="pe-slot-legend strip-caption" data-slot-inline="description" data-placeholder="Légende">
              {artwork.description}
            </span>
          ) : null;
          if (slot?.empty) {
            return (
              <div
                key={artwork.id}
                className="strip-frame pe-empty-slot"
                style={radiusOf(artwork.slug)}
                data-edit-slot={slot.key}
                data-slot-slug={artwork.slug}
                data-slot-pos={slot.pos}
                data-empty=""
                tabIndex={0}
                role="group"
                aria-label={slot.pending ? "Image en cours de conversion" : "Place gardée, sans image"}
              >
                <span className="strip-media">
                  <span className="pe-empty-box rounded-strip" style={{ width: `calc(var(--strip-h) * ${slot.aspect.toFixed(4)})` }}>
                    {slot.pending ? "Conversion…" : "Dépose une image ici"}
                  </span>
                </span>
                {caption}
                {legend}
              </div>
            );
          }
          const openLabel = `${artwork.title || artwork.alt || artwork.year} — ${tg("open")}`;
          if (artwork.video && modeOf(artwork) === "loop") {
            const loop = (
              <LoopFrame
                key={artwork.id}
                video={artwork.video}
                width={artwork.width}
                height={artwork.height}
                mediaClassName="h-[var(--strip-h)] w-auto max-w-none rounded-strip"
                label={artwork.alt || artwork.title}
                caption={caption}
                texts={{ pause: tg("pauseLoop"), play: tg("playLoop") }}
              />
            );
            return slot || radiusOf(artwork.slug) ? (
              <div
                key={artwork.id}
                style={{ display: "contents", ...radiusOf(artwork.slug) }}
                {...(slot ? { "data-edit-slot": slot.key, "data-slot-pos": slot.pos, "data-slot-slug": artwork.slug } : {})}
              >
                {loop}
                {legend}
              </div>
            ) : (
              loop
            );
          }
          return (
          <button
            key={artwork.id}
            type="button"
            ref={(node) => {
              if (index >= 0) triggerRefs.current[index] = node;
            }}
            onClick={() => {
              // Sur la toile la vidéo ne s'ouvre pas en grand : le clic sert à choisir la place.
              if (!artwork.video) setOpenIndex(index);
              else if (!edit) setViewing(artwork);
            }}
            aria-label={openLabel}
            aria-haspopup={artwork.video ? "dialog" : undefined}
            data-video-mode={artwork.video ? "player" : undefined}
            className="strip-frame group text-left"
            style={{ ...radiusOf(artwork.slug), ...(artwork.video ? {} : frameOf(artwork.slug)?.style) }}
            {...(!artwork.video && frameOf(artwork.slug) ? { "data-frame": frameOf(artwork.slug)!["data-frame"] } : {})}
            {...(slot ? { "data-edit-slot": slot.key, "data-slot-pos": slot.pos, "data-slot-slug": artwork.slug } : {})}
          >
            <span className="strip-media">
              {artwork.video ? (
                <span className="relative block">
                  <Picture
                    src={artwork.image}
                    sources={artwork.sources}
                    alt={artwork.alt}
                    width={artwork.width}
                    height={artwork.height}
                    sizes={stripSizes(artwork.width, artwork.height)}
                    className="h-[var(--strip-h)] w-auto max-w-none rounded-strip"
                  />
                  <span className="strip-duration absolute bottom-2 right-2 rounded-sm bg-scrim/75 px-2 py-0.5 text-xs text-on-scrim">
                    <span aria-hidden="true">▶ </span>
                    {artwork.video.durationLabel}
                    <span className="sr-only"> — {tg("playVideo")}</span>
                  </span>
                </span>
              ) : (
                // Image : la même balise qu'avant (parité visuelle).
                <Picture
                  src={artwork.image}
                  sources={artwork.sources}
                  alt={artwork.alt}
                  width={artwork.width}
                  height={artwork.height}
                  sizes={artwork.sources ? stripSizes(artwork.width, artwork.height) : "(min-width: 1024px) 640px, 60vw"}
                  className="h-[var(--strip-h)] w-auto max-w-none rounded-strip"
                />
              )}
            </span>
            {caption}
            {legend}
          </button>
          );
        })}
      </div>

      {/* Flèches posées sur les bords de la bande, centrées sur les images :
          discrètes (survol de la bande, focus clavier), masquées sur écran
          tactile (le doigt fait défiler), désactivées en butée. */}
      {overflows && (
        <>
          <button
            ref={prevNode}
            type="button"
            onClick={() => step(-1)}
            aria-label={t("scrollPrev", { project: title })}
            aria-controls={railId}
            className="strip-nav strip-nav-prev"
          >
            <span aria-hidden="true" data-icon="arrow-left">←</span>
          </button>
          <button
            ref={nextNode}
            type="button"
            onClick={() => step(1)}
            aria-label={t("scrollNext", { project: title })}
            aria-controls={railId}
            className="strip-nav strip-nav-next"
          >
            <span aria-hidden="true" data-icon="arrow-right">→</span>
          </button>
        </>
      )}
      </div>

      {overflows && (
        <div className="shell mt-[clamp(0.75rem,1.5vw,1.25rem)]">
          <RailScrollbar
            railRef={railRef}
            railId={railId}
            label={t("scrollbar", { project: title })}
          />
        </div>
      )}
    <Lightbox items={stills} index={openIndex} onIndexChange={setOpenIndex} onClose={() => setOpenIndex(null)} />
    {viewing?.video && <VideoViewer video={viewing.video} width={viewing.width} height={viewing.height} title={viewing.title || viewing.alt} onClose={() => setViewing(null)} />}
    </>
  );
}
