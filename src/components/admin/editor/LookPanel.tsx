"use client";

/**
 * Panneau « Mise en page » de l'éditeur visuel (lot 2) :
 * - pour le bloc choisi : espace haut / bas, arrondi des images, position du
 *   titre, fond du métier (ouverture), cadrages et styles de texte posés sur
 *   la page (avec « Réinitialiser ») ;
 * - quand rien n'est choisi : « Styles du site » (textes par rôle, arrondi des
 *   images), brouillon du site publié avec la page comme l'en-tête.
 * Mêmes crans que la toile (src/lib/look.ts).
 */
import { useTranslations } from "next-intl";
import { useState } from "react";

import { SidesSlider, SpaceSlider, WidthSlider } from "@/components/edit/LookSliders";

import TypoControls from "@/components/edit/TypoControls";
import {
  BACKDROP_BLOCKED,
  BLOCK_WIDTH_LABELS,
  BLOCK_WIDTHS,
  SIDE_SPACES,
  IMAGE_ALIGN_LABELS,
  IMAGE_ALIGNS,
  RADII,
  RADIUS_LABELS,
  ROLE_LABELS,
  ROLES,
  SPACE_LABELS,
  SPACES,
  type Look,
  type PaletteColor,
  type Role,
  type SiteStyles,
  type TextStyle,
  type TileKey,
} from "@/lib/look";

import type { AdminT } from "@/i18n/admin-lang";
import type { CardPalette } from "@/themes/surface";

import "@/app/admin/look-panel.css";

const TITLE_TYPES = new Set(["section-title", "collection-intro", "hero", "project-board", "collection-tiles"]);
const MEDIA_TYPES = new Set(["image", "video-single", "cv", "grid", "project-board", "profile", "featured-project", "collection-tiles", "hero", "video", "collection-projects", "featured-projects"]);
const CROP_KEYS = new Set(["mediaId", "backgroundMediaId", "portraitMediaId"]);
const TEXT_KEYS: Record<string, string> = { eyebrow: "text_eyebrow", title: "text_title", intro: "text_intro", caption: "text_caption", cta: "text_cta", "site.name": "text_siteName", "site.role": "text_siteRole", portraitCaption: "text_portraitCaption", submit: "text_submit" };

function Segmented<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
  auto,
  help,
}: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T | undefined) => void;
  auto?: string | null;
  help?: string;
}) {
  const t = useTranslations("editorPanelsLook");
  const autoLabel = auto === undefined ? t("auto") : auto;
  return (
    <div className="lp-field" role="group" aria-label={label}>
      <span className="lp-label">{label}</span>
      <div className="a-seg lp-seg">
        {autoLabel !== null && (
          <button type="button" aria-pressed={value === undefined} onClick={() => onChange(undefined)} title={t("themeValue")}>
            {autoLabel}
          </button>
        )}
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}>
            {labels[o]}
          </button>
        ))}
      </div>
      {help && <p className="lp-help">{help}</p>}
    </div>
  );
}

const textLabel = (t: AdminT, k: string) => (Object.hasOwn(TEXT_KEYS, k) ? t(TEXT_KEYS[k]) : k.startsWith("paragraphs.") ? t("text_paragraph", { n: Number(k.split(".")[1]) + 1 }) : k);

/**
 * Taille et place d'une image seule (lot 40), en HAUT du panneau d'une image (page ou planche) : les mêmes réglages que le bouton
 * « Taille » de la barre (`look.imageSize`, `look.imageAlign`). Normale = le plafond de hauteur d'avant.
 */
export function ImageSizeSection({ look, onChange }: { look: Look; onChange: (next: Look) => void }) {
  const t = useTranslations("editorPanelsLook");
  const set = (patch: Partial<Look>) => onChange({ ...look, ...patch });
  return (
    <section className="lp lp-image-size" aria-label={t("imageSizeAria")} data-testid="image-size-section">
      <h3 className="lp-title">{t("imageSizeTitle")}</h3>
      <Segmented
        label={t("size")}
        value={look.imageSize ?? "normal"}
        options={["normal", "large"] as const}
        labels={{ normal: t("sizeNormal"), large: t("sizeLarge") }}
        onChange={(v) => set({ imageSize: v === "large" ? "large" : undefined })}
        auto={null}
        help={t("sizeHelp")}
      />
      <Segmented label={t("align")} value={look.imageAlign ?? "center"} options={IMAGE_ALIGNS} labels={IMAGE_ALIGN_LABELS} onChange={(v) => set({ imageAlign: v })} auto={null} help={t("alignHelp")} />
    </section>
  );
}

/** Espace au-dessus d'un composant sans panneau de mise en page (la bande d'images d'une planche, lot 40). */
export function SpaceTopSection({ look, onChange }: { look: Look; onChange: (next: Look) => void }) {
  const t = useTranslations("editorPanelsLook");
  return (
    <section className="lp" aria-label={t("spaceAbove")} data-testid="space-top-section">
      <h3 className="lp-title">{t("layout")}</h3>
      <SpaceSlider label={t("spaceAbove")} testId="lp-spaceTop" value={look.spaceTop} onChange={(v) => onChange({ ...look, spaceTop: v })} />
    </section>
  );
}

export function BlockLookPanel({ type, look, inCell, onChange }: { type: string; look: Look; inCell: boolean; onChange: (next: Look) => void }) {
  const t = useTranslations("editorPanelsLook");
  const set = (patch: Partial<Look>) => onChange({ ...look, ...patch });
  const texts = Object.keys(look.text ?? {});
  const crops = Object.keys(look.crop ?? {});
  const tileCrops = Object.keys(look.tileCrop ?? {}) as TileKey[];
  const vertical = type === "hero" || inCell;
  return (
    <section className="lp" aria-labelledby="lp-title">
      <h3 id="lp-title" className="lp-title">
        {t("layout")}
      </h3>
      <p className="lp-help">{t("alsoOnPage")}</p>
      {type !== "hero" && !inCell && (
        <div data-testid="outer-margin-section">
          <p className="lp-help">{t("outerHelp")}</p>
          <WidthSlider label={t("blockWidth")} testId="lp-width" value={look.width} onChange={(v) => set({ width: v })} />
          <SpaceSlider label={t("marginTop")} testId="lp-marginTop" value={look.marginTop} onChange={(v) => set({ marginTop: v })} />
          <SpaceSlider label={t("marginBottom")} testId="lp-marginBottom" value={look.marginBottom} onChange={(v) => set({ marginBottom: v })} />
        </div>
      )}
      {type !== "hero" && (
        <>
          <SpaceSlider label={t("spaceAbove")} testId="lp-spaceTop" value={look.spaceTop} onChange={(v) => set({ spaceTop: v })} />
          <SpaceSlider label={t("spaceBelow")} testId="lp-spaceBottom" value={look.spaceBottom} onChange={(v) => set({ spaceBottom: v })} />
          <SidesSlider label={t("padSides")} testId="lp-spaceSides" value={look.spaceSides} onChange={(v) => set({ spaceSides: v })} />
          {!inCell && <SpaceSlider label={t("padTop")} testId="lp-padTop" value={look.padTop} onChange={(v) => set({ padTop: v })} />}
          {!inCell && <SpaceSlider label={t("padBottom")} testId="lp-padBottom" value={look.padBottom} onChange={(v) => set({ padBottom: v })} />}
        </>
      )}
      {MEDIA_TYPES.has(type) && (
        <Segmented label={t("imageCorners")} value={look.radius} options={RADII} labels={RADIUS_LABELS} onChange={(v) => set({ radius: v })} help={t("cornersHelp")} />
      )}
      {TITLE_TYPES.has(type) && type === "hero" && (
        <p className="lp-help" data-testid="hero-position-hint">{t("heroHint")}</p>
      )}
      {TITLE_TYPES.has(type) && type !== "hero" && (
        <>
          <Segmented
            label={t("titleAlign")}
            value={look.titleH}
            options={["left", "center", "right"] as const}
            labels={{ left: t("left"), center: t("center"), right: t("right") }}
            onChange={(v) => set({ titleH: v === "left" ? undefined : v })}
            auto={null}
          />
          {vertical && (
            <Segmented
              label={t("titleHeight")}
              value={look.titleV ?? (type === "hero" ? "bottom" : "top")}
              options={["top", "middle", "bottom"] as const}
              labels={{ top: t("top"), middle: t("middle"), bottom: t("bottom") }}
              onChange={(v) => set({ titleV: v === (type === "hero" ? "bottom" : "top") ? undefined : v })}
              auto={null}
            />
          )}
        </>
      )}
      {(crops.length > 0 || tileCrops.length > 0) && (
        <div className="lp-field">
          <span className="lp-label">{t("crops")}</span>
          <ul className="lp-list">
            {crops.map((k) => (
              <li key={k}>
                {CROP_KEYS.has(k) ? t(`crop_${k}`) : k} · {look.crop![k as "mediaId"]!.rect ? t("cropFree") : t("cropZoom", { percent: Math.round((look.crop![k as "mediaId"]!.zoom ?? 1) * 100) })}
                <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => { const crop = { ...look.crop }; delete crop[k as "mediaId"]; set({ crop }); }}>
                  {look.crop![k as "mediaId"]!.rect ? t("wholeImage") : t("recenter")}
                </button>
              </li>
            ))}
            {tileCrops.map((k) => (
              <li key={`tile-${k}`}>
                {t("tile", { name: t(`tile_${k}`) })} · {look.tileCrop![k]!.rect ? t("cropFree") : t("cropZoom", { percent: Math.round((look.tileCrop![k]!.zoom ?? 1) * 100) })}
                <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => { const tileCrop = { ...look.tileCrop }; delete tileCrop[k]; set({ tileCrop }); }}>
                  {look.tileCrop![k]!.rect ? t("wholeImage") : t("recenter")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {texts.length > 0 && (
        <div className="lp-field">
          <span className="lp-label">{t("customTexts")}</span>
          <ul className="lp-list">
            {texts.map((k) => (
              <li key={k}>
                {textLabel(t, k)}
                <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => { const text = { ...look.text }; delete text[k]; set({ text }); }}>
                  {t("backGlobal")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function SiteStylesPanel({
  styles,
  onChange,
  palette,
  installed,
  cardPalette,
}: {
  styles: SiteStyles | undefined;
  onChange: (next: SiteStyles) => void;
  palette: Record<PaletteColor, string>;
  /** Palette effective du site : couleurs du fond de texte et lisibilité. */
  cardPalette: CardPalette;
  installed: string[];
}) {
  const t = useTranslations("editorPanelsLook");
  const [open, setOpen] = useState<Role | null>(null);
  const roles = styles?.roles ?? {};
  const setRole = (role: Role, style: TextStyle | undefined) => {
    const next = { ...roles };
    if (style) next[role] = style;
    else delete next[role];
    onChange({ ...styles, roles: next });
  };
  return (
    <section className="lp lp-site" aria-labelledby="lp-site-title">
      <h3 id="lp-site-title" className="lp-title">
        {t("siteStyles")}
      </h3>
      <p className="lp-help">{t("siteStylesHelp")}</p>
      <Segmented label={t("cornersCards")} value={styles?.radius} options={RADII} labels={RADIUS_LABELS} onChange={(v) => onChange({ ...styles, radius: v })} auto={t("theme")} />
      <ul className="lp-roles">
        {ROLES.map((role) => {
          const set = Object.keys(roles[role] ?? {}).length > 0;
          return (
            <li key={role} data-open={open === role || undefined}>
              <button type="button" className="lp-role" aria-expanded={open === role} onClick={() => setOpen(open === role ? null : role)}>
                <span>{ROLE_LABELS[role]}</span>
                <small>{set ? t("custom") : t("themeLower")}</small>
              </button>
              {open === role && (
                <div className="lp-role-body">
                  <TypoControls value={roles[role] ?? {}} onChange={(s) => setRole(role, s)} installed={installed} swatch={(c) => palette[c]} resetLabel={t("backTheme")} palette={cardPalette} backdropBlocked={BACKDROP_BLOCKED[role]} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
