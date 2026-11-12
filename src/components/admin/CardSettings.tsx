"use client";

/**
 * « Cartes des rubriques » d'un thème (lot 17c) : couleur, largeur et coins que prend une rubrique quand on
 * active sa carte sans rien choisir (bouton « Carte » sur la page). Stocké dans `tokens.layout.card` ; ne change
 * rien aux rubriques sans carte ni aux thèmes livrés. Une carte qui garde un texte illisible est signalée.
 */
import { useFormatter, useTranslations } from "next-intl";

import CardColorChoices from "@/components/edit/CardColorChoices";
import type { SitePalette } from "@/lib/look";
import AdminColorPicker from "./AdminColorPicker";
import { effectiveSitePalette } from "@/themes/site-palette";
import type { Theme } from "@/themes/schema";
import {
  cardStyle,
  DEFAULT_BORDER_WIDTH,
  isSurfaceToken,
  resolveSurface,
  SURFACE_BORDER_LABELS,
  SURFACE_BORDER_WIDTHS,
  SURFACE_CORNER_LABELS,
  SURFACE_CORNERS,
  SURFACE_TOKEN_LABELS,
  SURFACE_WIDTH_LABELS,
  SURFACE_WIDTHS,
  cardBackground,
  type Surface,
} from "@/themes/surface";

export default function CardSettings({ theme, onChange, sitePalette }: { theme: Theme; onChange: (card: Surface | undefined) => void; sitePalette?: SitePalette }) {
  const t = useTranslations("cardSettings");
  const format = useFormatter();
  const card = theme.tokens.layout?.card;
  // Couleurs du thème, palette du site comprise quand le thème est en ligne (ce que verront les visiteurs).
  const palette = effectiveSitePalette(theme.tokens.color, theme.tokens.palette, sitePalette);
  const resolved = resolveSurface(card ?? {});
  const style = cardStyle(resolved.color, palette);
  const set = (patch: Partial<Surface>) => {
    const next = { ...(card ?? {}), ...patch };
    onChange(Object.keys(next).length ? next : undefined);
  };
  const custom = !isSurfaceToken(resolved.color);
  return (
    <section className="a-panel" aria-labelledby="t-cartes">
      <h3 id="t-cartes" className="a-subhead">
        {t("title")}
      </h3>
      <p className="a-help">
        {t("intro")}
      </p>
      <div className="a-field">
        <span className="a-label-text" id="t-carte-couleur">
          {t("defaultColor")}
        </span>
        <CardColorChoices palette={palette} value={resolved.color} onPick={(tok) => set({ color: tok })} />
        <div className="a-color-row" role="group" aria-labelledby="t-carte-couleur">
          <AdminColorPicker
            label={t("otherColor")}
            value={custom ? resolved.color.slice(0, 7) : cardBackground(resolved.color, palette).slice(0, 7)}
            onChange={(hex) => set({ color: hex })}
          />
        </div>
        <p className="a-help">
          {SURFACE_TOKEN_LABELS[resolved.color as keyof typeof SURFACE_TOKEN_LABELS] ?? t("freeColor", { color: resolved.color })}. {t("colorHelp")}{" "}
          {style.ok ? t("textOk") : t("textBad", { ratio: format.number(style.ratio, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
        </p>
      </div>
      <div className="a-field">
        <span className="a-label-text">{t("width")}</span>
        <div className="a-seg" role="group" aria-label={t("defaultWidth")}>
          {SURFACE_WIDTHS.map((w) => (
            <button key={w} type="button" aria-pressed={resolved.width === w} onClick={() => set({ width: w })}>
              {SURFACE_WIDTH_LABELS[w]}
            </button>
          ))}
        </div>
      </div>
      <div className="a-field">
        <span className="a-label-text">{t("corners")}</span>
        <div className="a-seg" role="group" aria-label={t("defaultCorners")}>
          {SURFACE_CORNERS.map((c) => (
            <button key={c} type="button" aria-pressed={resolved.corners === c} onClick={() => set({ corners: c })}>
              {SURFACE_CORNER_LABELS[c]}
            </button>
          ))}
        </div>
      </div>
      <div className="a-field">
        <span className="a-label-text">{t("border")}</span>
        <div className="a-seg" role="group" aria-label={t("defaultBorder")} data-testid="card-default-border">
          <button type="button" aria-pressed={!resolved.border} onClick={() => set({ border: undefined })}>
            {t("noBorder")}
          </button>
          {SURFACE_BORDER_WIDTHS.map((w) => (
            <button key={w} type="button" aria-pressed={resolved.border?.width === w} data-border-width={w} onClick={() => set({ border: { width: w, ...(resolved.border?.color ? { color: resolved.border.color } : {}) } })}>
              {SURFACE_BORDER_LABELS[w]}
            </button>
          ))}
        </div>
        {resolved.border && (
          <>
            <CardColorChoices
              palette={palette}
              value={resolved.border.color ?? ""}
              label={t("borderColor")}
              onPick={(tok) => set({ border: { width: resolved.border?.width ?? DEFAULT_BORDER_WIDTH, color: tok } })}
              auto={{ label: t("borderAuto"), onPick: () => set({ border: { width: resolved.border?.width ?? DEFAULT_BORDER_WIDTH } }) }}
            />
            <div className="a-color-row">
              <AdminColorPicker
                label={t("otherBorderColor")}
                value={resolved.border.color && !isSurfaceToken(resolved.border.color) ? resolved.border.color.slice(0, 7) : cardBackground(resolved.border.color ?? "ink", palette).slice(0, 7)}
                onChange={(hex) => set({ border: { width: resolved.border?.width ?? DEFAULT_BORDER_WIDTH, color: hex } })}
              />
            </div>
          </>
        )}
        <p className="a-help">{t("borderHelp")}</p>
      </div>
      {card && (
        <button type="button" className="a-btn a-btn-quiet" onClick={() => onChange(undefined)}>
          {t("reset")}
        </button>
      )}
    </section>
  );
}
