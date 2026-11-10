"use client";

import { useTranslations } from "next-intl";

import { VIDEO_SOUNDS, type VideoSound } from "@/blocks/video-sound";

/**
 * Choix « Son au départ » Activé / Coupé d'une vidéo (lot 127) : UN composant pour toutes les barres de la toile (vidéo d'une page, case de
 * grille, composant de planche, place de carrousel, Planche libre). `attr` = nom de l'attribut des boutons (les suites e2e s'y accrochent),
 * `prefix` = début de sa valeur (« sound- » : `sound-on` / `sound-off`), `extra` = autres attributs. Sans `onChange` (barre rendue côté
 * serveur), le clic est écouté par la couche d'édition (BoardLayer) d'après ces attributs. Le bouton « Activé » est celui du défaut.
 */
export default function VideoSoundSeg({
  now,
  onChange,
  testId,
  attr,
  prefix = "",
  className,
  extra,
}: {
  now: VideoSound;
  onChange?: (sound: VideoSound) => void;
  testId: string;
  attr: string;
  prefix?: string;
  className?: string;
  extra?: Record<string, string | number>;
}) {
  const t = useTranslations("editMenusVideo");
  const tl = useTranslations("blockRegLabels");
  return (
    <span className="pe-seg" role="group" aria-label={t("soundGroup")} data-testid={testId}>
      <span className="pe-seg-label" aria-hidden="true">
        {t("sound")}
      </span>
      {VIDEO_SOUNDS.map((m) => (
        <button key={m} type="button" className={className} aria-pressed={now === m} title={tl(`videoSound.hint.${m}`)} {...{ [attr]: `${prefix}${m}` }} {...extra} onClick={onChange ? () => onChange(m) : undefined}>
          {tl(`videoSound.label.${m}`)}
        </button>
      ))}
    </span>
  );
}
