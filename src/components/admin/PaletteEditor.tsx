"use client";

/**
 * Éditeur de palette (Admin → Thèmes → un thème) : couleurs de base et leurs
 * nuances, groupées par couleur (src/themes/palette.ts). Chaque nuance est
 * « auto » (dérivée de sa base, elle suit ses changements) ou choisie ;
 * « Revenir à auto » la rend à la dérivation. Contraste WCAG en direct (même
 * logique que la CI et le serveur : src/themes/contrast.ts), échantillon de
 * composants aux couleurs de la palette.
 */
import { useId, useState, type CSSProperties } from "react";

import AdminColorPicker from "./AdminColorPicker";
import { pairsReadability, ratioTip, readability } from "@/components/edit/readability";
import { FREE_FORMAT_HINT, OPAQUE_HEX, PICKER_FALLBACK, THEME_COLOR } from "@/themes/color-format";
import { AA, adjustToken, pairsForToken } from "@/themes/contrast";
import { contrastRatio, isAuto, PALETTE_GROUPS, resolvePalette, ROLE_NAMES, setBase, setNuance, type BaseKey, type NuanceKey, type NuanceSpec, type PaletteKey, type ResolvedPalette } from "@/themes/palette";
import type { Theme } from "@/themes/schema";

type Colors = Theme["tokens"]["color"];
type PaletteState = Theme["tokens"]["palette"];
type ContrastKey = Parameters<typeof pairsForToken>[1];
const CONTRAST_KEYS = new Set<string>(["bg", "bgDeep", "surface", "ink", "inkSoft", "primary", "onPrimary", "secondary", "eyebrow"]);

const HEX = OPAQUE_HEX;
const FREE = THEME_COLOR;
const expand = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex);

/** Libellés des bases : le vocabulaire unique des six rôles (`ROLE_NAMES`, lot 26), comme le panneau « Couleurs ». */
const BASE_FIELD: Record<BaseKey, { label: string; free?: boolean }> = {
  bg: { label: ROLE_NAMES.bg },
  surface: { label: ROLE_NAMES.surface },
  ink: { label: ROLE_NAMES.ink },
  primary: { label: ROLE_NAMES.primary },
  secondary: { label: ROLE_NAMES.secondary },
  tertiary: { label: ROLE_NAMES.tertiary, free: true },
};

type FieldProps = {
  tokenKey: PaletteKey;
  label: string;
  help: string;
  free?: boolean;
  value: string;
  /** Couleurs pour le contraste (eyebrow absent s'il est auto : l'accent secondaire en répond). */
  contrastColors: Record<string, string | undefined>;
  onChange: (value: string) => void;
  serverError?: string;
  lastEdited: PaletteKey | null;
  /** Nuance : état auto / choisie et retour à auto. */
  nuance?: { spec: NuanceSpec; auto: boolean; autoValue: string; onReset: () => void; extraPair?: { label: string; ratio: number } };
};

export function ColorField({ tokenKey, label, help, free, value, contrastColors, onChange, serverError, lastEdited, nuance }: FieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const valid = free ? FREE.test(text) : HEX.test(text);
  const checked = CONTRAST_KEYS.has(tokenKey) && HEX.test(value) && (!nuance || nuance.spec.contrast);
  const pairs = checked ? pairsForToken(contrastColors as never, tokenKey as ContrastKey) : [];
  const failing = pairs.filter((p) => !p.ok);
  // Détail et « Ajuster » : sur le texte fautif, ou sur le fond qu'on vient de changer.
  const blamed = failing.length > 0 && (failing.some((p) => p.fg === tokenKey || (tokenKey === "secondary" && p.fg === "eyebrow")) || lastEdited === tokenKey);
  const worst = pairs.reduce((m, p) => Math.min(m, p.ratio), Infinity);
  const fixed = blamed ? adjustToken(contrastColors as never, tokenKey as ContrastKey) : null;
  const extra = nuance?.extraPair;
  const extraBad = extra ? extra.ratio < AA : false;

  return (
    <div className={`a-color${failing.length || serverError || extraBad ? " a-field-invalid" : ""}${nuance ? " a-color-nuance" : ""}`} data-token={tokenKey} data-auto={nuance ? String(nuance.auto) : undefined}>
      <div className="a-color-top">
        <label htmlFor={`${id}-hex`} className="a-color-label">
          {label}
        </label>
        {nuance && <span className={`a-pal-mode${nuance.auto ? "" : " a-pal-mode-forced"}`}>{nuance.auto ? "auto" : "choisie"}</span>}
      </div>
      <div className="a-color-row">
        <AdminColorPicker
          label={label}
          value={HEX.test(value) ? expand(value) : PICKER_FALLBACK}
          onChange={(hex) => {
            setDraft(null);
            onChange(hex);
          }}
        />
        <input
          id={`${id}-hex`}
          className="a-input mono a-color-hex"
          value={text}
          spellCheck={false}
          aria-invalid={!valid}
          aria-describedby={`${id}-help`}
          onChange={(e) => {
            const v = e.target.value.trim();
            setDraft(v);
            if (free ? FREE.test(v) : HEX.test(v)) {
              onChange(v);
              setDraft(null);
            }
          }}
          onBlur={() => setDraft(null)}
        />
        {pairs.length > 0 && (
          <span className={`a-ratio ${failing.length ? "a-ratio-bad" : "a-ratio-ok"}`} title={pairs.map((p) => `${p.label} : ${ratioTip(p.ratio)}`).join("\n")}>
            {failing.length ? "✗" : "✓"} Lisibilité : {pairsReadability(pairs).label}
          </span>
        )}
        {extra && (
          <span className={`a-ratio ${extraBad ? "a-ratio-bad" : "a-ratio-ok"}`} title={`${extra.label} : ${ratioTip(extra.ratio)}`}>
            {extraBad ? "✗" : "✓"} {extra.label} : lisibilité {readability(extra.ratio).label}
          </span>
        )}
      </div>
      <p id={`${id}-help`} className="a-help">
        {help}
        {nuance?.auto && <> Auto : {nuance.spec.rule}.</>}
      </p>
      {nuance && !nuance.auto && (
        <button type="button" className="a-btn a-btn-small a-btn-quiet a-pal-reset" onClick={nuance.onReset}>
          Revenir à auto
          <span className="a-chip" style={{ background: nuance.autoValue }} aria-hidden="true" />
          <span className="mono">{nuance.autoValue}</span>
        </button>
      )}
      {!valid && <p className="a-field-error">Couleur attendue au format {free ? FREE_FORMAT_HINT : "#rrggbb"}.</p>}
      {extraBad && extra && (
        <p className="a-field-error" role="alert" title={ratioTip(extra.ratio)}>
          Texte illisible sur le voile : lisibilité insuffisante.
        </p>
      )}
      {blamed && (
        <div className="a-field-error" role="alert">
          <p title={ratioTip(worst)}>
            Lisibilité insuffisante : {failing.map((p) => p.label.toLowerCase()).join(", ")}.
          </p>
          {fixed ? (
            <button type="button" className="a-btn a-btn-small a-fix" onClick={() => onChange(fixed)}>
              Ajuster à la teinte la plus proche qui passe
              <span className="a-chip" style={{ background: fixed }} aria-hidden="true" />
              <span className="mono">{fixed}</span>
            </button>
          ) : (
            <p>Aucune teinte proche ne passe : change aussi la couleur de fond concernée.</p>
          )}
        </div>
      )}
      {serverError && !failing.length && <p className="a-field-error">{serverError}</p>}
    </div>
  );
}

/** Échantillon de composants aux couleurs de la palette (aperçu immédiat, sans le site). */
export function PaletteSample({ p }: { p: ResolvedPalette }) {
  const vars = {
    "--pv-bg": p.bg,
    "--pv-bg-deep": p.bgDeep,
    "--pv-surface": p.surface,
    "--pv-ink": p.ink,
    "--pv-ink-soft": p.inkSoft,
    "--pv-line": p.line,
    "--pv-primary": p.primary,
    "--pv-primary-hover": p.primaryHover,
    "--pv-on-primary": p.onPrimary,
    "--pv-eyebrow": p.eyebrow,
    "--pv-tertiary": p.tertiary,
    "--pv-shadow": p.shadow,
    "--pv-scrim": p.scrim,
    "--pv-on-scrim": p.onScrim,
  } as CSSProperties;
  return (
    <div className="a-pal-sample" style={vars} aria-label="Échantillon aux couleurs de la palette" role="img">
      <div className="a-pal-s-page">
        <span className="a-pal-s-eyebrow">Étiquette</span>
        <strong className="a-pal-s-title">Titre de section</strong>
        <span className="a-pal-s-soft">Texte secondaire, légende d&apos;une œuvre.</span>
        <span className="a-pal-s-link">Un lien</span>
        <span className="a-pal-s-buttons">
          <span className="a-pal-s-btn">Bouton</span>
          <span className="a-pal-s-btn a-pal-s-btn-hover">Survol</span>
        </span>
        <hr className="a-pal-s-line" />
        <span className="a-pal-s-card">
          Carte <span className="a-pal-s-dot" />
        </span>
      </div>
      <div className="a-pal-s-deep">Fond profond</div>
      <div className="a-pal-s-scrim">
        <span className="a-pal-s-frame" />
        <span>Légende sur le voile</span>
      </div>
    </div>
  );
}

export default function PaletteEditor({
  colors,
  palette,
  onChange,
  errors,
}: {
  colors: Colors;
  palette: PaletteState;
  onChange: (color: Colors, palette: PaletteState) => void;
  errors: Record<string, string>;
}) {
  const [lastEdited, setLastEdited] = useState<PaletteKey | null>(null);
  const resolved = resolvePalette(colors, palette);
  // Contraste : valeurs résolues, mais une étiquette auto reste celle de l'accent secondaire.
  const contrastColors: Record<string, string | undefined> = { ...resolved, eyebrow: colors.eyebrow };

  const changeBase = (key: BaseKey, value: string) => {
    setLastEdited(key);
    onChange(setBase(colors, palette, key, value), palette);
  };
  const changeNuance = (key: NuanceKey, value: string | null) => {
    setLastEdited(key);
    const next = setNuance(colors, palette, key, value);
    onChange(next.color, next.palette);
  };
  const autoValue = (key: NuanceKey) => {
    const next = setNuance(colors, palette, key, null);
    return resolvePalette(next.color, next.palette)[key];
  };

  return (
    <>
      <p className="a-help a-panel-intro">
        Six couleurs de base et leurs nuances. Une nuance « auto » suit sa couleur de base ; change-la pour la choisir toi-même. Chaque texte doit rester lisible
        sur chaque fond (norme WCAG AA ; le rapport exact est dans l&apos;info-bulle). Un indicateur rouge bloque l&apos;enregistrement.
      </p>
      <PaletteSample p={resolved} />
      <div className="a-pal-groups">
        {PALETTE_GROUPS.map((g) => (
          <fieldset key={g.id} className="a-fieldset a-pal-group" data-group={g.id}>
            <legend>{g.base ? ROLE_NAMES[g.base] : g.label}</legend>
            <div className="a-colors">
              {g.base && (
                <ColorField
                  tokenKey={g.base}
                  label={BASE_FIELD[g.base].label}
                  help={g.baseHelp ?? ""}
                  free={BASE_FIELD[g.base].free}
                  value={colors[g.base]}
                  contrastColors={contrastColors}
                  onChange={(v) => changeBase(g.base!, v)}
                  serverError={errors[`tokens.color.${g.base}`]}
                  lastEdited={lastEdited}
                />
              )}
              {g.nuances.map((n) => {
                const auto = isAuto(colors, palette, n.key);
                return (
                  <ColorField
                    key={n.key}
                    tokenKey={n.key}
                    label={n.label}
                    help={n.help}
                    free={n.free}
                    value={resolved[n.key]}
                    contrastColors={contrastColors}
                    onChange={(v) => changeNuance(n.key, v)}
                    serverError={errors[`tokens.color.${n.key}`]}
                    lastEdited={lastEdited}
                    nuance={{
                      spec: n,
                      auto,
                      autoValue: autoValue(n.key),
                      onReset: () => changeNuance(n.key, null),
                      extraPair: n.key === "onScrim" ? { label: "Texte sur le voile", ratio: contrastRatio(resolved.onScrim, resolved.scrim) } : undefined,
                    }}
                  />
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </>
  );
}
