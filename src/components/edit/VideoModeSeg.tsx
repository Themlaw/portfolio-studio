"use client";

import { useTranslations } from "next-intl";

import { VIDEO_MODES, type VideoMode } from "@/blocks/video-mode";

/**
 * Choix « Lecture » Boucle / Lecteur d'une vidéo (barre d'outils de l'image) : UN composant pour les places de carrousel
 * (BoardLayer) et les vidéos de la planche libre (FreeLayer, lot 116). `attr` = nom de l'attribut des boutons (les suites e2e s'y accrochent).
 */
export default function VideoModeSeg({ now, onChange, testId, attr }: { now: VideoMode; onChange: (mode: VideoMode) => void; testId: string; attr: string }) {
  const t = useTranslations("editMenusVideo");
  const tl = useTranslations("blockRegLabels");
  return (
    <span className="pe-seg" role="group" aria-label={t("playback")} data-testid={testId}>
      <span className="pe-seg-label" aria-hidden="true">
        {t("playbackShort")}
      </span>
      {VIDEO_MODES.map((m) => (
        <button key={m} type="button" aria-pressed={now === m} title={tl(`videoMode.hint.${m}`)} {...{ [attr]: m }} onClick={() => onChange(m)}>
          {tl(`videoMode.label.${m}`)}
        </button>
      ))}
    </span>
  );
}
