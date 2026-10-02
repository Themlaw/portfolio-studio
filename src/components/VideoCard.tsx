"use client";

import { useId, useState } from "react";

import Eyebrow from "@/components/Eyebrow";
import type { LocalizedArtwork } from "@/lib/gallery";

import { Frame } from "./AnimationShowcase";
import Video from "./Video";

/**
 * Une vidéo (bloc « Vidéo », v0.13) : vidéo hébergée (médiathèque) ou plan de
 * la collection Animation (YouTube). Trois présentations, reprises de
 * l'ancienne vitrine pour que la migration garde le rendu au pixel :
 * « feature » (étiquette, titre, grand cadre, légende et durée), « card »
 * (cadre, titre et durée, légende), « plain » (le cadre seul). Mode
 * « loop » : boucle muette sans contrôles (vidéo hébergée seulement).
 * `edit` : repères de la toile (textes en place, barre Remplacer).
 */
export default function VideoCard({
  item,
  look,
  loop,
  texts,
  edit = false,
}: {
  item: LocalizedArtwork;
  look: "feature" | "card" | "plain";
  loop: boolean;
  texts: { eyebrow: string; title: string; description: string };
  edit?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const id = useId();
  const mark = (path: string, placeholder: string) => (edit ? { "data-inline": path, "data-placeholder": placeholder } : {});
  const shown = { ...item, title: texts.title, alt: item.alt || texts.title };
  const frame =
    loop && item.video ? (
      <div className="mat">
        <div className="relative aspect-video w-full overflow-hidden rounded-[2px] bg-scrim">
          <Video video={item.video} width={item.width} height={item.height} className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop controls={false} label={texts.title} />
        </div>
      </div>
    ) : (
      <Frame item={shown} large={look === "feature"} playing={playing} onPlay={() => setPlaying(true)} />
    );
  const media = edit ? (
    <div data-edit-media="mediaId" data-edit-media-kind="video">
      {frame}
    </div>
  ) : (
    frame
  );

  if (look === "feature") {
    return (
      <section aria-labelledby={`video-${id}`}>
        {(texts.eyebrow || edit) && <Eyebrow {...mark("eyebrow", "Étiquette")}>{texts.eyebrow}</Eyebrow>}
        <h2 id={`video-${id}`} className="mt-3 mb-8 font-display text-[clamp(2rem,5vw,3.5rem)] text-ink" {...mark("title", "Titre de la vidéo")}>
          {texts.title}
        </h2>
        <div className="group">{media}</div>
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-4">
          <p className="max-w-xl text-sm leading-relaxed text-ink-soft" {...mark("description", "Légende")}>
            {texts.description}
          </p>
          {item.duration && <p className="eyebrow">{item.duration}</p>}
        </div>
      </section>
    );
  }
  if (look === "card") {
    const meta = item.duration ?? (item.year || "");
    return (
      <div className="group mat-hover">
        {media}
        <div className="mt-4 flex items-baseline justify-between gap-4">
          <h3 className="font-display text-xl text-ink transition-colors group-hover:text-primary" {...mark("title", "Titre de la vidéo")}>
            {texts.title}
          </h3>
          <span className="eyebrow shrink-0">{meta}</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft" {...mark("description", "Légende")}>
          {texts.description}
        </p>
      </div>
    );
  }
  return (
    <figure className="group">
      {media}
      {(texts.description || edit) && (
        <figcaption className="strip-caption mt-3" {...mark("description", "Légende")}>
          {texts.description}
        </figcaption>
      )}
    </figure>
  );
}
