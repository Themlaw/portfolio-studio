"use client";

/**
 * Panneaux « Couleurs » et « Logo » de l'éditeur visuel (lot 17f), pour le site entier.
 *
 * Couleurs : chaque rôle porte un nom parlant et une phrase (« Fond de page », « Cartes et encadrés »…).
 * Au survol ou au focus d'un rôle, la toile surligne les éléments qui l'utilisent (message `highlight`)
 * et la légende « utilisé par » revient de la toile. Un clic ouvre le sélecteur (roue, HEX, RVB) : la
 * couleur est montrée tout de suite sur la toile. Lisibilité (contraste AA) en direct, le rapport en info-bulle ; s'il est insuffisant, avertissement
 * et « Ajuster automatiquement » — la saisie n'est jamais bloquée, seule la publication l'est (serveur).
 * Les nuances calculées sont en lecture seule, repliées. En mode « site » (éditeur visuel), la palette du THÈME
 * n'est jamais modifiée : ce sont des surcharges du site (`styles.palette`), publiées avec la page comme l'en-tête.
 *
 * Mode « theme » (lot 19b, Admin → Thèmes → un thème) : le même panneau édite les couleurs du THÈME. `theme` porte
 * alors les couleurs COURANTES du formulaire (aperçu compris), `baseline` celles enregistrées (« modifiée » =
 * différente de l'enregistré), et `onChange` reçoit un correctif ({ rôle: couleur }) à poser sur ces couleurs.
 *
 * Logo : image (médiathèque ou envoi, lot 26 ; retirée : le logo texte ou celui du thème), taille (curseur) et comportement
 * (fixe, réduit au défilement, déborde sous le bandeau).
 */
import { useEffect, useState } from "react";

import { SolidColorPicker } from "@/components/edit/ColorPicker";
import { pairsReadability, ratioTip } from "@/components/edit/readability";
import type { AdminMediaRow } from "@/lib/admin";
import { LOGO_MODE_LABELS, LOGO_MODES, LOGO_SIZE_DEFAULT, LOGO_SIZE_MAX, LOGO_SIZE_MIN, type Logo, type PaletteColor, type SitePalette } from "@/lib/look";
import type { BaseKey, NuanceKey, PaletteColors, PaletteState } from "@/themes/palette";
import { autoAdjustBase, CONTRAST_BASES, effectiveSitePalette, NUANCE_USES, nuanceLabel, rolePairs, SITE_ROLES, sitePaletteIssues } from "@/themes/site-palette";

import "@/app/admin/look-panel.css";
import "@/app/admin/typo-controls.css";

export type ThemeColors = { name: string; color: PaletteColors; palette: PaletteState | null };
export type HighlightInfo = { role: BaseKey | null; count: number; uses: string[] };

const NUANCE_ORDER: NuanceKey[] = ["bgDeep", "line", "inkSoft", "shadow", "primaryHover", "onPrimary", "eyebrow", "scrim", "onScrim"];

export function ColorsPanel({
  theme,
  value: siteValue,
  onChange,
  onHighlight,
  info,
  locked,
  mode = "site",
  baseline,
}: {
  theme: ThemeColors;
  /** Surcharges du site (état voulu, aperçu compris). Ignoré en mode « theme ». */
  value: SitePalette;
  /** Mode « site » : nouvel état des surcharges. Mode « theme » : correctif à poser sur les couleurs courantes. */
  onChange: (next: SitePalette) => void;
  /** « site » : surcharges du site par-dessus le thème (éditeur visuel). « theme » : couleurs du thème lui-même. */
  mode?: "site" | "theme";
  /** Mode « theme » : couleurs enregistrées du thème (repère « modifiée », retour à l'enregistré). */
  baseline?: PaletteColors;
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

  const isTheme = mode === "theme";
  const palette = theme.palette ?? undefined;
  // Mode « theme » : les couleurs courantes SONT l'état ; la comparaison se fait avec l'enregistré.
  const value: SitePalette = isTheme ? {} : siteValue;
  const base = effectiveSitePalette(theme.color, palette, undefined);
  const eff = effectiveSitePalette(theme.color, palette, value);
  const reference = isTheme && baseline ? baseline : null;
  const isModified = (key: BaseKey) => (reference ? eff[key].toLowerCase() !== String(reference[key]).toLowerCase() : typeof value[key] === "string");
  const modifiedKeys = SITE_ROLES.map((r) => r.key).filter(isModified);
  const modifiedCount = modifiedKeys.length;
  // Palette du site qui rendrait du texte illisible avec le thème actif : simple avertissement, rien n'est bloqué (v0.21.1).
  const issues = sitePaletteIssues(theme.color, palette, value);
  const ignored = !isTheme && modifiedCount > 0 && issues.length > 0;
  const worstIssue = issues.reduce((a, b) => (b.ratio < a.ratio ? b : a), issues[0]);
  // Pastilles du sélecteur : valeurs effectives (le panneau ne charge pas la feuille du thème).
  const swatch = (c: PaletteColor): string =>
    ({ ink: eff.ink, "ink-soft": eff.inkSoft, primary: eff.primary, secondary: eff.secondary, tertiary: eff.tertiary, eyebrow: eff.eyebrow, bg: eff.bg, surface: eff.surface })[c];

  const set = (key: BaseKey, hex: string | undefined) => {
    const clean = hex?.toLowerCase();
    if (isTheme) {
      // Revenir (hex absent) = la couleur enregistrée du thème.
      const target = clean ?? (reference ? String(reference[key]).toLowerCase() : undefined);
      if (target) onChange({ [key]: target });
      return;
    }
    const next = { ...value };
    // Revenir exactement à la couleur du thème = plus de surcharge.
    if (!clean || clean === base[key].toLowerCase()) delete next[key];
    else next[key] = clean;
    onChange(next);
  };

  return (
    <section className="lp lp-colors" aria-labelledby="lp-colors-title" data-testid="colors-panel" data-mode={mode}>
      <h3 id="lp-colors-title" className="lp-title" hidden={isTheme}>
        {isTheme ? "Couleurs de la DA" : "Couleurs"}
      </h3>
      <p className="lp-help">
        {isTheme
          ? `Survole une couleur pour voir où elle sert dans l'aperçu, clique pour la changer : l'aperçu suit tout de suite. Les couleurs sont écrites dans le thème « ${theme.name} » à l'enregistrement.`
          : `Survole une couleur pour voir où elle sert sur la page, clique pour la changer. Pour tout le site, publié avec cette page ; le thème « ${theme.name} » n'est pas modifié.`}
      </p>
      {locked && <p className="a-field-error">Les couleurs du site sont en cours de modification sur la page « {locked} ».</p>}
      {ignored && (
        <div className="a-field-error lc-ignored" role="alert" data-testid="palette-ignored">
          <p>
            <strong>Attention, du texte risque d&apos;être difficile à lire.</strong> Avec le thème actif « {theme.name} », ces couleurs donnent
            (<span title={ratioTip(worstIssue.ratio)}>{worstIssue.label.toLowerCase()} : lisibilité insuffisante</span>). Elles sont quand même enregistrées et mises en ligne.
          </p>
          <p>Si tu veux, ajuste les couleurs signalées ci-dessous.</p>
        </div>
      )}
      <ul className="lc-roles">
        {SITE_ROLES.map((role) => {
          const modified = isModified(role.key);
          const isOpen = open === role.key;
          const pairs = CONTRAST_BASES.includes(role.key) ? rolePairs(theme.color, palette, value, role.key) : [];
          const failing = pairs.filter((p) => !p.ok);
          const lowest = pairs.reduce((m, p) => Math.min(m, p.ratio), Infinity);
          // Thème : on tolère ce que la couleur enregistrée tolérait déjà (le thème peut avoir ses propres écarts).
          const allowed = isTheme && reference ? sitePaletteIssues({ ...theme.color, [role.key]: reference[role.key] }, palette, undefined).length : undefined;
          const fixed = failing.length ? autoAdjustBase(theme.color, theme.palette ?? undefined, value, role.key, allowed) : null;
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
                <span className="lc-state">{modified ? "modifiée" : isTheme ? "enregistrée" : "thème"}</span>
              </button>
              {highlighted === role.key && (
                <p className="lc-uses" data-floating={!isOpen || undefined} role="status" data-testid="hl-legend">
                  Utilisé par : {legend && legend.uses.length ? legend.uses.join(", ") : role.uses}
                  {legend && legend.count > 0 ? ` · ${legend.count} élément${legend.count > 1 ? "s" : ""} sur cette page` : ""}
                </p>
              )}
              {!isOpen && failing.length > 0 && (
                <p className="lc-warn" role="status" title={ratioTip(lowest)}>
                  Lisibilité : insuffisante.
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
                      live={isTheme}
                      solid={{
                        resetLabel: isTheme ? "Revenir à la couleur enregistrée" : "Revenir à la couleur du thème",
                        onReset: () => {
                          set(role.key, undefined);
                          setEpoch((n) => n + 1);
                        },
                      }}
                    />
                  </div>
                  {pairs.length > 0 &&
                    (failing.length === 0 ? (
                      <p className="lc-ok" role="status" data-testid="contrast-status" title={ratioTip(lowest)}>
                        Lisibilité : {pairsReadability(pairs).label}.
                      </p>
                    ) : (
                      <div className="a-field-error lc-alert" role="alert" data-testid="contrast-status">
                        <p title={ratioTip(lowest)}>
                          Lisibilité insuffisante : {failing.map((p) => p.label.toLowerCase()).join(", ")}. Du texte risque d&apos;être difficile à lire (simple avertissement : tu peux enregistrer et publier quand même).
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
            onChange(isTheme && reference ? Object.fromEntries(modifiedKeys.map((k) => [k, String(reference[k]).toLowerCase()])) : {});
            setEpoch((n) => n + 1);
          }}
        >
          {isTheme ? "Revenir aux couleurs enregistrées" : "Revenir aux couleurs du thème"}
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
    </section>
  );
}

const MODE_HELP: Record<(typeof LOGO_MODES)[number], string> = {
  fixed: "Le logo garde la même taille.",
  shrink: "Grand sur la page, il rétrécit quand on défile (visible dans « Aperçu exact »).",
  overhang: "Le logo dépasse un peu sous la barre du haut.",
};

export function LogoPanel({
  value,
  onChange,
  locked,
  media = [],
  signature = false,
  onChooseImage,
}: {
  value: Logo;
  onChange: (next: Logo) => void;
  locked: string | null;
  /** Médiathèque (nom et vignette de l'image choisie). */
  media?: AdminMediaRow[];
  /** Le thème actif dessine sa propre signature : retirer l'image y revient (sinon : le nom du site en texte). */
  signature?: boolean;
  /** Ouvre le choix d'une image (médiathèque ou envoi) ; absent : la section image n'est pas montrée. */
  onChooseImage?: () => void;
}) {
  const size = value.size ?? LOGO_SIZE_DEFAULT;
  const mode = value.mode ?? "fixed";
  const image = value.mediaId !== undefined ? (media.find((m) => m.id === value.mediaId) ?? null) : null;
  return (
    <section className="lp lp-logo" aria-labelledby="lp-logo-title" data-testid="logo-panel">
      <h3 id="lp-logo-title" className="lp-title">
        Logo
      </h3>
      <p className="lp-help">
        La signature de l&apos;en-tête, ou le nom du site quand le thème n&apos;en a pas. Tu peux aussi le régler sur la page : poignée sous le logo.
      </p>
      {locked && <p className="a-field-error">Le logo est en cours de modification sur la page « {locked} ».</p>}
      {onChooseImage && (
        <div className="lp-field lc-logo-image" data-testid="logo-image">
          <span className="lp-label">Image du logo</span>
          {value.mediaId !== undefined ? (
            <div className="lc-logo-current">
              {image?.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="lc-logo-thumb" src={image.thumb} alt="" data-testid="logo-thumb" />
              ) : (
                <span className="lc-logo-thumb lc-logo-missing" aria-hidden="true" />
              )}
              <span className="lc-logo-name">{image ? image.name : "Image introuvable (retirée de la médiathèque)"}</span>
            </div>
          ) : (
            <small className="lp-hint">{signature ? "Le logo est celui du thème (une signature dessinée)." : "Le logo est le nom du site, écrit en texte."} Remplace-le par ton image.</small>
          )}
          <div className="lc-logo-actions">
            <button type="button" className="a-btn a-btn-small" data-testid="logo-choose" onClick={onChooseImage}>
              {value.mediaId !== undefined ? "Remplacer l'image…" : "Choisir une image…"}
            </button>
            {value.mediaId !== undefined && (
              <button type="button" className="a-btn a-btn-small a-btn-quiet" data-testid="logo-revert" onClick={() => onChange({ ...value, mediaId: undefined })}>
                {signature ? "Revenir au logo du thème" : "Revenir au logo texte"}
              </button>
            )}
          </div>
        </div>
      )}
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
