"use client";

/**
 * Liste de formats UNIQUE des éditeurs de blocs (src/lib/images/formats.ts). Un cadrage libre posé sur
 * la page (« Cadrer ») met le Format à jour : « Libre », ou le format de la liste le plus proche du
 * rapport détecté. Choisir un format remplace le cadrage libre (il suit son propre rapport, il
 * masquerait sinon le choix).
 */
import { Select } from "@/app/admin/_fields";
import { detectFormat, FORMAT_LABELS, formatOptions } from "@/lib/images/formats";
import { cleanLook, readLook } from "@/lib/look";

import { useBlockEditor } from "./editor-context";

export default function FormatSelect({
  label = "Format",
  help,
  ratioProp = "ratio",
  mediaProp,
  explicitAuto = false,
}: {
  label?: string;
  help?: string;
  /** Prop qui porte le format (« ratio », « portraitRatio »). */
  ratioProp?: string;
  /** Prop média dont le cadrage libre fixe le format affiché (« mediaId », « portraitMediaId »). */
  mediaProp?: "mediaId" | "portraitMediaId";
  /** « Libre » est écrit « auto » (grille) au lieu d'être retiré. */
  explicitAuto?: boolean;
}) {
  const { value, onChange, errors, context } = useBlockEditor();
  const current = (value[ratioProp] as string | undefined) ?? "auto";
  const look = readLook(value.look);
  const rect = mediaProp ? look?.crop?.[mediaProp]?.rect : undefined;
  const media = mediaProp ? context.media.find((m) => m.id === value[mediaProp]) : undefined;
  const freeRatio = rect && media?.width && media?.height ? (rect.w * media.width) / (rect.h * media.height) : null;
  const detected = freeRatio ? detectFormat(freeRatio) : null;
  const shown = freeRatio ? (detected ?? "auto") : current;
  const note = freeRatio
    ? `Cadrage libre en place (${detected ? FORMAT_LABELS[detected] : `${freeRatio.toFixed(2).replace(".", ",")} : 1`}). Choisir un autre format le remplace.`
    : undefined;
  return (
    <Select
      label={label}
      help={[help, note].filter(Boolean).join(" ") || undefined}
      value={shown}
      options={formatOptions(shown)}
      error={errors[ratioProp]}
      onChange={(v) => {
        const next: Record<string, unknown> = { ...value };
        if (v === undefined || (v === "auto" && !explicitAuto)) delete next[ratioProp];
        else next[ratioProp] = v;
        if (rect && mediaProp) {
          const crop = { ...look!.crop };
          delete crop[mediaProp];
          const clean = cleanLook({ ...look!, crop: Object.keys(crop).length ? crop : undefined });
          if (clean) next.look = clean;
          else delete next.look;
        }
        onChange(next);
      }}
    />
  );
}
