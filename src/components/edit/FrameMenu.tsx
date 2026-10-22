"use client";

/**
 * Cadre autour d'une photo ou d'une vidéo (lots 34 et 62) : UN seul choix, « Aucun · Cadre du thème · Bande de couleur » (boutons
 * radio : ce qui s'affiche est exactement le choix coché). « Cadre du thème » (le cadre dessiné dans le kit) n'est proposé que si le thème
 * en dessine un. « Bande de couleur » montre l'épaisseur (Fin / Moyen / Épais) et la couleur : « Couleur par défaut » (la couleur du
 * texte du thème : elle suit le thème), une pastille de la palette du site, ou une couleur libre (le sélecteur du lot 29, `ColorPicker`).
 * Sans choix, la photo suit le réglage du site « Cadre du thème sur toutes les photos » (Admin → Thèmes, non par défaut) : c'est ce que
 * le menu coche alors.
 *
 * `FrameControls` est le contenu, partagé par le bouton « Cadre » de la barre d'une image ou d'une vidéo seule / d'une case de grille
 * (réglage `look.frame` du bloc), par la barre d'une image ou d'une vidéo de planche (BoardLayer :
 * `look.slotFrame` du bloc planche, par emplacement) et par celle de la Planche libre. La fenêtre est `FrameWindow` (un seul
 * `Popover` ancré au bouton). Chaque choix part aussitôt (intention `look`, annulable). Les pastilles montrent les couleurs du thème par leurs variables, jamais en dur.
 */
import { useState } from "react";

import { FRAME_DEFAULT_COLOR, FRAME_DEFAULT_WIDTH, FRAME_KIND_LABELS, FRAME_WIDTH_LABELS, FRAME_WIDTHS, frameColorCss, PALETTE_DISPLAY, PALETTE_LABELS, type Frame, type PaletteColor } from "@/lib/look";

import ColorPicker from "./ColorPicker";
import { lookOf } from "./LookLayer";
import Popover, { type PopoverAnchor, useLocalValue } from "./Popover";

import "@/app/admin/typo-controls.css";
import "@/app/admin/surface-menu.css";

const swatch = (c: PaletteColor) => `var(--t-color-${c})`;
const isPalette = (v: string | undefined): v is PaletteColor => (PALETTE_DISPLAY as readonly string[]).includes(v ?? "");

/** Le thème en ligne dessine-t-il un cadre (kit) ? La toile porte `data-kit-frame` sur `<html>` comme le site. */
const themeHasFrame = () => typeof document !== "undefined" && document.documentElement.hasAttribute("data-kit-frame");
/** Réglage du site « Cadre du thème sur toutes les photos » : posé sur `.site-frame` par le cadre du site. */
const siteFramesAll = () => typeof document !== "undefined" && document.querySelector("[data-frame-all]") !== null;

type Choice = "none" | "theme" | "band";

/** Un seul choix + (bande) épaisseur et couleur. `value` absent = pas de choix (suit le site) ; `onChange(undefined)` y revient. */
export function FrameControls({ value, onChange, what = "photo" }: { value: Frame | undefined; onChange: (next: Frame | undefined) => void; what?: "photo" | "vidéo" }) {
  const kit = themeHasFrame();
  // Sans choix, ce qui s'affiche est le réglage du site : une photo suit « sur toutes les photos », une vidéo n'a jamais de cadre.
  const implicit: Choice = what === "photo" && kit && siteFramesAll() ? "theme" : "none";
  const shown: Choice = value ? (value.kind === "custom" ? "none" : value.kind) : implicit;
  // Réglages de la bande gardés d'un choix à l'autre (Bande → Aucun → Bande retrouve l'épaisseur et la couleur).
  const [kept, setKept] = useState<{ width?: Frame["width"]; color?: string }>({ width: value?.width, color: value?.color });
  const base = value?.kind === "band" ? { width: value.width, color: value.color } : kept;
  const bandOf = (b: { width?: Frame["width"]; color?: string }): Frame => {
    const f: Frame = { kind: "band", width: b.width ?? FRAME_DEFAULT_WIDTH };
    if (b.color !== undefined) f.color = b.color;
    return f;
  };
  const choose = (kind: Choice) => {
    if (kind === "band") return onChange(bandOf(base));
    setKept(base);
    onChange({ kind });
  };
  const patch = (p: Partial<Frame>) => {
    const next = { ...bandOf(base), ...p } as Frame;
    if (next.color === undefined) delete next.color;
    setKept({ width: next.width, color: next.color });
    onChange(next);
  };
  const kinds: Choice[] = kit || value?.kind === "theme" ? ["none", "theme", "band"] : ["none", "band"];
  const bandOn = shown === "band" && value?.kind === "band";
  const custom = bandOn && value.color && !isPalette(value.color) ? value.color : undefined;
  const colorName = !bandOn ? "" : value.color === undefined ? "Couleur par défaut" : isPalette(value.color) ? PALETTE_LABELS[value.color] : "Couleur libre";
  return (
    <div className="fr" data-testid="frame-controls">
      <span className="tc-seg fr-kinds" role="radiogroup" aria-label={`Cadre de la ${what}`}>
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={shown === k} data-frame-kind={k} onClick={() => shown !== k && choose(k)}>
            {FRAME_KIND_LABELS[k]}
          </button>
        ))}
      </span>
      {shown === "none" && <p className="sm-hint">{what === "photo" ? "Cette photo n'a pas de cadre." : "Cette vidéo n'a pas de cadre."}</p>}
      {shown === "theme" && (
        <p className="sm-hint">
          {kit ? `Le cadre dessiné dans ton thème entoure ${what === "photo" ? "la photo" : "la vidéo"}. Il ne change ni la taille ni la place.` : "Ton thème actuel ne dessine pas de cadre : rien ne s'affiche."}
          {!value && " (Réglage du site : cadre du thème sur toutes les photos.)"}
        </p>
      )}
      {bandOn && (
        <>
          <div className="tc-row">
            <span className="sm-label">Épaisseur</span>
            <span className="tc-seg" role="radiogroup" aria-label="Épaisseur du cadre">
              {FRAME_WIDTHS.map((w) => (
                <button key={w} type="button" role="radio" aria-checked={(value.width ?? FRAME_DEFAULT_WIDTH) === w} data-frame-width={w} onClick={() => patch({ width: w })}>
                  {FRAME_WIDTH_LABELS[w]}
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
      )}
      {value && what === "photo" && kit && (
        <button type="button" className="sm-link" data-testid="frame-follow-site" onClick={() => onChange(undefined)}>
          Suivre le réglage du site
        </button>
      )}
    </div>
  );
}

/** Bouton « Cadre » de la barre d'outils d'une image : pastille de la couleur du cadre (vide : pas de cadre). */
export function FrameButton({ uid, open, onToggle, what = "photo" }: { uid: string; open: boolean; onToggle: () => void; what?: "photo" | "vidéo" }) {
  const frame = lookOf(uid).frame;
  // Pastille pleine dès qu'un cadre est choisi (la couleur de la bande, sinon la teinte d'accent du menu).
  const shown = frame && frame.kind !== "none" ? frame : undefined;
  return (
    <button type="button" className="pe-tool-text sm-button" aria-haspopup="dialog" aria-expanded={open} data-testid="frame-button" title={what === "vidéo" ? "Cadre autour de la vidéo" : "Cadre autour de la photo"} onClick={onToggle}>
      <span className="sm-dot" data-on={shown ? "" : undefined} style={shown?.kind === "band" ? { background: frameColorCss(shown.color) } : undefined} aria-hidden="true" />
      Cadre
    </button>
  );
}

/**
 * Fenêtre « Cadre » (lot 65) : UNE seule, ancrée au bouton `anchor`, pour tous les conteneurs. Chaque appelant donne sa valeur et son
 * écriture : page (`look.frame` du bloc, `sendLook`), case de grille (même chose), composant de planche (`props.look.frame` du projet,
 * écriture `item-frame`), image de carrousel (`look.slotFrame[slug]`) et image de Planche libre (`items[].frame`).
 */
export default function FrameWindow({ anchor, value, onChange, onClose, what = "photo", testId }: { anchor: PopoverAnchor; value: Frame | undefined; onChange: (next: Frame | undefined) => void; onClose: () => void; what?: "photo" | "vidéo"; testId?: string }) {
  const [cur, setCur] = useLocalValue(value);
  return (
    <Popover anchor={anchor} label={`Cadre de la ${what}`} testId={testId} onClose={onClose}>
      <FrameControls
        value={cur}
        onChange={(next) => {
          setCur(next);
          onChange(next);
        }}
        what={what}
      />
    </Popover>
  );
}
