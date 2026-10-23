"use client";

/**
 * Ligne « Fond » de la barre typographique (lot 21) : `Fond : [Aucun] [Ombre douce] [Bandeau] [Surlignage] ●`.
 * UNE ligne pour tous les textes (titre, étiquette, paragraphe, légende, libellés de l'ouverture, nom du site,
 * menu, pied de page…), « Ce texte » comme « Tous les X » : elle fait partie de TypoControls, rien n'en
 * dépend du rôle. Si un rôle ne peut pas recevoir de fond, la ligne reste là, désactivée, avec la raison.
 *
 * La pastille `●` (une seule) n'apparaît qu'avec un fond autre que « Aucun » : la couleur courante, « Auto »
 * (couleur du thème) par défaut. Au clic, un petit popover : Auto, les couleurs de la DA et les teintes douces
 * (CardColorChoices, partagé avec les cartes), « Autre couleur… » (ColorPicker). La couleur s'enregistre comme
 * jeton (suit la palette) ou `#rrggbb[aa]`. Une pastille « ! » signale un texte de couleur choisie peu lisible
 * sur ce fond (jamais bloquant) ; sans couleur de texte choisie, le texte est rendu lisible automatiquement.
 */
import { useRef, useState } from "react";

import { parseColor, rgbaToHex } from "@/lib/color";
import { BACKDROP_LABELS, BACKDROPS, PALETTE, type PaletteColor, type TextStyle } from "@/lib/look";
import { AIR_LABELS, AIRS } from "@/themes/backdrop-air";
import { backdropContrast, TEXT_PALETTE_KEYS } from "@/themes/text-backdrop";
import { cardBackground, isSurfaceToken, type CardPalette } from "@/themes/surface";

import CardColorChoices from "./CardColorChoices";
import ColorPicker from "./ColorPicker";
import { ratioTip, readabilityText } from "./readability";
import { useDismiss } from "./useDismiss";

export type BackdropRowProps = {
  value: TextStyle;
  set: (patch: Partial<TextStyle>) => void;
  palette: CardPalette;
  /** Couleur CSS d'une teinte de la palette (comme TypoControls). */
  swatch: (c: PaletteColor) => string;
  /** Raison pour laquelle ce texte ne peut pas recevoir de fond : ligne désactivée, infobulle. */
  blocked?: string;
  /** Couleur de texte choisie ailleurs (style du rôle, vu depuis « Ce texte »). */
  inheritedColor?: string;
};

export default function BackdropRow({ value, set, palette, swatch, blocked, inheritedColor }: BackdropRowProps) {
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const colored = value.backdrop !== undefined && value.backdrop !== "none";
  const customColor = value.backdropColor && !isSurfaceToken(value.backdropColor) ? value.backdropColor : undefined;
  useDismiss(pop, () => setOpen(false), { enabled: open });

  const pick = (b: (typeof BACKDROPS)[number]) => {
    // Re-cliquer le fond choisi le retire (retour au thème) ; « Aucun » est un choix à part (efface celui du thème).
    if (value.backdrop === b) set({ backdrop: undefined, backdropColor: undefined });
    else set({ backdrop: b, backdropColor: b === "none" ? undefined : value.backdropColor });
    if (b === "none") setOpen(false);
  };
  /** Couleur de la roue : une teinte de la palette devient un jeton si les fonds en connaissent un, sinon sa valeur. */
  const fromPicker = (c: string | undefined) => {
    if (c === undefined || !(PALETTE as readonly string[]).includes(c)) return set({ backdropColor: c });
    if (isSurfaceToken(c)) return set({ backdropColor: c });
    const key = TEXT_PALETTE_KEYS[c];
    const rgba = key ? parseColor(palette[key]) : null;
    set({ backdropColor: rgba ? rgbaToHex({ ...rgba, a: 1 }) : undefined });
  };

  const textColor = value.color ?? inheritedColor;
  const verdict = colored ? backdropContrast(value.backdropColor, textColor, palette) : null;
  const low = verdict !== null && !verdict.ok;
  // Pastille : la couleur choisie ; « Auto » montre celle que le thème met (fond pour l'ombre et le bandeau, couleur principale pour le surlignage).
  const chip = value.backdropColor ? cardBackground(value.backdropColor, palette) : value.backdrop === "highlight" ? palette.primary : palette.bg;
  const name = value.backdropColor ? "couleur choisie" : "Auto";

  // Aération (lot 68) : seulement pour les fonds qui ont une marge (Bandeau, Surlignage). Absent = celle du thème (Normal par défaut).
  const airy = (value.backdrop === "band" || value.backdrop === "highlight") && !blocked;
  return (
    <>
    <div className="tc-row tc-bd" title={blocked}>
      <span className="tc-bd-label">
        Fond du texte :
      </span>
      <span className="tc-seg" role="radiogroup" aria-label="Fond du texte">
        {BACKDROPS.map((b) => (
          <button key={b} type="button" role="radio" aria-checked={value.backdrop === b} disabled={Boolean(blocked)} data-backdrop={b} onClick={() => pick(b)}>
            {BACKDROP_LABELS[b]}
          </button>
        ))}
      </span>
      {blocked && <span className="tc-bd-why">{blocked}</span>}
      {colored && !blocked && (
        <span className="tc-bd-color">
          <button
            type="button"
            className="tc-swatch tc-bd-dot"
            data-auto={value.backdropColor ? undefined : ""}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={`Couleur du fond : ${name}`}
            title={`Couleur du fond : ${name}`}
            style={{ background: chip }}
            onClick={() => setOpen((o) => !o)}
          >
            {!value.backdropColor && <span aria-hidden="true">A</span>}
          </button>
          {low && (
            <span className="tc-bd-alert" data-testid="bd-alert" role="img" title={`Texte peu lisible sur ce fond. ${ratioTip(verdict.ratio)}`} aria-label={`Texte peu lisible sur ce fond (${readabilityText(verdict.ratio).toLowerCase()})`}>
              !
            </span>
          )}
          {open && (
            <div ref={pop} className="bd-pop tc" role="dialog" aria-label="Couleur du fond du texte">
              <button type="button" className="bd-auto" aria-pressed={!value.backdropColor} onClick={() => set({ backdropColor: undefined })}>
                Auto
              </button>
              <CardColorChoices palette={palette} value={value.backdropColor && isSurfaceToken(value.backdropColor) ? value.backdropColor : customColor ?? ""} onPick={(t) => set({ backdropColor: t })} label="Couleur du fond" />
              <div className="tc-row">
                <span className="tc-swatches">
                  <ColorPicker value={customColor} onChange={fromPicker} swatch={swatch} />
                </span>
                <span className="bd-hint">Autre couleur…</span>
              </div>
              <p className="bd-hint" role="note">
                {textColor ? "Couleur de texte choisie : conservée, même peu lisible." : "Le texte devient lisible tout seul sur une couleur de fond."}
              </p>
            </div>
          )}
        </span>
      )}
    </div>
    {airy && (
      <div className="tc-row tc-air">
        <span className="tc-bd-label">Aération du fond :</span>
        <span className="tc-seg" role="radiogroup" aria-label="Aération du fond">
          {AIRS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={(value.air ?? "normal") === a} data-air={a} onClick={() => set({ air: a === "normal" && value.air === undefined ? undefined : a })}>
              {AIR_LABELS[a]}
            </button>
          ))}
        </span>
      </div>
    )}
    </>
  );
}
