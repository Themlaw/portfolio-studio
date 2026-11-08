import type { CSSProperties } from "react";

import { getTranslations } from "next-intl/server";

import { LoopClick } from "@/components/LoopVideo";
import MediaFrame from "@/components/MediaFrame";
import Picture from "@/components/Picture";
import PlayerFrame from "@/components/PlayerFrame";
import { claimEager } from "@/lib/eager";
import ViewerScope from "@/components/ViewerScope";
import { getMedia } from "@/lib/media";
import { viewerAttrs } from "@/lib/viewer";

import { BlockCaption, capHost, captionPart } from "./caption";
import { cropStyle, freeBoardSchema, freeItems, itemHeight, readingOrder, zoneAspect } from "./free-board";
import { tr, type BlockContext } from "./types";
import { soundAttrs, withSound } from "./video-sound";

export { freeBoardSchema };

/**
 * Planche libre (lot 42) : une zone au format choisi (16:9, 3:2, 4:3, carré, ou hauteur libre) où des images (PNG détourés…)
 * ou des vidéos sont posées chacune à sa place, à sa taille et sous son angle. Sans fond propre : les images sont directement
 * sur la carte (ou la page) ; l'option « Fond » du composant fait une carte dans la carte.
 *
 * Public : `position: absolute` en % de la zone (variables CSS `--x --y --w --rot`, src/app/look.css), dont la hauteur suit un
 * format fixe (`aspect-ratio`) : la composition est identique à toutes les largeurs, elle se met à l'échelle. Sous 640 px,
 * au choix de l'artiste : à l'échelle (défaut) ou empilées (`data-phone="stack"`, ordre de lecture haut → bas puis gauche → droite).
 * Accessibilité : `alt` de chaque image (celui de la médiathèque), ordre du DOM = ordre de lecture ; l'empilement visuel passe par
 * `z-index`, jamais par l'ordre du DOM.
 *
 * Toile de l'éditeur (`ctx.edit`, ou `ctx.freeCanvas` pour un composant de planche) : repères `data-edit-free` (la zone) et
 * `data-free-item` (chaque image) lus par le calque FreeLayer, et « + Image » au centre d'une zone vide. Jamais en public.
 */
export default async function FreeBoardBlock({ props, ctx }: { props: ReturnType<typeof freeBoardSchema.parse>; ctx: BlockContext }) {
  const eager = claimEager(2);
  const canvas = Boolean(ctx.edit || ctx.freeCanvas);
  const list = freeItems(props);
  const rows = await Promise.all(list.map((it) => getMedia(it.media)));
  // Images d'attente choisies pour des vidéos (lot 116).
  const posters = await Promise.all(list.map((it) => (it.poster ? getMedia(it.poster) : null)));
  // Un média supprimé, à la corbeille ou pas encore prêt n'est pas servi : l'image disparaît, sans trou ni erreur.
  const shown = list.flatMap((it, i) => {
    const m = rows[i];
    const pm = posters[i];
    return m && !m.pdf && (m.video || m.sources || m.width) ? [{ it, m, poster: pm && !pm.video && !pm.pdf ? pm : null }] : [];
  });
  if (!shown.length && !canvas) return null;
  const zone = zoneAspect(props);
  // Cliquer pour agrandir (lot 44) : public et Aperçu seulement ; chaque image est un élément de la visionneuse, la planche en est la zone.
  // Dans une cellule de grille (lot 113) : pas d'enveloppe de section (la grille a la sienne) ; la visionneuse est celle de la grille.
  const inCell = Boolean(ctx.cell);
  const zoom = !canvas && !ctx.inlineEdit && props.zoom !== false && (!inCell || ctx.cellViewer === true);
  const crop = cropStyle(props);
  const openLabel = zoom ? (await getTranslations({ locale: ctx.locale, namespace: "gallery" }))("open") : "";
  const Section = zoom && !inCell ? ViewerScope : inCell ? "div" : "section";
  const ordered = readingOrder(shown.map((s) => ({ ...s, id: s.it.id, x: s.it.x, y: s.it.y })));
  // Lecture d'une vidéo (lot 116) : le choix de sa ligne ; sans choix, la Boucle (le comportement d'avant).
  const modeOf = (it: { video?: "loop" | "player" }) => it.video ?? "loop";
  return (
    <Section {...(zoom && !inCell ? { as: "section" as const } : {})} className={inCell ? "free-board-section" : "free-board-section shell pt-[var(--section-gap)]"} {...capHost(ctx)}>
      <div
        className="free-board"
        data-format={props.format}
        data-phone={props.phone}
        {...(crop ? { "data-crop": "" } : {})}
        style={{ "--fb-r": zone.toFixed(4), ...(crop ?? {}) } as CSSProperties}
        {...(canvas ? { "data-edit-free": "", "data-free-aspect": zone.toFixed(5) } : {})}
      >
        {ordered.map(({ it, m, poster }) => {
          // Son au départ (lot 127) : le réglage de la ligne, jamais écrit dans le média.
          const video = m.video ? withSound(m.video, it.sound) : null;
          const ratio = (m.width ?? 1200) / Math.max(1, m.height ?? 800);
          const alt = m.alt ? tr(m.alt, ctx.locale) : "";
          const viewer =
            zoom && !m.video
              ? viewerAttrs({ id: `media-${it.media}-${it.id}`, image: m.url, sources: m.sources ?? undefined, alt, width: m.width ?? 1200, height: m.height ?? 800, title: "", description: "", plain: true }, [alt, openLabel].filter(Boolean).join(" — "))
              : {};
          const style = {
            "--x": it.x,
            "--y": it.y,
            "--w": it.w,
            "--rot": it.rot,
            zIndex: it.z + 1,
          } as CSSProperties;
          // Habillage de l'image : le même composant que partout (MediaFrame) ; pas de fond derrière une vidéo.
          const mediaLook = { frame: it.frame, bg: m.video ? undefined : it.bg, radius: it.radius };
          const sizes = `${props.phone === "stack" ? "(max-width: 639px) 100vw, " : ""}(min-width: 1236px) ${Math.round((1200 * Math.min(100, it.w)) / 100)}px, ${Math.round(Math.min(100, it.w))}vw`;
          return (
            <figure
              key={it.id}
              className="free-item"
              style={style}
              {...viewer}
              {...(canvas ? { "data-free-item": it.id, ...(m.video ? { "data-free-lecture": modeOf(it), "data-free-audio": m.video.hasAudio ? "1" : "0", "data-free-sound": it.sound === "off" ? "off" : "on", "data-free-poster": String(it.poster ?? "") } : {}), "data-free-ratio": ratio.toFixed(5), "data-free-h": itemHeight(it.w, zone, ratio).toFixed(3), "data-free-style": JSON.stringify({ ...(it.radius ? { radius: it.radius } : {}), ...(it.frame ? { frame: it.frame } : {}), ...(it.bg ? { bg: it.bg } : {}) }) } : {})}
            >
              {m.video && modeOf(it) === "player" ? (
                <PlayerFrame
                  item={{
                    id: `media-${m.id}-${it.id}`,
                    slug: `media-${m.id}`,
                    collection: "animation",
                    title: alt,
                    alt,
                    description: "",
                    image: poster?.url ?? m.url,
                    sources: poster?.sources ?? m.sources ?? undefined,
                    video: video!,
                    width: m.width ?? 1280,
                    height: m.height ?? 720,
                    year: 0,
                    featured: false,
                    duration: m.video.durationLabel,
                  }}
                  mediaLook={mediaLook}
                  ratio={ratio}
                  edit={canvas}
                  attrs={{ "data-video-mode": "player", ...soundAttrs(video) }}
                />
              ) : (
                <MediaFrame as="div" kind={m.video ? "video" : "image"} look={mediaLook} ratio={ratio} {...(m.video ? { "data-video-mode": "loop", ...soundAttrs(video) } : {})}>
                  {m.video ? (
                    <LoopClick video={video!} width={m.width ?? 1280} height={m.height ?? 720} className="h-full w-full object-cover" label={alt} edit={canvas} poster={poster?.url} />
                  ) : (
                    <Picture src={m.url} sources={m.sources} alt={alt} width={m.width ?? 1200} height={m.height ?? 800} sizes={sizes} priority={shown.findIndex((s) => s.it.id === it.id) < eager} />
                  )}
                </MediaFrame>
              )}
            </figure>
          );
        })}
        {/* Titre « sur l'image » (lot 128) : posé sur la zone, au-dessus des images (z-index), sans prendre de place. */}
        {ctx.overHead}
        {canvas && !shown.length && (
          <div className="pe-free-empty" lang="fr" data-edit-free-empty="">
            <button type="button" className="pe-empty-action" data-edit-free-add="">
              <span aria-hidden="true">+</span> Image
            </button>
            <span>ou glisse des images ici</span>
          </div>
        )}
      </div>
      <BlockCaption ctx={ctx} title={captionPart(ctx, "captionTitle", props.captionTitle)} legend={captionPart(ctx, "caption", props.caption)} date={captionPart(ctx, "captionDate", props.captionDate)} />
    </Section>
  );
}
