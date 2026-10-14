"use client";

/**
 * « Cartes des rubriques » d'un thème (lot 17c) : couleur, largeur et coins que prend une rubrique quand on
 * active sa carte sans rien choisir (bouton « Carte » sur la page). Stocké dans `tokens.layout.card` ; ne change
 * rien aux rubriques sans carte ni aux thèmes livrés. Une carte qui garde un texte illisible est signalée.
 */
import CardColorChoices from "@/components/edit/CardColorChoices";
import type { SitePalette } from "@/lib/look";
import { effectiveSitePalette } from "@/themes/site-palette";
import type { Theme } from "@/themes/schema";
import {
  cardStyle,
  isSurfaceToken,
  resolveSurface,
  SURFACE_CORNER_LABELS,
  SURFACE_CORNERS,
  SURFACE_TOKEN_LABELS,
  SURFACE_WIDTH_LABELS,
  SURFACE_WIDTHS,
  cardBackground,
  type Surface,
} from "@/themes/surface";

export default function CardSettings({ theme, onChange, sitePalette }: { theme: Theme; onChange: (card: Surface | undefined) => void; sitePalette?: SitePalette }) {
  const card = theme.tokens.layout?.card;
  // Couleurs de la DA du thème, palette du site comprise quand le thème est en ligne (ce que verront les visiteurs).
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
      <h2 id="t-cartes">Cartes des rubriques</h2>
      <p className="a-help">
        Une rubrique peut être posée sur une carte colorée (bouton « Carte » sur la page). Voici ce qu&apos;elle prend quand on active la carte sans
        rien choisir de plus. Les rubriques sans carte ne changent pas.
      </p>
      <div className="a-field">
        <span className="a-label-text" id="t-carte-couleur">
          Couleur par défaut
        </span>
        <CardColorChoices palette={palette} value={resolved.color} onPick={(t) => set({ color: t })} />
        <div className="a-color-row" role="group" aria-labelledby="t-carte-couleur">
          <input
            type="color"
            aria-label="Autre couleur"
            title="Autre couleur"
            value={custom ? resolved.color.slice(0, 7) : cardBackground(resolved.color, palette).slice(0, 7)}
            onChange={(e) => set({ color: e.target.value.toLowerCase() })}
          />
        </div>
        <p className="a-help">
          {SURFACE_TOKEN_LABELS[resolved.color as keyof typeof SURFACE_TOKEN_LABELS] ?? `Couleur libre ${resolved.color}`}. Une couleur de la DA ou une teinte douce suit les changements de palette.{" "}
          {style.ok ? "Le texte se lit bien sur cette carte." : `Le texte se lit mal sur cette couleur (${style.ratio.toFixed(1).replace(".", ",")}:1, il faut 4,5:1).`}
        </p>
      </div>
      <div className="a-field">
        <span className="a-label-text">Largeur</span>
        <div className="a-seg" role="group" aria-label="Largeur par défaut">
          {SURFACE_WIDTHS.map((w) => (
            <button key={w} type="button" aria-pressed={resolved.width === w} onClick={() => set({ width: w })}>
              {SURFACE_WIDTH_LABELS[w]}
            </button>
          ))}
        </div>
      </div>
      <div className="a-field">
        <span className="a-label-text">Coins</span>
        <div className="a-seg" role="group" aria-label="Coins par défaut">
          {SURFACE_CORNERS.map((c) => (
            <button key={c} type="button" aria-pressed={resolved.corners === c} onClick={() => set({ corners: c })}>
              {SURFACE_CORNER_LABELS[c]}
            </button>
          ))}
        </div>
      </div>
      {card && (
        <button type="button" className="a-btn a-btn-quiet" onClick={() => onChange(undefined)}>
          Revenir aux réglages d&apos;origine
        </button>
      )}
    </section>
  );
}
