"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";

import dynamic from "next/dynamic";
import RailScrollbar from "@/components/RailScrollbar";
import { stepRail } from "@/components/rail-step";
import type { LocalizedArtwork } from "@/lib/gallery";
import type { MediaLookData } from "@/lib/look";
import { RADIUS_VALUES } from "@/themes/css";

import LoopFrame from "./LoopVideo";
import MediaCaption, { type CaptionField } from "./MediaCaption";
import MediaFrame from "./MediaFrame";
import Picture from "./Picture";

/* Visionneuses chargées à la première ouverture (lot 54). */
const Lightbox = dynamic(() => import("@/components/Lightbox"), { ssr: false });
const VideoViewer = dynamic(() => import("./VideoViewer"), { ssr: false });

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
 * PROJET (`ProjectStrip`, avec légendes) ou un carrousel à liste propre de la planche (lot 31b, images de la
 * médiathèque, sans légende). Un seul code pour les deux, aussi en vue brouillon : mêmes repères d'emplacement
 * (`data-edit-slot`), donc mêmes outils par image sur la toile (lot 31f).
 */
export default function StripRail({
  artworks,
  title,
  idKey,
  edit = false,
  editRail,
  captions = true,
  slotLook,
  videoMode,
  eager = 0,
}: {
  /** Nombre des premières images chargées tout de suite, sans « lazy » (lot 54). */
  eager?: number;
  artworks: LocalizedArtwork[];
  /** Nom lu par les lecteurs d'écran (projet de la planche). */
  title: string;
  /** Identifiant propre à la bande (identifiant HTML de la bande). */
  idKey: string;
  /** Vue brouillon de l'éditeur. */
  edit?: boolean;
  /** Repère de la bande sur la toile (`data-edit-rail`) : vide pour les images du projet, l'identifiant du composant pour un carrousel à liste propre. */
  editRail?: string;
  /** Titre et année sous chaque image (images du projet) ; un carrousel à liste propre n'en a pas. */
  captions?: boolean;
  /** Habillage par image (réglage `look.slotLook` du bloc, par slug d'emplacement ; lots 34, 38, 41, 45 et 75) : cadre, fond, arrondi, panorama, lecture. */
  slotLook?: Partial<Record<string, MediaLookData>>;
  /**
   * Lecture des vidéos de la bande (lot 36) : « loop » = Boucle (muette, un clic met en pause), « player » = Lecteur
   * (un clic ouvre la vidéo en grand). Absent : chaque vidéo suit sa nature (une animation courte et muette en boucle,
   * une vidéo longue en lecteur), comme avant.
   */
  videoMode?: "loop" | "player";
}) {
  const t = useTranslations("projects");
  const tg = useTranslations("gallery");
  /** Habillage enregistré de la place `slug` (vide sans réglage). */
  const mineOf = (slug: string): MediaLookData => (slotLook && Object.hasOwn(slotLook, slug) ? slotLook[slug] : undefined) ?? {};
  /** Variable d'arrondi d'une image réglée seule (sinon celle du bloc / du thème). */
  const radiusOf = (slug: string): CSSProperties | undefined => {
    const r = mineOf(slug).radius;
    return r && Object.hasOwn(RADIUS_VALUES, r) ? ({ "--media-radius": RADIUS_VALUES[r] } as CSSProperties) : undefined;
  };
  /** Habillage d'une photo ou d'une vidéo réglée seule (lots 34, 41, 62 et 64) : cadre et fond de SA place, via le composant commun (MediaFrame). Le fond n'existe que pour une photo. */
  const lookOf = (slug: string, video: boolean) => ({
    frame: mineOf(slug).frame,
    bg: !video ? mineOf(slug).bg : undefined,
  });
  /** Image entière dans la largeur visible (défaut) ou à faire défiler (lot 45) : `--ir` = ratio, repris par `--fit-h` (globals.css). */
  const panoOf = (a: LocalizedArtwork) => {
    const mode = mineOf(a.slug).pano;
    return { "data-pano": mode === "scroll" ? "scroll" : "fit", style: { "--ir": (a.width / Math.max(1, a.height)).toFixed(4) } as CSSProperties };
  };
  // Les places vides n'existent que sur la toile : ni compteur, ni visionneuse.
  const shownArtworks = edit ? artworks.filter((a) => !a.edit?.empty) : artworks;
  // Les vidéos ne passent pas par la visionneuse d'images : une boucle se met en pause sur place, un lecteur s'ouvre dans la visionneuse vidéo.
  const stills = shownArtworks.filter((a) => !a.video);
  const [viewing, setViewing] = useState<LocalizedArtwork | null>(null);
  // Ordre : le choix de CETTE vidéo (lot 38), puis le réglage ancien de la bande (`videoMode`, plus proposé mais toujours lu : aucune page existante ne change), puis la nature de la vidéo.
  const modeOf = (a: LocalizedArtwork): "loop" | "player" | null => {
    if (!a.video) return null;
    const own = mineOf(a.slug).video;
    return own ?? videoMode ?? (a.video.loop ? "loop" : "player");
  };
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
    let scrolling = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    /**
     * Hauteur de la bande suivant ce qui se voit (lot 67, PUB-03) : sans cela, la case la plus haute de TOUTE la bande
     * (une image très haute, une légende longue) laisse un grand vide sous un panorama. On retient les cases vues sur au
     * moins 24 px : `--strip-band` (hauteur des images, pour centrer un panorama réduit et les flèches) et `--strip-rail-h`
     * (hauteur de la bande) ne sont posées que si le gain dépasse 24 px ; sinon la bande garde sa hauteur naturelle.
     */
    const fitHeight = (over: boolean, settled: boolean) => {
      const items: HTMLElement[] = [];
      const collect = (parent: Element) => {
        for (const child of parent.children) {
          const el = child as HTMLElement;
          if (!el.offsetWidth) collect(el);
          else items.push(el);
        }
      };
      collect(rail);
      const view = rail.clientWidth;
      const seen = items.filter((el) => {
        const x = el.offsetLeft - rail.scrollLeft;
        return Math.min(x + el.offsetWidth, view) - Math.max(x, 0) >= 24;
      });
      const setVar = (target: HTMLElement, name: string, value: string | null) => {
        if (value === null) {
          if (target.style.getPropertyValue(name)) target.style.removeProperty(name);
        } else if (target.style.getPropertyValue(name) !== value) target.style.setProperty(name, value);
      };
      if (!over || seen.length === 0) {
        setVar(viewport, "--strip-band", null);
        setVar(rail, "--strip-rail-h", null);
        return;
      }
      const media = (el: HTMLElement) => el.querySelector<HTMLElement>(".strip-media")?.offsetHeight ?? el.offsetHeight;
      const full = Math.max(...items.map(media));
      // Lot 77 : pendant le défilement la hauteur ne fait que MONTER (jamais de va-et-vient de ce qui est dessous) ;
      // elle se resserre sur les cases vues une fois le défilement posé, en douceur (transition de la bande).
      const held = (target: HTMLElement, name: string): number => (settled ? 0 : parseFloat(target.style.getPropertyValue(name)) || 0);
      const band = Math.max(...seen.map(media), held(viewport, "--strip-band"));
      setVar(viewport, "--strip-band", full - band > 24 ? `${band}px` : null);
      // La marge haute d'un panorama réduit dépend de --strip-band : on mesure APRÈS l'avoir posée.
      const pad = parseFloat(getComputedStyle(rail).paddingBottom) || 0;
      const bottom = (list: HTMLElement[]) => Math.max(...list.map((el) => el.offsetTop + el.offsetHeight)) + pad;
      const need = Math.max(bottom(seen), held(rail, "--strip-rail-h"));
      const natural = bottom(items);
      // Toujours une hauteur en px quand la bande défile (lot 77) : `auto` ne s'anime pas, la hauteur naturelle sauterait.
      setVar(rail, "--strip-rail-h", `${Math.ceil(natural - need > 24 ? need : natural)}px`);
    };
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
      fitHeight(over, !scrolling);
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

    const onScroll = () => {
      scrolling = true;
      clearTimeout(idle);
      idle = setTimeout(() => {
        scrolling = false;
        schedule();
      }, 160);
      schedule();
    };
    paint();
    rail.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(rail);
    for (const child of rail.children) observer.observe(child);

    return () => {
      rail.removeEventListener("scroll", onScroll);
      clearTimeout(idle);
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
        {...(edit && editRail !== undefined ? { "data-edit-rail": editRail } : {})}
      >
        {artworks.map((artwork) => {
          const index = stills.indexOf(artwork);
          const slot = artwork.edit;
          // Titre, Légende, Date (lot 39) : le composant commun. Bande du projet : Titre et Légende sont ceux de l'emplacement (partagés,
          // `data-slot-inline`), la Date est propre à la bande ; carrousel à liste propre : les trois sont propres à la place.
          // Sans date posée, la bande du projet montre l'année de l'emplacement, comme avant.
          const marks = (field: CaptionField): Record<string, string> | undefined => {
            if (!slot) return undefined;
            const path = (f: string) => `captions.${artwork.slug}.${f}`;
            if (editRail === "") return field === "title" ? { "data-slot-inline": "title" } : field === "legend" ? { "data-slot-inline": "description" } : { "data-inline": path("date") };
            return { "data-inline": path(field === "legend" ? "caption" : field) };
          };
          const caption = !captions ? null : (
            <MediaCaption
              edit={Boolean(slot)}
              title={{ text: artwork.title, attrs: marks("title"), className: "transition-colors group-hover:text-ink" }}
              legend={{ text: artwork.description, attrs: marks("legend") }}
              date={{ text: artwork.date ?? (artwork.year > 0 ? String(artwork.year) : ""), attrs: marks("date") }}
            />
          );
          const host = slot ? { "data-cap-host": "" } : {};
          if (slot?.empty) {
            return (
              <div
                key={artwork.id}
                className="strip-frame pe-empty-slot"
                style={radiusOf(artwork.slug)}
                data-edit-slot={slot.key}
                data-slot-slug={artwork.slug}
                data-slot-pos={slot.pos}
                {...host}
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
              </div>
            );
          }
          // Description (sinon titre), jamais la date : c'est ce qu'annonce le bouton (lot 52).
          const openLabel = [artwork.alt || artwork.title, tg("open")].filter(Boolean).join(" — ");
          if (artwork.video && modeOf(artwork) === "loop") {
            const loop = (
              <LoopFrame
                key={artwork.id}
                video={artwork.video}
                width={artwork.width}
                height={artwork.height}
                label={artwork.alt || artwork.title}
                caption={caption}
                mediaLook={lookOf(artwork.slug, true)}
                texts={{ pause: tg("pauseLoop"), play: tg("playLoop") }}
              />
            );
            return slot || radiusOf(artwork.slug) ? (
              <div
                key={artwork.id}
                style={{ display: "contents", ...radiusOf(artwork.slug) }}
                {...(slot ? { "data-edit-slot": slot.key, "data-slot-pos": slot.pos, "data-slot-slug": artwork.slug } : {})}
                {...host}
              >
                {loop}
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
            style={{ ...radiusOf(artwork.slug), ...(artwork.video ? {} : panoOf(artwork).style) }}
            {...(!artwork.video ? { "data-pano": panoOf(artwork)["data-pano"] } : {})}
            {...(slot ? { "data-edit-slot": slot.key, "data-slot-pos": slot.pos, "data-slot-slug": artwork.slug } : {})}
            {...host}
          >
            <span className="strip-media">
              <MediaFrame look={lookOf(artwork.slug, Boolean(artwork.video))} ratio={artwork.width / Math.max(1, artwork.height)} kind={artwork.video ? "video" : "image"}>
                {artwork.video ? (
                  <>
                    <Picture src={artwork.image} sources={artwork.sources} alt={artwork.alt} width={artwork.width} height={artwork.height} sizes={stripSizes(artwork.width, artwork.height)} />
                    <span className="strip-duration absolute bottom-2 right-2 rounded-sm bg-scrim/75 px-2 py-0.5 text-xs text-on-scrim">
                      <span aria-hidden="true">▶ </span>
                      {artwork.video.durationLabel}
                      <span className="sr-only"> — {tg("playVideo")}</span>
                    </span>
                  </>
                ) : (
                  // Image : la même balise qu'avant (parité visuelle).
                  <Picture
                    src={artwork.image}
                    sources={artwork.sources}
                    alt={artwork.alt}
                    width={artwork.width}
                    height={artwork.height}
                    sizes={artwork.sources ? stripSizes(artwork.width, artwork.height) : "(min-width: 1024px) 640px, 60vw"}
                    priority={index >= 0 && index < eager}
                  />
                )}
              </MediaFrame>
            </span>
            {caption}
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
    {openIndex !== null && <Lightbox items={stills} index={openIndex} onIndexChange={setOpenIndex} onClose={() => setOpenIndex(null)} />}
    {viewing?.video && <VideoViewer video={viewing.video} width={viewing.width} height={viewing.height} title={viewing.title || viewing.alt} onClose={() => setViewing(null)} />}
    </>
  );
}
