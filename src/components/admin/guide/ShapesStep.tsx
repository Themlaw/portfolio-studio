"use client";

/**
 * Étape 3 « Cartes et cadres » (lot 61) : les formes à vignettes (en-tête, ouverture de l'accueil, bandes de planches, légendes,
 * visionneuse), UN réglage « Arrondi » (de carré à très rond) à la place des quatre curseurs et du choix des boutons, puis les cartes
 * des rubriques (largeur, coins, bordure).
 *
 * L'arrondi simplifié ne remplace rien à l'ouverture : un thème aux rayons précis (5 px, 9 px…) garde ses valeurs et affiche le cran le
 * plus proche ; seul un clic sur un cran écrit les rayons de ce cran (src/themes/guided.ts). Les curseurs précis et la forme des
 * boutons restent sous « Affiner (avancé) ».
 */
import { useTranslations } from "next-intl";

import type { SitePalette } from "@/lib/look";
import { applyRoundLevel, px, ROUND_LEVELS, roundLevelOf } from "@/themes/guided";
import type { Theme } from "@/themes/schema";

import CardSettings from "../CardSettings";
import { variantLabels, VARIANT_THUMBS } from "../VariantThumb";
import { Advanced, Levels, Slider } from "./controls";

/** Formes à vignettes de cette étape : les boutons (dérivés de l'arrondi) et la texture du fond (étape 4) n'y sont pas. */
const SHAPE_KEYS = ["header", "hero", "strip", "caption", "lightbox"] as const;

export default function ShapesStep({
  theme,
  sitePalette,
  setTheme,
  setTokens,
}: {
  theme: Theme;
  sitePalette: SitePalette;
  setTheme: (fn: (t: Theme) => Theme) => void;
  setTokens: <K extends keyof Theme["tokens"]>(k: K, v: Partial<Theme["tokens"][K]>) => void;
}) {
  const t = useTranslations("guide");
  const labels = variantLabels(useTranslations("variants"));
  const round = roundLevelOf(theme.tokens.radius, theme.variants.button);
  const r = theme.tokens.radius;
  const buttonKey = "button" as const;
  const meta = labels[buttonKey];
  return (
    <>
      <p className="a-help a-step-intro">{t("shapesIntro")}</p>
      <section aria-labelledby="t-formes" className="a-guide-block">
        <h3 id="t-formes" className="a-subhead">
          {t("shapes")}
        </h3>
        {SHAPE_KEYS.map((key) => {
          const m = labels[key];
          return (
            <fieldset key={key} className="a-fieldset">
              <legend>{m.title}</legend>
              <p className="a-help">{m.help}</p>
              <div className="a-variant-grid">
                {Object.entries(m.options).map(([opt, label]) => (
                  <label key={opt} className="a-variant-choice">
                    <input
                      type="radio"
                      name={`variant-${key}`}
                      checked={theme.variants[key] === opt}
                      onChange={() => setTheme((t) => ({ ...t, variants: { ...t.variants, [key]: opt } }))}
                    />
                    {VARIANT_THUMBS[key][opt]}
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
        {theme.variants.hero === "parallax-layers" && !theme.assets.heroLayers?.length && !theme.assets.kit?.plans?.length && (
          <p className="a-help">{t("noLayers")}</p>
        )}
      </section>

      <section aria-labelledby="t-arrondi" className="a-guide-block" data-testid="round-block" data-exact={round.exact}>
        <h3 id="t-arrondi" className="a-subhead">
          {t("round")}
        </h3>
        <p className="a-help">{t("roundHelp")}</p>
        <div className="a-round-demo" aria-hidden="true" style={{ ["--rd-sm" as string]: r.sm, ["--rd-md" as string]: r.md, ["--rd-lg" as string]: r.lg, ["--rd-btn" as string]: theme.variants.button === "pill" ? r.btn : r.sm }}>
          <span className="a-round-btn">{t("demoButton")}</span>
          <span className="a-round-card">{t("demoCard")}</span>
          <span className="a-round-block">{t("demoBlock")}</span>
        </div>
        <Levels
          label={t("round")}
          levels={ROUND_LEVELS}
          current={round.exact ? round.index : null}
          testId="round-level"
          onPick={(i) => {
            const next = applyRoundLevel(i);
            setTheme((t) => ({ ...t, tokens: { ...t.tokens, radius: next.radius }, variants: { ...t.variants, button: next.button } }));
          }}
        />
        <p className="a-help" data-testid="round-note">
          {round.exact
            ? t("roundExact", { label: ROUND_LEVELS[round.index].label })
            : t("roundPrecise", { label: ROUND_LEVELS[round.index].label })}
        </p>
      </section>

      <CardSettings
        theme={theme}
        sitePalette={sitePalette}
        onChange={(card) =>
          setTheme((t) => {
            const layout = { ...t.tokens.layout };
            if (card) layout.card = card;
            else delete layout.card;
            const tokens = { ...t.tokens };
            if (Object.keys(layout).length) tokens.layout = layout;
            else delete tokens.layout;
            return { ...t, tokens };
          })
        }
      />

      <Advanced id="cartes" count={round.exact ? 0 : 1} hint={t("roundAdvancedHint")}>
        {(
          [
            ["sm", "small", 0, 16],
            ["md", "cards", 0, 32],
            ["lg", "bigBlocks", 0, 40],
            ["strip", "stripImages", 0, 16],
          ] as const
        ).map(([k, label, min, max]) => (
          <Slider key={k} label={t(`radius.${label}`)} min={min} max={max} step={1} unit="px" value={px(r[k])} onChange={(v) => setTokens("radius", { [k]: `${v}px` })} />
        ))}
        <fieldset className="a-fieldset">
          <legend>{meta.title}</legend>
          <p className="a-help">{meta.help}</p>
          <div className="a-variant-grid">
            {Object.entries(meta.options).map(([opt, label]) => (
              <label key={opt} className="a-variant-choice">
                <input type="radio" name="variant-button" checked={theme.variants.button === opt} onChange={() => setTheme((t) => ({ ...t, variants: { ...t.variants, button: opt as Theme["variants"]["button"] } }))} />
                {VARIANT_THUMBS.button[opt]}
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </Advanced>
    </>
  );
}
