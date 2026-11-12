"use client";

/**
 * Contenu de la fenêtre « Fond de l'image » (lot 41), SANS dépendance de la couche d'édition de la toile : partagé par ses
 * fenêtres (ImageBgMenu.tsx) et par le haut du panneau de l'éditeur. Quatre choix : « Aucun » (transparent, comme avant : valeur
 * par défaut), « Blanc », « Couleur de la carte » (le fond des cartes du thème), ou « Couleur… » (pastilles de la palette du site
 * + couleur libre, le sélecteur du lot 29 : `ColorPicker`). Les pastilles montrent les couleurs du thème par leurs variables.
 */
import { useTranslations } from "next-intl";

import type { AdminT } from "@/i18n/admin-lang";
import { PALETTE_DISPLAY, PALETTE_LABELS, type PaletteColor } from "@/lib/look";
import { IMAGE_BG_CARD, IMAGE_BG_WHITE } from "@/themes/image-bg";

import ColorPicker from "./ColorPicker";

import "@/app/admin/typo-controls.css";
import "@/app/admin/surface-menu.css";

const toileSwatch = (c: PaletteColor) => `var(--t-color-${c})`;
const isPalette = (v: string | undefined): v is PaletteColor => (PALETTE_DISPLAY as readonly string[]).includes(v ?? "");

/** Nom du fond choisi, en clair. */
export function imageBgName(value: string | undefined, t: AdminT): string {
  if (value === undefined) return t("none");
  if (value === IMAGE_BG_WHITE) return t("white");
  if (value === IMAGE_BG_CARD) return t("card");
  return isPalette(value) ? PALETTE_LABELS[value] : t("custom");
}

/** Quatre choix. `value` absent = aucun fond ; `onChange(undefined)` le retire. `swatch` : couleur CSS d'une teinte de la palette (toile par défaut ; panneau : valeur du thème). */
export function ImageBgControls({ value, onChange, swatch = toileSwatch }: { value: string | undefined; onChange: (next: string | undefined) => void; swatch?: (c: PaletteColor) => string }) {
  const t = useTranslations("editMenusImageBg");
  const custom = value !== undefined && value !== IMAGE_BG_WHITE && value !== IMAGE_BG_CARD && !isPalette(value) ? value : undefined;
  const choices: { key: string; label: string; title: string; value: string | undefined }[] = [
    { key: "none", label: t("none"), title: t("noneTitle"), value: undefined },
    { key: "white", label: t("white"), title: t("whiteTitle"), value: IMAGE_BG_WHITE },
    { key: "card", label: t("card"), title: t("cardTitle"), value: IMAGE_BG_CARD },
  ];
  return (
    <div className="fr ibg" data-testid="imgbg-controls">
      <span className="sm-label ibg-title">{t("title")}</span>
      <span className="tc-seg ibg-seg" role="radiogroup" aria-label={t("title")}>
        {choices.map((c) => (
          <button key={c.key} type="button" role="radio" aria-checked={value === c.value} title={c.title} data-imgbg={c.key} onClick={() => onChange(c.value)}>
            {c.label}
          </button>
        ))}
      </span>
      <div className="tc-row">
        <span className="sm-label">{t("colourEllipsis")}</span>
        <span className="tc-swatches" role="radiogroup" aria-label={t("colourGroup")}>
          {PALETTE_DISPLAY.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={value === c}
              aria-label={PALETTE_LABELS[c]}
              title={PALETTE_LABELS[c]}
              className="tc-swatch"
              data-imgbg-color={c}
              style={{ background: swatch(c) }}
              onClick={() => onChange(c)}
            />
          ))}
          <ColorPicker value={custom} onChange={(color) => onChange(color)} swatch={swatch} />
        </span>
      </div>
      <p className="sm-hint" data-testid="imgbg-name">
        {value === undefined ? t("hintNone") : t("hintName", { name: imageBgName(value, t).toLowerCase() })}
      </p>
    </div>
  );
}
