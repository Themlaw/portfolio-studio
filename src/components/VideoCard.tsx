"use client";

import { useId, useState, type CSSProperties } from "react";

import Eyebrow from "@/components/Eyebrow";
import MediaCaption from "@/components/MediaCaption";
import type { LocalizedArtwork } from "@/lib/gallery";

import { Frame } from "./AnimationShowcase";
import { LoopClick } from "./LoopVideo";

/**
 * Une vidéo (bloc « Vidéo », v0.13) : vidéo hébergée (médiathèque) ou plan de
 * la collection Animation (YouTube). Trois présentations, reprises de
 * l'ancienne vitrine pour que la migration garde le rendu au pixel :
 * « feature » (étiquette, titre, grand cadre, légende et durée), « card »
 * (cadre, titre et durée, légende), « plain » (le cadre seul). Mode
 * Deux façons de lire une vidéo hébergée (réglage « Lecture » de l'illustratrice) : « Boucle » (`loop`) tourne en
 * boucle, muette, sur place, un clic la met en pause ou la relance ; « Lecteur » (`player`) montre l'image d'attente
 * avec un bouton lecture, un clic ouvre la vidéo en grand avec son lecteur (VideoViewer).
 * `edit` : repères de la toile (textes en place, barre Remplacer).
 */
export default function VideoCard({
  item,
  look,
  mode,
  texts,
  edit = false,
  styles,
  marks = edit,
  prefix = "",
  frame: frameRender,
}: {
  item: LocalizedArtwork;
  look: "feature" | "card" | "plain";
  mode: "loop" | "player";
  /** `captionTitle` et `date` (lot 39) : Titre (présentation « seule ») et Date, facultatifs ; la légende est `description`. */
  texts: { eyebrow: string; title: string; description: string; captionTitle?: string; date?: string };
  edit?: boolean;
  /** Styles locaux de l'étiquette, du titre, de la légende et de la date (barre typographique, lots 2, 33 et 39). */
  styles?: { eyebrow?: CSSProperties; title?: CSSProperties; description?: CSSProperties; captionTitle?: CSSProperties; captionDate?: CSSProperties };
  /** Repères de saisie en place (`data-inline`) : la toile d'une page (`edit`), ou une planche (lot 31c, `inlineEdit`). */
  marks?: boolean;
  /** Préfixe du chemin des textes (case d'une grille de planche, lot 39). */
  prefix?: string;
  /** Cadre de la vidéo (lot 62) : le choix de l'artiste (`look.frame`), rendu par `frameStyle` ; absent = suit le réglage du site. */
  frame?: { attrs: Record<string, string>; style: CSSProperties } | null;
}) {
  const [playing, setPlaying] = useState(false);
  const id = useId();
  const mark = (path: string, placeholder: string) => ({ ...(marks ? { "data-inline": `${prefix}${path}`, "data-placeholder": placeholder } : {}), ...(styles?.[path as keyof typeof styles] ? { style: styles[path as keyof typeof styles] } : {}) });
  /** Date en bout de ligne des présentations « carte » et « mise en avant » (lot 39) : rien tant qu'elle est vide, hors de la toile. */
  const dateMark = marks || Boolean(texts.date);
  const date = dateMark ? (
    <span className="mc-date-own" data-cap="date" data-cap-own="" {...mark("captionDate", "Date")}>
      {texts.date}
    </span>
  ) : null;
  const markAttrs = (path: string): Record<string, string> => (marks ? { "data-inline": `${prefix}${path}` } : {});
  const host = marks ? { "data-cap-host": "" } : {};
  const shown = { ...item, title: texts.title, alt: item.alt || texts.title };
  const loop = mode === "loop" && Boolean(item.video);
  const frame = loop ? (
    <div className="mat">
      <div className="video-frame relative aspect-video w-full overflow-hidden rounded-[2px] bg-scrim" {...frameRender?.attrs} style={frameRender?.style}>
        <LoopClick video={item.video!} width={item.width} height={item.height} className="absolute inset-0 h-full w-full object-cover" label={texts.title} edit={edit} />
      </div>
    </div>
  ) : (
    <Frame item={shown} large={look === "feature"} playing={playing} onPlay={() => setPlaying(true)} edit={edit} frame={frameRender} />
  );
  const media = edit ? (
    <div data-edit-media="mediaId" data-edit-media-kind="video" {...(item.video ? { "data-video-mode": loop ? "loop" : "player" } : {})}>
      {frame}
    </div>
  ) : item.video ? (
    <div data-video-mode={loop ? "loop" : "player"}>{frame}</div>
  ) : (
    frame
  );

  if (look === "feature") {
    return (
      <section aria-labelledby={`video-${id}`} {...host}>
        {(texts.eyebrow || edit) && <Eyebrow {...mark("eyebrow", "Étiquette")}>{texts.eyebrow}</Eyebrow>}
        <h2 id={`video-${id}`} className="mt-3 mb-8 font-display text-[clamp(2rem,5vw,3.5rem)] text-ink" {...mark("title", "Titre de la vidéo")}>
          {texts.title}
        </h2>
        <div className="group">{media}</div>
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-4">
          <p className="max-w-xl text-sm leading-relaxed text-ink-soft" {...mark("description", "Légende")}>
            {texts.description}
          </p>
          {(item.duration || date) && (
            <p className="eyebrow">
              {date}
              {texts.date && item.duration ? " · " : null}
              {item.duration}
            </p>
          )}
        </div>
      </section>
    );
  }
  if (look === "card") {
    const meta = item.duration ?? (item.year || "");
    return (
      <div className="group mat-hover" {...host}>
        {media}
        <div className="mt-4 flex items-baseline justify-between gap-4">
          <h3 className="font-display text-xl text-ink transition-colors group-hover:text-primary" {...mark("title", "Titre de la vidéo")}>
            {texts.title}
          </h3>
          <span className="eyebrow shrink-0">
            {date}
            {texts.date && meta ? " · " : null}
            {meta}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft" {...mark("description", "Légende")}>
          {texts.description}
        </p>
      </div>
    );
  }
  return (
    <figure className="group" {...host}>
      {media}
      <MediaCaption
        as="figcaption"
        edit={marks}
        title={{ text: texts.captionTitle ?? "", attrs: markAttrs("captionTitle"), style: styles?.captionTitle }}
        legend={{ text: texts.description, attrs: markAttrs("description"), style: styles?.description }}
        date={{ text: texts.date ?? "", attrs: markAttrs("captionDate"), style: styles?.captionDate }}
      />
    </figure>
  );
}
