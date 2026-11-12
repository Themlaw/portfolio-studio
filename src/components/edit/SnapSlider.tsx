"use client";

/**
 * Curseur à crans aimantés (lot 108), le MÊME partout (barre du bloc, panneau « Mise en page ») pour la largeur, la marge extérieure et l'espacement intérieur.
 * Un curseur continu (clavier : flèches = 1, PageHaut / PageBas = 10 ; `fill` d'un test) dont la valeur colle aux crans repères proches.
 * Collée à un cran, la valeur écrite est le NOM du cran (les anciennes données restent lues et réécrites à l'identique) ; sinon un nombre.
 * Le bouton de chaque cran saute dessus ; « Auto » retire le réglage (valeur du thème). Le réglage part au relâchement (évènement `change`).
 */
import { useTranslations } from "next-intl";
import { useState } from "react";

export type SnapStop<V> = { at: number; label: string; short?: string; key: string; value: V };

export default function SnapSlider<V extends string | number>({
  label,
  testId,
  min,
  max,
  unit,
  stops,
  value,
  autoLabel = "Auto",
  autoAt,
  maxIsAuto = false,
  snap,
  attr,
  prefix = "",
  autoKey = "auto",
  onCommit,
}: {
  label: string;
  testId: string;
  min: number;
  max: number;
  unit: string;
  stops: readonly SnapStop<V>[];
  /** Valeur écrite (nom de cran ou nombre) ; undefined = pas de réglage (Auto / valeur du thème). */
  value: V | undefined;
  autoLabel?: string;
  /** Place du curseur quand rien n'est écrit (défaut : le minimum). */
  autoAt?: number;
  /** Le maximum du curseur EST « Auto » (largeur pleine) : l'atteindre efface le réglage. */
  maxIsAuto?: boolean;
  snap: number;
  /** Attribut des boutons de cran (repère des tests et des anciennes suites) : `attr`=`prefix``clé`; Auto : `autoKey`. */
  attr?: string;
  prefix?: string;
  autoKey?: string;
  onCommit: (v: V | undefined) => void;
}) {
  const stopOf = (v: V) => stops.find((s) => s.value === v);
  const posOf = (v: V | undefined): number => (typeof v === "number" ? v : (stopOf(v as V)?.at ?? autoAt ?? min));
  const [live, setLive] = useState<number>(posOf(value));
  // La valeur écrite change (annuler, autre bloc, cran cliqué) : le curseur la suit (état dérivé, sans effet).
  const [seen, setSeen] = useState<V | undefined>(value);
  if (seen !== value) {
    setSeen(value);
    setLive(posOf(value));
  }
  const near = (n: number) => stops.reduce<SnapStop<V> | undefined>((best, s) => (Math.abs(s.at - n) <= snap && (!best || Math.abs(s.at - n) < Math.abs(best.at - n)) ? s : best), undefined);
  // Clavier : une flèche avance d'un pas et ne colle pas aux crans voisins (sinon on ne quitterait jamais un cran) ; seul un cran atteint pile s'écrit par son nom.
  const t = useTranslations("editMenusSnap");
  const [keys, setKeys] = useState(false);
  const nearK = (n: number) => (keys ? stops.find((s) => s.at === n) : near(n));
  const resolve = (n: number): V | undefined => {
    const s = nearK(n);
    if (s) return s.value;
    return maxIsAuto && n >= max ? undefined : (Math.round(n) as V);
  };
  const onInput = (n: number) => setLive(nearK(n)?.at ?? n);
  const commit = (n: number) => onCommit(resolve(n));
  const current = value === undefined ? undefined : (stopOf(value)?.label ?? `${value} ${unit}`);
  const shown = value === undefined && live === posOf(undefined) ? autoLabel : (near(live)?.label ?? (maxIsAuto && live >= max ? autoLabel : `${Math.round(live)} ${unit}`));
  return (
    <div className="snap" data-testid={testId} role="group" aria-label={label}>
      <div className="snap-head">
        <span className="sm-label snap-label">{label}</span>
        <output className="snap-value" data-snap-value="" aria-live="polite">
          {current ?? autoLabel}
        </output>
        <button type="button" role="radio" className="snap-auto" data-snap="auto" {...(attr ? { [attr]: `${prefix}${autoKey}` } : {})} aria-checked={value === undefined} title={t("themeValue")} onClick={() => onCommit(undefined)}>
          {autoLabel}
        </button>
      </div>
      <input
        type="range"
        className="snap-range"
        data-snap-range=""
        min={min}
        max={max}
        step={1}
        value={Math.round(live)}
        aria-label={label}
        aria-valuetext={shown}
        onKeyDown={() => setKeys(true)}
        onBlur={() => setKeys(false)}
        onPointerDown={() => setKeys(false)}
        onChange={(e) => {
          const n = Number(e.currentTarget.value);
          onInput(n);
          // `change` natif = relâchement (pointeur) ou une frappe de touche : le réglage part alors.
          commit(n);
        }}
      />
      <span className="snap-stops" role="radiogroup" aria-label={`${label} : crans`}>
        {stops.map((s) => (
          <button key={s.key} type="button" role="radio" className="snap-tick" data-snap={s.key} {...(attr ? { [attr]: `${prefix}${s.key}` } : {})} aria-checked={value === s.value} title={s.label} onClick={() => onCommit(s.value)}>
            {s.short ?? s.label}
          </button>
        ))}
      </span>
    </div>
  );
}
