"use client";

/**
 * Panneaux « Couleurs » et « Logo » de l'éditeur visuel (lot 17f), pour le site entier.
 *
 * Couleurs : chaque rôle porte un nom parlant et une phrase (« Fond de page », « Cartes et encadrés »…).
 * Au survol ou au focus d'un rôle, la toile surligne les éléments qui l'utilisent (message `highlight`)
 * et la légende « utilisé par » revient de la toile. Un clic ouvre le sélecteur (roue, HEX, RVB) : la
 * couleur est montrée tout de suite sur la toile. Contraste AA en direct ; s'il est insuffisant, avertissement
 * et « Ajuster automatiquement » — la saisie n'est jamais bloquée, seule la publication l'est (serveur).
 * Les nuances calculées sont en lecture seule, repliées. La palette du THÈME n'est jamais modifiée : ce
 * sont des surcharges du site (`styles.palette`), publiées avec la page comme l'en-tête.
 *
 * Logo : taille (curseur) et comportement (fixe, réduit au défilement, déborde sous le bandeau).
 */
import { useEffect, useState } from "react";

import { SolidColorPicker } from "@/components/edit/ColorPicker";
import { LOGO_MODE_LABELS, LOGO_MODES, LOGO_SIZE_DEFAULT, LOGO_SIZE_MAX, LOGO_SIZE_MIN, type Logo, type PaletteColor, type SitePalette } from "@/lib/look";
import { AA } from "@/themes/contrast";
import type { BaseKey, NuanceKey, PaletteColors, PaletteState } from "@/themes/palette";
import { autoAdjustBase, CONTRAST_BASES, effectiveSitePalette, NUANCE_USES, nuanceLabel, rolePairs, SITE_ROLES, sitePaletteIssues } from "@/themes/site-palette";

import "@/app/admin/look-panel.css";

export type ThemeColors = { name: string; color: PaletteColors; palette: PaletteState | null };
export type HighlightInfo = { role: BaseKey | null; count: number; uses: string[] };

const NUANCE_ORDER: NuanceKey[] = ["bgDeep", "line", "inkSoft", "shadow", "primaryHover", "onPrimary", "eyebrow", "scrim", "onScrim"];
const ratioText = (n: number) => n.toFixed(2).replace(".", ",");

export function ColorsPanel({
  theme,
  value,
  onChange,
  onHighlight,
  info,
  locked,
}: {
  theme: ThemeColors;
  /** Surcharges du site (état voulu, aperçu compris). */
  value: SitePalette;
  onChange: (next: SitePalette) => void;
  /** Rôle à surligner sur la toile (null : rien). */
  onHighlight: (role: BaseKey | null) => void;
  info: HighlightInfo | null;
  locked: string | null;
}) {
  const [open, setOpen] = useState<BaseKey | null>(null);
  const [hover, setHover] = useState<BaseKey | null>(null);
  // Remonte le sélecteur (clé) quand la couleur change ailleurs que dans lui (revenir au thème, ajuster).
  const [epoch, setEpoch] = useState(0);
  const highlighted = hover ?? open;
  useEffect(() => {
    onHighlight(highlighted);
  }, [highlighted, onHighlight]);
  useEffect(() => () => onHighlight(null), [onHighlight]);

  const palette = theme.palette ?? undefined;
  const base = effectiveSitePalette(theme.color, palette, undefined);
  const eff = effectiveSitePalette(theme.color, palette, value);
  const modifiedCount = Object.keys(value).length;
  // Pastilles du sélecteur : valeurs effectives (le panneau ne charge pas la feuille du thème).
  const swatch = (c: PaletteColor): string =>
    ({ ink: eff.ink, "ink-soft": eff.inkSoft, primary: eff.primary, secondary: eff.secondary, tertiary: eff.tertiary, eyebrow: eff.eyebrow, bg: eff.bg, surface: eff.surface })[c];

  const set = (key: BaseKey, hex: string | undefined) => {
    const next = { ...value };
    const clean = hex?.toLowerCase();
    // Revenir exactement à la couleur du thème = plus de surcharge.
    if (!clean || clean === base[key].toLowerCase()) delete next[key];
    else next[key] = clean;
    onChange(next);
  };

  return (
    <section className="lp lp-colors" aria-labelledby="lp-colors-title" data-testid="colors-panel">
      <h3 id="lp-colors-title" className="lp-title">
        Couleurs
      </h3>
      <p className="lp-help">
        Survole une couleur pour voir où elle sert sur la page, clique pour la changer. Pour tout le site, publié avec cette page ; le thème « {theme.name} » n&apos;est pas modifié.
      </p>
      {locked && <p className="a-field-error">Les couleurs du site sont en cours de modification sur la page « {locked} ».</p>}
      <ul className="lc-roles">
        {SITE_ROLES.map((role) => {
          const modified = typeof value[role.key] === "string";
          const isOpen = open === role.key;
          const pairs = CONTRAST_BASES.includes(role.key) ? rolePairs(theme.color, palette, value, role.key) : [];
          const failing = pairs.filter((p) => !p.ok);
          const lowest = pairs.reduce((m, p) => Math.min(m, p.ratio), Infinity);
          const fixed = failing.length ? autoAdjustBase(theme.color, theme.palette ?? undefined, value, role.key) : null;
          const legend = info && info.role === role.key && highlighted === role.key ? info : null;
          return (
            <li key={role.key} className="lc-role-item" data-role={role.key} data-open={isOpen || undefined} data-modified={modified || undefined} data-invalid={failing.length > 0 || undefined}>
              <button
                type="button"
                className="lc-role"
                aria-expanded={isOpen}
                aria-controls={`lc-body-${role.key}`}
                onPointerEnter={() => setHover(role.key)}
                onPointerLeave={() => setHover((h) => (h === role.key ? null : h))}
                onFocus={() => setHover(role.key)}
                onBlur={() => setHover((h) => (h === role.key ? null : h))}
                onClick={() => setOpen(isOpen ? null : role.key)}
              >
                <span className="lc-chip" style={{ background: eff[role.key] }} aria-hidden="true" />
                <span className="lc-text">
                  <strong>{role.name}</strong>
                  <small>{role.phrase}</small>
                </span>
                <span className="lc-state">{modified ? "modifiée" : "thème"}</span>
              </button>
              {highlighted === role.key && (
                <p className="lc-uses" role="status" data-testid="hl-legend">
                  Utilisé par : {legend && legend.uses.length ? legend.uses.join(", ") : role.uses}
                  {legend && legend.count > 0 ? ` · ${legend.count} élément${legend.count > 1 ? "s" : ""} sur cette page` : ""}
                </p>
              )}
              {!isOpen && failing.length > 0 && (
                <p className="lc-warn" role="status">
                  Contraste insuffisant ({ratioText(lowest)}:1).
                </p>
              )}
              {isOpen && (
                <div className="lc-body" id={`lc-body-${role.key}`}>
                  <div className="tc">
                    <SolidColorPicker
                      key={`${role.key}-${epoch}`}
                      value={eff[role.key]}
                      swatch={swatch}
                      onChange={(c) => c && set(role.key, c)}
                      onClose={() => setOpen(null)}
                      solid={{
                        resetLabel: "Revenir à la couleur du thème",
                        onReset: () => {
                          set(role.key, undefined);
                          setEpoch((n) => n + 1);
                        },
                      }}
                    />
                  </div>
                  {pairs.length > 0 &&
                    (failing.length === 0 ? (
                      <p className="lc-ok" role="status" data-testid="contrast-status">
                        Contraste suffisant : {ratioText(lowest)}:1 au plus bas (AA : {ratioText(AA)}:1).
                      </p>
                    ) : (
                      <div className="a-field-error lc-alert" role="alert" data-testid="contrast-status">
                        <p>
                          Contraste insuffisant (minimum {ratioText(AA)}:1) : {failing.map((p) => `${p.label.toLowerCase()} ${ratioText(p.ratio)}:1`).join(", ")}. Du texte serait difficile à lire ; la mise en ligne sera refusée tant que ce n&apos;est pas corrigé.
                        </p>
                        {fixed ? (
                          <button
                            type="button"
                            className="a-btn a-btn-small a-fix"
                            data-testid="contrast-fix"
                            onClick={() => {
                              set(role.key, fixed);
                              setEpoch((n) => n + 1);
                            }}
                          >
                            Ajuster automatiquement
                            <span className="a-chip" style={{ background: fixed }} aria-hidden="true" />
                            <span className="mono">{fixed}</span>
                          </button>
                        ) : (
                          <p>Aucune teinte proche ne convient : change aussi la couleur du fond ou du texte concernée.</p>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {modifiedCount > 0 && (
        <button
          type="button"
          className="a-btn a-btn-small a-btn-quiet"
          onClick={() => {
            onChange({});
            setEpoch((n) => n + 1);
          }}
        >
          Revenir aux couleurs du thème
        </button>
      )}
      <details className="lc-nuances">
        <summary>Nuances calculées</summary>
        <p className="lp-help">Déduites des couleurs ci-dessus, en lecture seule ; elles suivent tes changements.</p>
        <ul className="lc-nuance-list">
          {NUANCE_ORDER.map((k) => (
            <li key={k} data-nuance={k}>
              <span className="lc-chip lc-chip-small" style={{ background: eff[k] }} aria-hidden="true" />
              <span className="lc-text">
                <strong>{nuanceLabel(k)}</strong>
                <small>{NUANCE_USES[k]}</small>
              </span>
              <span className="mono lc-hex">{eff[k]}</span>
            </li>
          ))}
        </ul>
      </details>
      {sitePaletteIssues(theme.color, palette, value).length > 0 && modifiedCount > 0 && (
        <p className="a-field-error" role="alert">
          Certaines couleurs rendent du texte illisible : la mise en ligne sera refusée tant que ce n&apos;est pas corrigé.
        </p>
      )}
    </section>
  );
}

const MODE_HELP: Record<(typeof LOGO_MODES)[number], string> = {
  fixed: "Le logo garde la même taille.",
  shrink: "Grand sur la page, il rétrécit quand on défile (visible dans « Aperçu exact »).",
  overhang: "Le logo dépasse un peu sous la barre du haut.",
};

export function LogoPanel({ value, onChange, locked }: { value: Logo; onChange: (next: Logo) => void; locked: string | null }) {
  const size = value.size ?? LOGO_SIZE_DEFAULT;
  const mode = value.mode ?? "fixed";
  return (
    <section className="lp lp-logo" aria-labelledby="lp-logo-title" data-testid="logo-panel">
      <h3 id="lp-logo-title" className="lp-title">
        Logo
      </h3>
      <p className="lp-help">
        La signature de l&apos;en-tête, ou le nom du site quand le thème n&apos;en a pas. Tu peux aussi le régler sur la page : poignée sous le logo.
      </p>
      {locked && <p className="a-field-error">Le logo est en cours de modification sur la page « {locked} ».</p>}
      <div className="lp-field">
        <label className="lp-label" htmlFor="lp-logo-size">
          Taille
        </label>
        <div className="lc-size">
          <input
            id="lp-logo-size"
            type="range"
            min={LOGO_SIZE_MIN}
            max={LOGO_SIZE_MAX}
            step={1}
            value={size}
            aria-valuetext={`${size} pixels`}
            onChange={(e) => onChange({ ...value, size: Number(e.target.value) })}
          />
          <output htmlFor="lp-logo-size" data-testid="logo-size-out">
            {value.size === undefined ? "thème" : `${size} px`}
          </output>
        </div>
        {value.size !== undefined && (
          <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => onChange({ ...value, size: undefined })}>
            Revenir à la taille du thème
          </button>
        )}
      </div>
      <fieldset className="lp-field lc-modes">
        <legend className="lp-label">Comportement</legend>
        {LOGO_MODES.map((m) => (
          <label key={m} className="lc-mode">
            <input type="radio" name="logo-mode" value={m} checked={mode === m} onChange={() => onChange({ ...value, mode: m })} />
            <span>
              <strong>{LOGO_MODE_LABELS[m]}</strong>
              <small>{MODE_HELP[m]}</small>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
