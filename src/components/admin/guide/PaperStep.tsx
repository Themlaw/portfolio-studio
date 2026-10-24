"use client";

/**
 * Étape 4 « Papier et motifs » (lot 61) : le fond du site (uni, papier pointillé, papier dessiné dans Photoshop, ou « Mon papier
 * peint »), les espacements en trois niveaux (Serré, Normal, Aéré) et, dans un second onglet, la bibliothèque des papiers peints
 * (la même que la page « Papiers peints » du menu, lot 78 : un lien y mène).
 *
 * Les espacements simplifiés ne remplacent rien à l'ouverture : les valeurs précises du thème sont gardées et le niveau le plus
 * proche est marqué ; seul un clic sur un niveau écrit ses valeurs (src/themes/guided.ts).
 */
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { applySpaceLevel, PAGE_MAX_STANDARD, px, SPACE_LEVELS, spaceLevelOf } from "@/themes/guided";
import type { KitAssets, Theme } from "@/themes/schema";

import PaperSettings from "../PaperSettings";
import { VARIANT_LABELS, VARIANT_THUMBS } from "../VariantThumb";
import { Advanced, clampMax, Levels, Slider } from "./controls";

export type PaperTab = "fond" | "papiers-peints";

export default function PaperStep({
  theme,
  locked,
  setTheme,
  setTokens,
  tab,
  onTab,
  wallpapers,
}: {
  theme: Theme;
  /** Thème livré : le fond ne se règle pas (les papiers peints, eux, ne dépendent pas du thème). */
  locked: ReactNode | null;
  setTheme: (fn: (t: Theme) => Theme) => void;
  setTokens: <K extends keyof Theme["tokens"]>(k: K, v: Partial<Theme["tokens"][K]>) => void;
  tab: PaperTab;
  onTab: (t: PaperTab) => void;
  /** Bibliothèque des papiers peints (composant serveur de la page, passé tel quel). */
  wallpapers: ReactNode;
}) {
  const id = useId();
  const space = spaceLevelOf(theme.tokens.space);
  const texture = VARIANT_LABELS.texture;
  const standardMax = theme.tokens.space.pageMax === PAGE_MAX_STANDARD;
  return (
    <>
      <div className="a-tabs a-subtabs" role="tablist" aria-label="Papier et motifs">
        <button type="button" role="tab" id={`${id}-fond`} aria-selected={tab === "fond"} aria-controls={`${id}-fond-p`} data-testid="paper-tab-fond" onClick={() => onTab("fond")}>
          Fond et espacements
        </button>
        <button type="button" role="tab" id={`${id}-wp`} aria-selected={tab === "papiers-peints"} aria-controls={`${id}-wp-p`} data-testid="paper-tab-wallpapers" onClick={() => onTab("papiers-peints")}>
          Mes papiers peints
        </button>
      </div>

      <div role="tabpanel" id={`${id}-fond-p`} aria-labelledby={`${id}-fond`} hidden={tab !== "fond"}>
        {locked ?? (
          <>
            <p className="a-help a-step-intro">Choisis le fond de tes pages, puis l&apos;air entre les blocs.</p>
            <section className="a-guide-block" aria-labelledby="t-papier-fond">
              <h3 id="t-papier-fond" className="a-subhead">
                {texture.title}
              </h3>
              <p className="a-help">{texture.help}</p>
              <div className="a-variant-grid">
                {Object.entries(texture.options).map(([opt, label]) => (
                  <label key={opt} className="a-variant-choice">
                    <input
                      type="radio"
                      name="variant-texture"
                      checked={theme.variants.texture === opt}
                      onChange={() => setTheme((t) => ({ ...t, variants: { ...t.variants, texture: opt as Theme["variants"]["texture"] } }))}
                    />
                    {VARIANT_THUMBS.texture[opt]}
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="a-notice a-wp-hint" data-testid="wallpaper-hint">
                <p>
                  <strong>Mon papier peint</strong> : tes motifs dessinés, à répéter derrière une page, un grand bloc ou les cartes. Ils se choisissent depuis la page, le bloc ou la carte concernés.{" "}
                  <button type="button" className="a-link-btn" data-testid="open-wallpapers" onClick={() => onTab("papiers-peints")}>
                    Ouvrir mes papiers peints
                  </button>
                </p>
              </div>
            </section>
            {theme.assets.kit?.paper ? (
              <PaperSettings theme={theme} onChange={(kit: KitAssets) => setTheme((t) => ({ ...t, assets: { ...t.assets, kit } }))} />
            ) : (
              <p className="a-help" data-testid="paper-draw-hint">
                Tu peux aussi dessiner ton propre papier dans Photoshop (« Dessiner dans Photoshop », en haut de la page) : il apparaîtra ici avec ses réglages.
              </p>
            )}
            <section className="a-guide-block" aria-labelledby="t-espaces" data-testid="space-block" data-exact={space.exact}>
              <h3 id="t-espaces" className="a-subhead">
                Espacements
              </h3>
              <p className="a-help">L&apos;air entre les sections et sur les côtés des pages.</p>
              <Levels
                label="Espacements"
                levels={SPACE_LEVELS}
                current={space.exact ? space.index : null}
                testId="space-level"
                onPick={(i) => setTheme((t) => ({ ...t, tokens: { ...t.tokens, space: applySpaceLevel(t.tokens.space, i) } }))}
              />
              <p className="a-help" data-testid="space-note">
                {space.exact
                  ? `Espacement « ${SPACE_LEVELS[space.index].label} ».`
                  : `Ce thème a des espacements précis (affinés ci-dessous), proches de « ${SPACE_LEVELS[space.index].label} ». Ils sont gardés tels quels : choisis un niveau pour les remplacer.`}
              </p>
            </section>
            <Advanced id="papier" count={(space.exact ? 0 : 1) + (standardMax ? 0 : 1)} hint="Les espacements en rem et la largeur maximale du contenu.">
              <Slider
                label="Entre les sections"
                help="Sur grand écran ; réduit de moitié sur mobile."
                min={5}
                max={12}
                step={0.5}
                unit="rem"
                value={clampMax(theme.tokens.space.sectionGap)}
                onChange={(v) => setTokens("space", { sectionGap: `clamp(${v / 2}rem, 10vw, ${v}rem)` })}
              />
              <Slider label="Marges latérales" min={2} max={5} step={0.25} unit="rem" value={clampMax(theme.tokens.space.gutter)} onChange={(v) => setTokens("space", { gutter: `clamp(1.25rem, 5vw, ${v}rem)` })} />
              <Slider label="Largeur maximale du contenu" min={960} max={1600} step={20} unit="px" value={px(theme.tokens.space.pageMax)} onChange={(v) => setTokens("space", { pageMax: `${v}px` })} />
            </Advanced>
          </>
        )}
      </div>

      <div role="tabpanel" id={`${id}-wp-p`} aria-labelledby={`${id}-wp`} hidden={tab !== "papiers-peints"}>
        <p>
          <Link href="/admin/papiers-peints" className="a-link-btn" data-testid="manage-wallpapers">
            Gérer la bibliothèque
          </Link>
        </p>
        {wallpapers}
      </div>
    </>
  );
}
