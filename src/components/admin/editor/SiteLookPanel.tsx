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
import { LOGO_MODE_LABELS, LOGO_MODES, LOGO_SIZE_DEFAULT, LOGO_SIZE_MAX, LOGO_SIZE_MIN, LOGO_SIZE_PRESETS, type Logo, type PaletteColor, type SitePalette } from "@/lib/look";
import { NUANCE_KEYS, PALETTE_GROUPS, type BaseKey, type NuanceKey, type PaletteColors, type PaletteState } from "@/themes/palette";
import { autoAdjustBase, CONTRAST_BASES, effectiveSitePalette, nuanceOrigin, nuancesUnder, rolePairs, SITE_NUANCES, SITE_ROLES, sitePaletteIssues, sitePalettePairs, themeFixesNuance } from "@/themes/site-palette";

import "@/app/admin/look-panel.css";
import "@/app/admin/typo-controls.css";

export type ThemeColors = { name: string; color: PaletteColors; palette: PaletteState | null };
export type HighlightInfo = { role: BaseKey | null; count: number; uses: string[] };

/** Légende des états d'une couleur (info-bulle, lot 55). */
const STATE_TIPS: Record<string, string> = {
  thème: "Cette couleur est celle du thème.",
  personnalisée: "Tu as choisi cette couleur pour tout le site : elle remplace celle du thème.",
  modifiée: "Tu as changé cette couleur, elle n'est pas encore enregistrée.",
  enregistrée: "Cette couleur est celle du thème enregistré.",
  choisie: "Tu as choisi cette couleur toi-même.",
  automatique: "Cette couleur se calcule toute seule à partir des autres.",
};

/** Règle du calcul « auto » d'une nuance, en clair. */
const ruleOf = (k: NuanceKey) => PALETTE_GROUPS.flatMap((g) => g.nuances).find((n) => n.key === k)?.rule ?? "";

/** Les quatre couleurs de base de l'éditeur de thème guidé : Fond de page, Texte, Boutons et liens, Accent. */
export const GUIDED_ROLES: readonly BaseKey[] = ["bg", "ink", "primary", "secondary"];

export function ColorsPanel({
  theme,
  value: siteValue,
  onChange,
  onHighlight,
  info,
  locked,
  mode = "site",
  baseline,
  preparing = false,
  guided = false,
}: {
  theme: ThemeColors;
  /** Le thème montré est en préparation (aperçu, pas encore en ligne) : les textes le disent (lot 55). */
  preparing?: boolean;
  /** Surcharges du site (état voulu, aperçu compris). Ignoré en mode « theme ». */
  value: SitePalette;
  /** Mode « site » : nouvel état des surcharges. Mode « theme » : correctif à poser sur les couleurs courantes. */
  onChange: (next: SitePalette) => void;
  /** « site » : surcharges du site par-dessus le thème (éditeur visuel). « theme » : couleurs du thème lui-même. */
  mode?: "site" | "theme";
  /** Mode « theme » : couleurs enregistrées du thème (repère « modifiée », retour à l'enregistré). */
  baseline?: PaletteColors;
  /**
   * Éditeur de thème guidé (lot 61, mode « theme ») : seulement les quatre couleurs de base (Fond, Texte, Boutons, Accent) ; les autres
   * couleurs et les nuances sont réglées sous « Affiner » (PaletteEditor), sans second bloc de couleurs.
   */
  guided?: boolean;
  /** Rôle à surligner sur la toile (null : rien). */
  onHighlight: (role: BaseKey | null) => void;
  info: HighlightInfo | null;
  locked: string | null;
}) {
  const [open, setOpen] = useState<BaseKey | null>(null);
  // Nuance dont le sélecteur est ouvert (une seule fenêtre ouverte à la fois, rôle ou nuance).
  const [openNuance, setOpenNuance] = useState<NuanceKey | null>(null);
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
  const nuanceOverrides = isTheme ? 0 : NUANCE_KEYS.filter((k) => typeof value[k] === "string" && value[k] !== "auto").length;
  const modifiedCount = modifiedKeys.length + nuanceOverrides;
  // Palette du site qui rendrait du texte difficile à lire avec le thème actif : simple avertissement (lot 29), elle est appliquée et publiée.
  const issues = sitePaletteIssues(theme.color, palette, value);
  const ignored = !isTheme && modifiedCount > 0 && issues.length > 0;
  const worstIssue = issues.reduce((a, b) => (b.ratio < a.ratio ? b : a), issues[0]);
  // Pastilles du sélecteur : valeurs effectives (le panneau ne charge pas la feuille du thème).
  const swatch = (c: PaletteColor): string =>
    ({ ink: eff.ink, "ink-soft": eff.inkSoft, primary: eff.primary, secondary: eff.secondary, tertiary: eff.tertiary, eyebrow: eff.eyebrow, bg: eff.bg, surface: eff.surface })[c];

  /** Nuance choisie (hex), ou retour au calcul (undefined). Thème : correctif { nuance: couleur | "auto" } ; site : surcharge. */
  const setNuanceValue = (key: NuanceKey, hex: string | undefined) => {
    const clean = hex?.toLowerCase();
    if (isTheme) {
      onChange({ [key]: clean ?? "auto" });
      return;
    }
    const next = { ...value };
    if (clean === undefined) {
      delete next[key];
    } else next[key] = clean;
    onChange(next);
  };
  const allPairs = sitePalettePairs(theme.color, palette, value);
  const renderNuance = (k: NuanceKey) => {
    const info = SITE_NUANCES[k];
    const isOpenN = openNuance === k;
    const origin = nuanceOrigin(theme.color, palette, value, k);
    const failing = allPairs.filter((p) => !p.ok && p.tokens.includes(k));
    const state = origin === "site" ? "choisie" : origin === "auto" ? "automatique" : isTheme ? "choisie" : "thème";
    return (
      <li key={k} className="lc-nuance-item" data-nuance={k} data-open={isOpenN || undefined} data-origin={origin} data-invalid={failing.length > 0 || undefined}>
        <button
          type="button"
          className="lc-nuance"
          aria-expanded={isOpenN}
          aria-controls={`lc-nbody-${k}`}
          onClick={() => {
            setOpen(null);
            setOpenNuance(isOpenN ? null : k);
          }}
        >
          <span className="lc-chip lc-chip-small" style={{ background: eff[k] }} aria-hidden="true" />
          <span className="lc-text">
            <strong>{info.name}</strong>
            <small>{info.phrase}</small>
            {origin === "auto" && <small data-testid="nuance-auto">Automatique (calculée : {ruleOf(k)})</small>}
          </span>
          <span className="lc-nstate" title={STATE_TIPS[state]}>
            {state}
          </span>
        </button>
        {failing.length > 0 && (
          <p className="lc-nwarn" role="status" title={ratioTip(Math.min(...failing.map((p) => p.ratio)))}>
            Lisibilité insuffisante : {failing.map((p) => p.label).join(", ")}.
          </p>
        )}
        {isOpenN && (
          <div className="lc-body" id={`lc-nbody-${k}`}>
            <div className="tc">
              <SolidColorPicker
                key={`n-${k}-${epoch}`}
                value={eff[k]}
                swatch={swatch}
                onChange={(c) => c && setNuanceValue(k, c)}
                onClose={() => setOpenNuance(null)}
                live
                solid={{
                  resetLabel: !isTheme && themeFixesNuance(theme.color, palette, value, k) ? "Revenir à la couleur du thème" : "Revenir à l'automatique",
                  onReset: () => {
                    setNuanceValue(k, undefined);
                    setEpoch((n) => n + 1);
                  },
                }}
              />
            </div>
          </div>
        )}
      </li>
    );
  };

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
    <section className="lp lp-colors" aria-labelledby="lp-colors-title" data-testid="colors-panel" data-mode={mode} data-guided={(isTheme && guided) || undefined}>
      <h3 id="lp-colors-title" className="lp-title" hidden={isTheme}>
        Couleurs
      </h3>
      <p className="lp-help">
        {isTheme
          ? guided
            ? "Survole une couleur pour voir où elle sert dans l'aperçu, clique pour la changer : l'aperçu suit tout de suite."
            : `Survole une couleur pour voir où elle sert dans l'aperçu, clique pour la changer : l'aperçu suit tout de suite. Les couleurs sont écrites dans le thème « ${theme.name} » à l'enregistrement.`
          : preparing
            ? `Ces couleurs sont celles du thème « ${theme.name} », que tu prépares : il n'est pas encore en ligne. Survole une couleur pour voir où elle sert, clique pour la changer. Une couleur changée ici est personnalisée pour tout le site, publiée avec cette page ; le thème « ${theme.name} » n'est pas modifié.`
            : `Survole une couleur pour voir où elle sert sur la page, clique pour la changer. Une couleur changée ici est personnalisée pour tout le site, publiée avec cette page ; le thème « ${theme.name} » n'est pas modifié.`}
      </p>
      {!isTheme && modifiedCount > 0 && (
        <p className="lc-custom" data-testid="custom-colors-title">
          <strong>Couleurs personnalisées du site</strong> : {modifiedCount} {modifiedCount > 1 ? "couleurs remplacent" : "couleur remplace"} celles du thème, sur toutes les pages.
        </p>
      )}
      {locked && <p className="a-field-error">Les couleurs du site sont en cours de modification sur la page « {locked} ».</p>}
      {ignored && (
        <div className="a-notice lc-ignored" role="status" data-testid="palette-ignored">
          <p>
            <strong>Attention : ces couleurs rendent du texte difficile à lire</strong> avec le thème « {theme.name} »{preparing ? " (en préparation)" : ""}
            (<span title={ratioTip(worstIssue.ratio)}>{worstIssue.label.toLowerCase()} : lisibilité insuffisante</span>). Elles sont appliquées quand même ; tu peux publier sans les changer.
          </p>
          <p>Si tu veux plus de confort de lecture, ajuste les couleurs signalées ci-dessous.</p>
        </div>
      )}
      <ul className="lc-roles">
        {(isTheme && guided ? SITE_ROLES.filter((r) => GUIDED_ROLES.includes(r.key)) : SITE_ROLES).map((role) => {
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
            <li key={role.key} className="lc-role-item" data-role={role.key} data-open={isOpen || undefined} data-modified={modified || undefined} data-invalid={failing.length > 0 || undefined} data-legend={(highlighted === role.key && !isOpen) || undefined}>
              <button
                type="button"
                className="lc-role"
                aria-expanded={isOpen}
                aria-controls={`lc-body-${role.key}`}
                onPointerEnter={() => setHover(role.key)}
                onPointerLeave={() => setHover((h) => (h === role.key ? null : h))}
                onFocus={() => setHover(role.key)}
                onBlur={() => setHover((h) => (h === role.key ? null : h))}
                onClick={() => {
                  setOpenNuance(null);
                  setOpen(isOpen ? null : role.key);
                }}
              >
                <span className="lc-chip" style={{ background: eff[role.key] }} aria-hidden="true" />
                <span className="lc-text">
                  <strong>{role.name}</strong>
                  <small>{role.phrase}</small>
                </span>
                <span className="lc-state" title={STATE_TIPS[modified ? "modifiée" : isTheme ? "enregistrée" : "thème"]}>
                  {modified ? (isTheme ? "modifiée" : "personnalisée") : isTheme ? "enregistrée" : "thème"}
                </span>
              </button>
              {highlighted === role.key && (
                <p className="lc-uses" data-floating={!isOpen || undefined} role="status" data-testid="hl-legend">
                  Utilisé par : {legend && legend.uses.length ? legend.uses.join(", ") : role.uses}
                  {legend && legend.count > 0 ? ` · ${legend.count} élément${legend.count > 1 ? "s" : ""} sur cette page` : ""}
                </p>
              )}
              {!isOpen && failing.length > 0 && (
                <p className="lc-warn" role="status" title={ratioTip(lowest)}>
                  Lisibilité insuffisante : {failing.map((p) => p.label).join(", ")}.
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
                      <div className="a-notice lc-alert" role="status" data-testid="contrast-status">
                        <p title={ratioTip(lowest)}>
                          Lisibilité insuffisante : {failing.map((p) => p.label.toLowerCase()).join(", ")}. Du texte serait difficile à lire ; la couleur est appliquée quand même, la mise en ligne n&apos;est pas bloquée.
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
              {!(isTheme && guided) && nuancesUnder(role.key).length > 0 && (
                <ul className="lc-nuance-sub" aria-label={`Réglages liés : ${role.name}`}>
                  {nuancesUnder(role.key).map(renderNuance)}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {!(isTheme && guided) && (
        <>
          <h4 className="lc-group-title">Image agrandie</h4>
          <p className="lp-help">Quand on clique sur une image : le fond derrière elle et ce qui s&apos;écrit dessus.</p>
          <ul className="lc-nuance-sub lc-lightbox" data-testid="lightbox-colors">
            {nuancesUnder("lightbox").map(renderNuance)}
          </ul>
        </>
      )}
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
        <span className="lp-label" id="lp-logo-size-label">
          Taille du logo
        </span>
        <div className="lc-modes-row" role="group" aria-labelledby="lp-logo-size-label" data-testid="logo-size-presets">
          {LOGO_SIZE_PRESETS.map((p) => (
            <button key={p.label} type="button" className="a-btn a-btn-small" aria-pressed={size === p.size && value.size !== undefined} data-testid={`logo-size-${p.id}`} onClick={() => onChange({ ...value, size: p.size })}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="lp-label" htmlFor="lp-logo-size">
          Réglage précis
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
