"use client";

/**
 * Couleurs proposées pour le fond d'une carte (lot 19b), partagées par le popover « Carte » de la toile
 * (SurfaceMenu) et « Cartes des rubriques » de l'éditeur de thème (CardSettings) :
 *
 * 1. les couleurs de la DA du thème actif, palette du site comprise, chacune avec son nom (celui du panneau
 *    « Couleurs ») ;
 * 2. une rangée de teintes douces dérivées de chaque couleur (12 % et 25 % mélangés au fond de page).
 *
 * Un choix s'enregistre comme JETON (`primary`, `primary12`…), jamais comme hex : carte et teintes suivent un
 * changement de palette. Les pastilles montrent les couleurs calculées sur `palette`, jamais en dur.
 */
import {
  cardBackground,
  SURFACE_DA_NAMES,
  SURFACE_DA_TOKENS,
  SURFACE_TINT_BASES,
  SURFACE_TINT_PERCENTS,
  SURFACE_TOKEN_LABELS,
  type CardPalette,
  type SurfaceToken,
} from "@/themes/surface";

import "@/app/admin/card-colors.css";

const TINTS: SurfaceToken[] = SURFACE_TINT_BASES.flatMap((b) => SURFACE_TINT_PERCENTS.map((n) => `${b}${n}` as SurfaceToken));

/** `value` vide : aucun choix (« Auto » chez l'appelant). `label` : nom du groupe, selon ce qu'on colore. */
export default function CardColorChoices({ palette, value, onPick, label = "Couleur de la carte" }: { palette: CardPalette; value: string; onPick: (token: SurfaceToken) => void; label?: string }) {
  const current = !value ? "Auto : couleur du thème" : ((SURFACE_TOKEN_LABELS as Record<string, string>)[value] ?? `Couleur libre ${value}`);
  return (
    <div className="cc" data-testid="card-colors">
      <div className="cc-da" role="radiogroup" aria-label={label}>
        {SURFACE_DA_TOKENS.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={value === t}
            className="cc-da-item"
            data-token={t}
            data-testid="card-da-color"
            title={SURFACE_DA_NAMES[t]}
            onClick={() => onPick(t)}
          >
            <span className="cc-chip" style={{ background: cardBackground(t, palette) }} aria-hidden="true" />
            <span className="cc-name">{SURFACE_DA_NAMES[t]}</span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={value === "bgDeep"}
          className="cc-da-item"
          data-token="bgDeep"
          title={SURFACE_TOKEN_LABELS.bgDeep}
          onClick={() => onPick("bgDeep")}
        >
          <span className="cc-chip" style={{ background: cardBackground("bgDeep", palette) }} aria-hidden="true" />
          <span className="cc-name">{SURFACE_TOKEN_LABELS.bgDeep}</span>
        </button>
      </div>
      <p className="cc-sub" id="cc-tints-label">
        Teintes douces
      </p>
      <div className="cc-tints" role="radiogroup" aria-labelledby="cc-tints-label" data-testid="card-tints">
        {TINTS.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={value === t}
            className="cc-tint"
            data-token={t}
            data-testid="card-tint"
            title={SURFACE_TOKEN_LABELS[t]}
            aria-label={SURFACE_TOKEN_LABELS[t]}
            style={{ background: cardBackground(t, palette) }}
            onClick={() => onPick(t)}
          />
        ))}
      </div>
      <p className="cc-current" aria-live="polite" data-testid="card-color-name">
        {current}
      </p>
    </div>
  );
}
