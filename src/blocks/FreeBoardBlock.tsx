import type { CSSProperties } from "react";

import { getTranslations } from "next-intl/server";

import { LoopClick } from "@/components/LoopVideo";
import Picture from "@/components/Picture";
import ViewerScope from "@/components/ViewerScope";
import { frameAttrs, imageBgAttrs } from "@/lib/look";
import { getMedia } from "@/lib/media";
import { viewerAttrs } from "@/lib/viewer";
import { RADIUS_VALUES } from "@/themes/css";

import { BlockCaption, capHost, captionPart } from "./caption";
import { freeBoardSchema, freeItems, itemHeight, readingOrder, zoneAspect } from "./free-board";
import { tr, type BlockContext } from "./types";

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
  const canvas = Boolean(ctx.edit || ctx.freeCanvas);
  const list = freeItems(props);
  const rows = await Promise.all(list.map((it) => getMedia(it.media)));
  // Un média supprimé, à la corbeille ou pas encore prêt n'est pas servi : l'image disparaît, sans trou ni erreur.
  const shown = list.flatMap((it, i) => {
    const m = rows[i];
    return m && !m.pdf && (m.video || m.sources || m.width) ? [{ it, m }] : [];
  });
  if (!shown.length && !canvas) return null;
  const zone = zoneAspect(props);
  // Cliquer pour agrandir (lot 44) : public et Aperçu seulement ; chaque image est un élément de la visionneuse, la planche en est la zone.
  const zoom = !canvas && !ctx.inlineEdit && props.zoom !== false;
  const openLabel = zoom ? (await getTranslations({ locale: ctx.locale, namespace: "gallery" }))("open") : "";
  const Section = zoom ? ViewerScope : "section";
  const ordered = readingOrder(shown.map((s) => ({ ...s, id: s.it.id, x: s.it.x, y: s.it.y })));
  return (
    <Section {...(zoom ? { as: "section" as const } : {})} className="free-board-section shell pt-[var(--section-gap)]" {...capHost(ctx)}>
      <div
        className="free-board"
        data-format={props.format}
        data-phone={props.phone}
        style={{ "--fb-r": zone.toFixed(4) } as CSSProperties}
        {...(canvas ? { "data-edit-free": "", "data-free-aspect": zone.toFixed(5) } : {})}
      >
        {ordered.map(({ it, m }) => {
          const ratio = (m.width ?? 1200) / Math.max(1, m.height ?? 800);
          const alt = m.alt ? tr(m.alt, ctx.locale) : "";
          const frame = m.video ? null : frameAttrs(it.frame);
          const bg = m.video ? null : imageBgAttrs(it.bg);
          const viewer =
            zoom && !m.video
              ? viewerAttrs({ id: `media-${it.media}-${it.id}`, image: m.url, sources: m.sources ?? undefined, alt, width: m.width ?? 1200, height: m.height ?? 800, title: "", description: "", plain: true }, openLabel)
              : {};
          const style = {
            "--x": it.x,
            "--y": it.y,
            "--w": it.w,
            "--rot": it.rot,
            zIndex: it.z + 1,
            ...(it.radius && Object.hasOwn(RADIUS_VALUES, it.radius) ? { "--free-radius": RADIUS_VALUES[it.radius] } : {}),
            ...(frame?.style ?? {}),
            ...(bg?.style ?? {}),
          } as CSSProperties;
          const sizes = `${props.phone === "stack" ? "(max-width: 639px) 100vw, " : ""}(min-width: 1236px) ${Math.round((1200 * Math.min(100, it.w)) / 100)}px, ${Math.round(Math.min(100, it.w))}vw`;
          return (
            <figure
              key={it.id}
              className="free-item"
              style={style}
              {...(frame ? { "data-frame": frame["data-frame"] } : {})}
              {...(bg ? { "data-img-bg": "" } : {})}
              {...viewer}
              {...(canvas ? { "data-free-item": it.id, "data-free-ratio": ratio.toFixed(5), "data-free-h": itemHeight(it.w, zone, ratio).toFixed(3), "data-free-style": JSON.stringify({ ...(it.radius ? { radius: it.radius } : {}), ...(it.frame ? { frame: it.frame } : {}), ...(it.bg ? { bg: it.bg } : {}) }) } : {})}
            >
              {m.video ? (
                <div className="free-media free-video" style={{ aspectRatio: ratio }}>
                  <LoopClick video={m.video} width={m.width ?? 1280} height={m.height ?? 720} className="h-full w-full object-cover" label={alt} edit={canvas} />
                </div>
              ) : (
                <Picture src={m.url} sources={m.sources} alt={alt} width={m.width ?? 1200} height={m.height ?? 800} sizes={sizes} className="free-media" />
              )}
            </figure>
          );
        })}
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
