"use client";

import { accentProblem, nearestAccent } from "@/themes/contrast";
import { ROLE_NAMES } from "@/themes/palette";

import { Field, Toggle } from "./index";

/**
 * Réglage de page (lot 26) : une autre couleur pour « Boutons et liens » sur CETTE page seulement (l'ancien « Accent de la
 * page », `draft.accent`). Même nom que le rôle du site (`ROLE_NAMES.primary`), et même place dans l'éditeur visuel et dans le
 * formulaire de la page : avec les autres réglages de la page. Contraste AA contrôlé en direct ; `colors` = couleurs du site
 * (fonds, texte des boutons) ; `savedValue` = la couleur enregistrée (signalée si elle est devenue illisible).
 */
export default function PageButtonsColorField({
  value,
  onChange,
  colors,
  savedValue,
  error,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  colors: { bg: string; bgDeep: string; surface: string; onPrimary: string; primary: string } | null;
  savedValue?: string | null;
  error?: string;
}) {
  const issue = value && colors ? accentProblem(value, colors) : null;
  const fix = value && colors && issue ? nearestAccent(value, colors) : null;
  const savedIgnored = Boolean(savedValue && colors && accentProblem(savedValue, colors));
  return (
    <div className="a-span-2 a-page-buttons-color" data-testid="page-buttons-color">
      <Toggle
        label={`${ROLE_NAMES.primary} de cette page`}
        help={`Une autre couleur pour les boutons et les liens de cette page seulement. Les autres pages gardent la couleur « ${ROLE_NAMES.primary} » du site.`}
        checked={value !== null}
        onChange={(on) => onChange(on && colors ? colors.primary : null)}
      />
      {savedIgnored && (
        <p className="a-notice" role="status">
          Cette couleur n&apos;est plus lisible avec le thème en ligne : elle est ignorée.
        </p>
      )}
      {value !== null && (
        <Field label="Couleur" error={issue ?? error} htmlFor="pe-accent-hex">
          <div className="a-color-row">
            <input type="color" aria-label="Couleur des boutons et liens de la page : sélecteur" value={value} onChange={(e) => onChange(e.target.value)} />
            <input
              id="pe-accent-hex"
              className="a-input mono a-color-hex"
              value={value}
              onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value.trim()) && onChange(e.target.value.trim())}
            />
            {!issue && <span className="a-ratio a-ratio-ok">✓ AA</span>}
          </div>
          {fix && (
            <button type="button" className="a-btn a-btn-small a-fix" onClick={() => onChange(fix)}>
              Ajuster à la teinte la plus proche qui passe
              <span className="a-chip" style={{ background: fix }} aria-hidden="true" />
              <span className="mono">{fix}</span>
            </button>
          )}
        </Field>
      )}
    </div>
  );
}
