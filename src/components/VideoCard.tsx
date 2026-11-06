"use client";

import { useId, useState, type CSSProperties } from "react";

import { soundAttrs } from "@/blocks/video-sound";
import Eyebrow from "@/components/Eyebrow";
import MediaCaption from "@/components/MediaCaption";
import type { LocalizedArtwork } from "@/lib/gallery";
import type { MediaLook } from "@/lib/look";

import { Frame } from "./AnimationShowcase";
import { LoopClick } from "./LoopVideo";
import MediaFrame from "./MediaFrame";

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
  mediaLook,
  ratio,
  solo = false,
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
  /** Habillage de la vidéo (lots 62 et 64) : cadre, fond, arrondi (MediaFrame, comme une photo). Cadre absent : suit le réglage du site (jamais pour une vidéo). */
  mediaLook?: MediaLook;
  /** Format imposé (celui d'une grille) ; absent = le format de la vidéo. Même cadrage qu'une photo : la boîte est remplie, la vidéo rognée. */
  ratio?: number;
  /** Vidéo seule (hors case de grille) : plafond de hauteur de l'image seule (85 % de l'écran), la vidéo verticale ne déborde pas. */
  solo?: boolean;
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
  const boxRatio = ratio ?? item.width / Math.max(1, item.height);
  // Repères de la boîte de la vidéo : la toile (remplacer / retirer, lecture) et le mode de lecture.
  const attrs = {
    ...(edit ? { "data-edit-media": "mediaId", "data-edit-media-kind": "video" } : {}),
    ...(item.video ? { "data-video-mode": loop ? "loop" : "player", ...soundAttrs(item.video) } : {}),
  };
  const media = loop ? (
    <MediaFrame as="div" kind="video" look={mediaLook} ratio={boxRatio} grow={solo} {...attrs}>
      <LoopClick video={item.video!} width={item.width} height={item.height} className="h-full w-full object-cover" label={texts.title} edit={edit} />
    </MediaFrame>
  ) : (
    <Frame item={shown} large={look === "feature"} playing={playing} onPlay={() => setPlaying(true)} edit={edit} mediaLook={mediaLook} ratio={boxRatio} grow={solo} attrs={attrs} />
  );
  // Vidéo seule : le même plafond de hauteur qu'une image seule (src/app/media-frame.css, `--ir` = format affiché).
  const soloClass = solo ? " media-solo" : "";
  const soloStyle = solo ? ({ "--ir": boxRatio.toFixed(4) } as CSSProperties) : undefined;

  if (look === "feature") {
    return (
      <section aria-labelledby={`video-${id}`} {...host}>
        {(texts.eyebrow || edit) && <Eyebrow {...mark("eyebrow", "Étiquette")}>{texts.eyebrow}</Eyebrow>}
        <h2 id={`video-${id}`} className="mt-3 mb-8 font-display text-[clamp(2rem,5vw,3.5rem)] text-ink" {...mark("title", "Titre de la vidéo")}>
          {texts.title}
        </h2>
        <div className={`group${soloClass}`} style={soloStyle}>
          {media}
        </div>
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-4">
          <p className="max-w-xl text-sm leading-relaxed text-ink-soft" {...mark("description", "Légende")}>
            {texts.description}
          </p>
          {(date || (!item.video && item.duration)) && (
            <p className="eyebrow">
              {date}
              {!item.video && item.duration ? <span data-cap="duration">{item.duration}</span> : null}
            </p>
          )}
        </div>
      </section>
    );
  }
  if (look === "card") {
    // Lot 116 : la durée d'une vidéo hébergée est dans son badge (▶ 1:29), plus collée à la date dans la légende.
    const meta = item.video ? "" : (item.duration ?? (item.year || ""));
    return (
      <div className={`group${soloClass}`} style={soloStyle} {...host}>
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
    <figure className={`group${soloClass}`} style={soloStyle} {...host}>
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
