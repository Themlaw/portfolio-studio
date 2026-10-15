"use client";

import AdminColorPicker from "@/components/admin/AdminColorPicker";
import { ratioTip } from "@/components/edit/readability";
import { accentProblem, nearestAccent } from "@/themes/contrast";
import { contrastRatio } from "@/themes/palette";
import { ROLE_NAMES } from "@/themes/palette";

import { Field, Toggle } from "./index";

/**
 * Réglage de page (lot 26) : une autre couleur pour « Boutons et liens » sur CETTE page seulement (l'ancien « Accent de la
 * page », `draft.accent`). Même nom que le rôle du site (`ROLE_NAMES.primary`), et même place dans l'éditeur visuel et dans le
 * formulaire de la page : avec les autres réglages de la page. Lisibilité contrôlée en direct, en simple avertissement (jamais bloquant : la couleur choisie est toujours appliquée) ; `colors` = couleurs du site
 * (fonds, texte des boutons) ; `savedValue` n'est plus utilisé (la couleur enregistrée est toujours appliquée).
 */
export default function PageButtonsColorField({
  value,
  onChange,
  colors,
  error,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  colors: { bg: string; bgDeep: string; surface: string; onPrimary: string; primary: string } | null;
  error?: string;
}) {
  const issue = value && colors ? accentProblem(value, colors) : null;
  const fix = value && colors && issue ? nearestAccent(value, colors) : null;
  // Le pire couple (fond, fond profond, surface, texte des boutons) : le ratio va en info-bulle.
  const worst = value && colors && issue ? Math.min(...[colors.bg, colors.bgDeep, colors.surface].map((g) => contrastRatio(value, g)), contrastRatio(colors.onPrimary, value)) : null;
  return (
    <div className="a-span-2 a-page-buttons-color" data-testid="page-buttons-color">
      <Toggle
        label={`${ROLE_NAMES.primary} de cette page`}
        help={`Une autre couleur pour les boutons et les liens de cette page seulement. Les autres pages gardent la couleur « ${ROLE_NAMES.primary} » du site.`}
        checked={value !== null}
        onChange={(on) => onChange(on && colors ? colors.primary : null)}
      />
      {value !== null && (
        <Field label="Couleur" error={error} htmlFor="pe-accent-hex">
          <div className="a-color-row">
            <AdminColorPicker label="Couleur des boutons et liens de la page" value={value} onChange={onChange} />
            <input
              id="pe-accent-hex"
              className="a-input mono a-color-hex"
              value={value}
              onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value.trim()) && onChange(e.target.value.trim())}
            />
            {!issue && <span className="a-ratio a-ratio-ok">✓ AA</span>}
          </div>
          {issue && worst !== null && (
            <p className="a-notice" role="status" data-testid="page-buttons-warning" title={ratioTip(worst)}>
              Lisibilité : insuffisante. Cette couleur est appliquée quand même ; elle peut rendre des boutons ou des liens difficiles à lire.
            </p>
          )}
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
