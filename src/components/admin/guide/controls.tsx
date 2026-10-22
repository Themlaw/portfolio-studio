"use client";

/**
 * Petits contrôles de l'éditeur de thème guidé (lot 61) : réglette, « Affiner (avancé) » repliable avec son compteur de réglages
 * modifiés, choix à boutons.
 */
import { useId, type ReactNode } from "react";

export function Slider({
  label,
  help,
  min,
  max,
  step,
  value,
  unit,
  onChange,
}: {
  label: string;
  help?: string;
  min: number;
  max: number;
  step: number;
  value: number | null;
  unit: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const v = value ?? min;
  return (
    <div className="a-field a-slider">
      <label htmlFor={id}>
        {label}
        <output htmlFor={id} className="mono">
          {value === null ? "personnalisé" : `${v}${unit}`}
        </output>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={v} onChange={(e) => onChange(Number(e.target.value))} />
      {help && <p className="a-help">{help}</p>}
    </div>
  );
}

export const clampMax = (v: string): number | null => {
  const m = /^clamp\(([\d.]+)rem,\s*(\d+)vw,\s*([\d.]+)rem\)$/.exec(v);
  return m ? parseFloat(m[3]) : null;
};

/** « 3 réglages modifiés » : ce que l'artiste a écarté du réglage standard ou du calcul automatique. */
export const countLabel = (n: number) => (n === 0 ? "aucun réglage modifié" : n === 1 ? "1 réglage modifié" : `${n} réglages modifiés`);

/** Réglages avancés d'une étape : replié par défaut, avec le compteur de ce qui s'écarte du standard. */
export function Advanced({ id, count, hint, children, title = "Affiner (avancé)" }: { id: string; count: number; hint?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <details className="a-adv" data-testid={`adv-${id}`}>
      <summary>
        <span className="a-adv-title">{title}</span>
        <span className="a-adv-count" data-count={count} data-testid={`adv-${id}-count`}>
          {countLabel(count)}
        </span>
      </summary>
      <div className="a-adv-body">
        {hint && <p className="a-help">{hint}</p>}
        {children}
      </div>
    </details>
  );
}

/** Choix parmi quelques crans (boutons exclusifs). `current` : le cran marqué (absent : aucun, réglage précis conservé). */
export function Levels({
  label,
  levels,
  current,
  onPick,
  testId,
}: {
  label: string;
  levels: readonly { id: string; label: string }[];
  current: number | null;
  onPick: (index: number) => void;
  testId: string;
}) {
  return (
    <div className="a-seg a-levels" role="group" aria-label={label} data-testid={testId}>
      {levels.map((l, i) => (
        <button key={l.id} type="button" aria-pressed={current === i} data-level={l.id} onClick={() => onPick(i)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
