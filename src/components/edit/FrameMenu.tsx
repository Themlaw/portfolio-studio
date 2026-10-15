"use client";

/**
 * Cadre autour d'une photo (lot 34) : un interrupteur « Cadre », puis, quand il est actif, l'épaisseur (Fin / Moyen / Épais)
 * et la couleur — « Couleur par défaut » (la couleur du texte du thème : elle suit le thème), une pastille de la palette
 * du site, ou une couleur libre (le sélecteur du lot 29, `ColorPicker`). Aucun cadre par défaut.
 *
 * `FrameControls` est le contenu, partagé par le bouton « Cadre » de la barre d'une image seule / d'une case de grille
 * (`FrameMenu`, ci-dessous : réglage `look.frame` du bloc) et par la barre d'une image de planche (BoardLayer :
 * `look.slotFrame` du bloc planche, par emplacement). Chaque choix part aussitôt (intention `look`, annulable).
 * Les pastilles montrent les couleurs du thème par leurs variables, jamais en dur.
 */
import { useRef } from "react";

import { FRAME_DEFAULT_COLOR, FRAME_SIZE_LABELS, FRAME_SIZES, frameColorCss, PALETTE_DISPLAY, PALETTE_LABELS, type Frame, type PaletteColor } from "@/lib/look";

import ColorPicker from "./ColorPicker";
import { lookOf, sendLook } from "./LookLayer";
import { useDismiss } from "./useDismiss";

import "@/app/admin/typo-controls.css";
import "@/app/admin/surface-menu.css";

const swatch = (c: PaletteColor) => `var(--t-color-${c})`;
const isPalette = (v: string | undefined): v is PaletteColor => (PALETTE_DISPLAY as readonly string[]).includes(v ?? "");

/** Interrupteur + épaisseur + couleur. `value` absent = pas de cadre ; `onChange(undefined)` le retire. */
export function FrameControls({ value, onChange }: { value: Frame | undefined; onChange: (next: Frame | undefined) => void }) {
  const on = value !== undefined;
  const patch = (p: Partial<Frame>) => {
    const next = { ...(value ?? { size: "medium" as const }), ...p };
    if (next.color === undefined) delete next.color;
    onChange(next as Frame);
  };
  const custom = value?.color && !isPalette(value.color) ? value.color : undefined;
  const colorName = !value ? "" : value.color === undefined ? "Couleur par défaut" : isPalette(value.color) ? PALETTE_LABELS[value.color] : "Couleur libre";
  return (
    <div className="fr" data-testid="frame-controls">
      <button type="button" role="switch" aria-checked={on} className="sm-switch" data-testid="frame-switch" onClick={() => onChange(on ? undefined : { size: "medium" })}>
        <span className="sm-switch-track" aria-hidden="true">
          <span />
        </span>
        Cadre
      </button>
      {on ? (
        <>
          <div className="tc-row">
            <span className="sm-label">Épaisseur</span>
            <span className="tc-seg" role="radiogroup" aria-label="Épaisseur du cadre">
              {FRAME_SIZES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={value.size === s} data-frame-size={s} onClick={() => patch({ size: s })}>
                  {FRAME_SIZE_LABELS[s]}
                </button>
              ))}
            </span>
          </div>
          <div className="tc-row">
            <span className="sm-label">Couleur</span>
            <span className="tc-swatches" role="radiogroup" aria-label="Couleur du cadre">
              <button
                type="button"
                role="radio"
                aria-checked={value.color === undefined}
                aria-label="Couleur par défaut"
                title="Couleur par défaut : celle du texte du thème"
                className="tc-swatch"
                data-frame-color="default"
                style={{ background: frameColorCss(undefined) }}
                onClick={() => patch({ color: undefined })}
              />
              {PALETTE_DISPLAY.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={value.color === c}
                  aria-label={PALETTE_LABELS[c]}
                  title={PALETTE_LABELS[c]}
                  className="tc-swatch"
                  data-frame-color={c}
                  style={{ background: swatch(c) }}
                  onClick={() => patch({ color: c })}
                />
              ))}
              <ColorPicker value={custom} onChange={(color) => patch({ color })} swatch={swatch} />
            </span>
          </div>
          <p className="sm-hint fr-color-name" data-testid="frame-color-name">
            {colorName}
            {value.color === undefined && ` (${PALETTE_LABELS[FRAME_DEFAULT_COLOR].toLowerCase()} du thème)`}
          </p>
        </>
      ) : (
        <p className="sm-hint">Ajoute un cadre autour de la photo. Il ne change ni la taille ni la place de la photo.</p>
      )}
    </div>
  );
}

/** Bouton « Cadre » de la barre d'outils d'une image : pastille de la couleur du cadre (vide : pas de cadre). */
export function FrameButton({ uid, open, onToggle }: { uid: string; open: boolean; onToggle: () => void }) {
  const frame = lookOf(uid).frame;
  return (
    <button type="button" className="pe-tool-text sm-button" aria-haspopup="dialog" aria-expanded={open} data-testid="frame-button" title="Cadre autour de la photo" onClick={onToggle}>
      <span className="sm-dot" data-on={frame ? "" : undefined} style={frame ? { background: frameColorCss(frame.color) } : undefined} aria-hidden="true" />
      Cadre
    </button>
  );
}

/** Fenêtre du bouton « Cadre » d'une image seule ou d'une case de grille (réglage `look.frame` du bloc). */
export default function FrameMenu({ uid, top, onClose, onChanged }: { uid: string; top: number; onClose: () => void; onChanged: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const change = (next: Frame | undefined) => {
    sendLook(uid, { ...lookOf(uid), frame: next });
    onChanged();
  };
  return (
    <div ref={ref} className="sm tc" role="dialog" aria-label="Cadre de la photo" style={{ top }}>
      <FrameControls value={lookOf(uid).frame} onChange={change} />
    </div>
  );
}
