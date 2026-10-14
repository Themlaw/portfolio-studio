"use client";

/**
 * Réglages typographiques d'un texte (lot 2), partagés par la barre flottante
 * de la toile et les « Styles du site » du panneau : police, taille (échelle
 * du thème + ajustement), graisse, italique, casse, interlettrage, couleur
 * (palette du thème), alignement, fond du texte (BackdropRow, lot 21 : la même ligne
 * pour tous les rôles), « Réinitialiser ». Toutes les valeurs sont
 * des crans bornés (src/lib/look.ts). Classes neutres `tc-*` : la toile
 * (look-layer.css) et le panneau (look-panel.css) les habillent.
 */
import { useState } from "react";

import { fontLabel, fontStack, googleOf, PALETTE, PALETTE_LABELS, SIZE_LABELS, SIZES, WEIGHTS, type PaletteColor, type TextStyle } from "@/lib/look";
import { googleFamily } from "@/themes/google-fonts";
import type { CardPalette } from "@/themes/surface";

import BackdropRow from "./BackdropRow";
import ColorPicker from "./ColorPicker";
import FontMenu from "./FontMenu";
import MenuSelect from "./MenuSelect";

import "@/app/admin/typo-controls.css";

const WEIGHT_LABELS: Record<number, string> = { 100: "Fine", 200: "Très légère", 300: "Légère", 400: "Normale", 500: "Moyenne", 600: "Demi-grasse", 700: "Grasse", 800: "Très grasse", 900: "Noire" };
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export type TypoProps = {
  value: TextStyle;
  /** Style complet (undefined = tout revient au style global). */
  onChange: (next: TextStyle | undefined) => void;
  installed: string[];
  /** Couleur CSS d'une teinte de la palette (toile : var(--t-color-…) ; panneau : valeur du thème). */
  swatch: (c: PaletteColor) => string;
  themeNames?: Partial<Record<"display" | "body" | "caption", string>>;
  /** Libellé de « Réinitialiser » (ex. « Revenir au style global »). */
  resetLabel?: string;
  compact?: boolean;
  /** Palette effective du thème : couleurs proposées pour le fond du texte et lisibilité (lot 21). */
  palette: CardPalette;
  /** Raison pour laquelle ce texte ne peut pas recevoir de fond (ligne désactivée). */
  backdropBlocked?: string;
  /** Couleur de texte choisie dans le style du rôle (vue depuis « Ce texte »). */
  inheritedColor?: string;
};

export default function TypoControls({ value, onChange, installed, swatch, themeNames, resetLabel = "Réinitialiser", compact, palette, backdropBlocked, inheritedColor }: TypoProps) {
  const [menu, setMenu] = useState(false);
  const set = (patch: Partial<TextStyle>) => {
    const next: TextStyle = { ...value, ...patch };
    for (const k of Object.keys(next) as (keyof TextStyle)[]) if (next[k] === undefined) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const g = googleOf(value.font);
  const family = g ? googleFamily(g) : undefined;
  const weights: readonly number[] = family ? (value.italic && family.italics.length ? family.italics : family.weights) : WEIGHTS;
  const scale = value.scale ?? 1;
  const tracking = value.tracking ?? 0;

  return (
    <div className="tc" data-compact={compact || undefined}>
      <div className="tc-row">
        <button type="button" className="tc-font" aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu((m) => !m)} title="Police">
          <span className="tc-font-name">{value.font ? fontLabel(value.font) : "Police du style"}</span>
          <span aria-hidden="true">▾</span>
        </button>
        <MenuSelect
          label="Taille"
          placeholder="Taille"
          title="Taille du texte"
          emptyLabel="Taille du thème"
          value={value.size ?? ""}
          options={SIZES.map((s) => ({ value: s, label: SIZE_LABELS[s] }))}
          onChange={(v) => set({ size: (v || undefined) as TextStyle["size"], ...(v ? {} : { scale: undefined }) })}
        />
        <span className="tc-step" role="group" aria-label="Ajuster la taille">
          <button type="button" aria-label="Plus petit" title={value.size ? "Plus petit (−5 %)" : "Choisis d'abord une taille"} disabled={!value.size || scale <= 0.5} onClick={() => set({ scale: round(Math.max(0.5, scale - 0.05), 2) === 1 ? undefined : round(Math.max(0.5, scale - 0.05), 2) })}>
            −
          </button>
          <output className="tc-num" aria-live="polite">{Math.round(scale * 100)} %</output>
          <button type="button" aria-label="Plus grand" title={value.size ? "Plus grand (+5 %)" : "Choisis d'abord une taille"} disabled={!value.size || scale >= 2} onClick={() => set({ scale: round(Math.min(2, scale + 0.05), 2) === 1 ? undefined : round(Math.min(2, scale + 0.05), 2) })}>
            +
          </button>
        </span>
        <MenuSelect
          label="Graisse"
          placeholder="Graisse"
          title="Graisse"
          emptyLabel="Graisse du thème"
          value={value.weight ? String(value.weight) : ""}
          options={WEIGHTS.map((w) => {
            const missing = !weights.includes(w);
            return { value: String(w), label: `${w} · ${WEIGHT_LABELS[w]}`, disabled: missing, hint: missing ? "absente" : undefined, style: { fontWeight: w, fontFamily: (value.font && fontStack(value.font)) || undefined } };
          })}
          onChange={(v) => set({ weight: v ? Number(v) : undefined })}
        />
        <button type="button" className="tc-toggle tc-italic" aria-pressed={value.italic === true} title="Italique" onClick={() => set({ italic: value.italic ? undefined : true })}>
          I
        </button>
        <button type="button" className="tc-toggle" aria-pressed={value.case === "upper"} title="MAJUSCULES" onClick={() => set({ case: value.case === "upper" ? "normal" : "upper" })}>
          AA
        </button>
        <span className="tc-step" role="group" aria-label="Interlettrage">
          <button type="button" aria-label="Resserrer les lettres" title="Resserrer" disabled={tracking <= -0.05} onClick={() => set({ tracking: round(Math.max(-0.05, tracking - 0.01), 2) })}>
            ⇥⇤
          </button>
          <output className="tc-num">{round(tracking, 2)} em</output>
          <button type="button" aria-label="Espacer les lettres" title="Espacer" disabled={tracking >= 0.4} onClick={() => set({ tracking: round(Math.min(0.4, tracking + 0.01), 2) })}>
            ⇤⇥
          </button>
        </span>
      </div>
      <div className="tc-row">
        <span className="tc-swatches" role="radiogroup" aria-label="Couleur">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={value.color === c}
              aria-label={PALETTE_LABELS[c]}
              title={PALETTE_LABELS[c]}
              className="tc-swatch"
              style={{ background: swatch(c) }}
              onClick={() => set({ color: value.color === c ? undefined : c })}
            />
          ))}
          <ColorPicker value={value.color} onChange={(color) => set({ color })} swatch={swatch} />
        </span>
        <span className="tc-seg" role="radiogroup" aria-label="Alignement">
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} type="button" role="radio" aria-checked={value.align === a} title={a === "left" ? "À gauche" : a === "center" ? "Centré" : "À droite"} onClick={() => set({ align: value.align === a ? undefined : a })}>
              <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
                {[1, 5, 9].map((y, i) => {
                  const w = i === 1 ? 8 : 12;
                  const x = a === "left" ? 1 : a === "right" ? 13 - w : 7 - w / 2;
                  return <rect key={y} x={x} y={y} width={w} height="1.6" fill="currentColor" />;
                })}
              </svg>
            </button>
          ))}
        </span>
        <button type="button" className="tc-reset" onClick={() => onChange(undefined)} disabled={!Object.keys(value).length}>
          {resetLabel}
        </button>
      </div>
      <BackdropRow value={value} set={set} palette={palette} swatch={swatch} blocked={backdropBlocked} inheritedColor={inheritedColor} />
      {menu && (
        <FontMenu
          value={value.font}
          installed={installed}
          themeNames={themeNames}
          onClose={() => setMenu(false)}
          onPick={(ref) => {
            setMenu(false);
            // Graisse ramenée à une graisse disponible de la famille choisie.
            const fam = googleOf(ref) ? googleFamily(googleOf(ref)!) : undefined;
            const weight = fam && value.weight && !fam.weights.includes(value.weight) ? undefined : value.weight;
            set({ font: ref, weight });
          }}
        />
      )}
    </div>
  );
}
