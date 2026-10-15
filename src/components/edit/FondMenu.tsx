"use client";

/**
 * Fond de couleur d'un composant sur la toile (lot 32) : bouton « Fond » de la barre d'outils du composant (pastille de la couleur
 * courante) et son popover. « Aucun / Couleur » (la liste `KINDS` accueillera un papier peint importé), puis les couleurs de la DA
 * avec leur nom et les teintes douces (CardColorChoices, comme la carte) et « Autre couleur… » (ColorPicker du lot 29).
 * Chaque choix est appliqué à l'instant (aperçu optimiste, `previewFond`) et envoyé à l'éditeur (intention `background`) ;
 * Annuler / Rétablir passent par l'historique de l'éditeur. Texte illisible sur la couleur : avertissement seulement.
 * À ne pas confondre avec « Carte » (la carte posée sous une rubrique, SurfaceMenu) ni « Fond du texte » (BackdropRow).
 */
import { useRef, useState } from "react";

import { parseColor, rgbaToHex } from "@/lib/color";
import { PALETTE } from "@/lib/look";
import { fondColor, readBackground, type Background } from "@/themes/fond";
import { cardStyle, isSurfaceToken } from "@/themes/surface";

import CardColorChoices from "./CardColorChoices";
import ColorPicker from "./ColorPicker";
import { canvasPalette, fondState, postIntent, previewFond } from "./optimistic";
import { ratioTip, readabilityText } from "./readability";
import { useDismiss } from "./useDismiss";

import "@/app/admin/typo-controls.css";
import "@/app/admin/surface-menu.css";

/** Natures de fond proposées (un papier peint importé s'y ajoutera). */
const KINDS: { kind: "none" | Background["kind"]; label: string }[] = [
  { kind: "none", label: "Aucun" },
  { kind: "color", label: "Couleur" },
];
/** Couleur posée au premier choix « Couleur » : le fond profond du thème. */
const FIRST_COLOR = "bgDeep";

const swatch = (c: (typeof PALETTE)[number]) => `var(--t-color-${c})`;

function summary(cur: Background | null) {
  const color = fondColor(cur ?? undefined);
  return color ? { color, style: cardStyle(color, canvasPalette()) } : null;
}

/** Bouton « Fond » de la barre d'outils : pastille de la couleur du fond (vide : aucun). */
export function FondButton({ uid, open, onToggle }: { uid: string; open: boolean; onToggle: () => void }) {
  const s = summary(fondState(uid));
  return (
    <button type="button" className="pe-tool-text sm-button" data-testid="fond-button" aria-haspopup="dialog" aria-expanded={open} title="Fond de couleur du composant, sur toute sa hauteur" onClick={onToggle}>
      <span className="sm-dot" data-on={s ? "" : undefined} style={s ? { background: s.style.bg } : undefined} aria-hidden="true" />
      Fond
      {s && !s.style.ok && (
        <span className="sm-alert" data-testid="fond-alert" title="Texte peu lisible sur cette couleur" aria-label="Texte peu lisible sur cette couleur">
          !
        </span>
      )}
    </button>
  );
}

export default function FondMenu({ uid, top, onClose, onChanged }: { uid: string; top: number; onClose: () => void; onChanged: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState<Background | null>(() => fondState(uid));
  useDismiss(ref, onClose);

  const change = (next: Background | null, continuous = false) => {
    setCur(next);
    const seq = postIntent({ kind: "background", uid, background: next, ...(continuous ? { continuous: true } : {}) });
    previewFond(uid, next, seq);
    onChanged();
  };
  const color = fondColor(cur ?? undefined);
  const s = summary(cur);
  const customColor = color && !isSurfaceToken(color) ? color : undefined;
  const setColor = (c: string, continuous = false) => change(readBackground({ kind: "color", color: c }) ?? null, continuous);

  /** Couleur choisie dans la roue : une teinte de la palette devient un jeton si on en connaît un, sinon sa valeur. */
  const fromPicker = (c: string | undefined) => {
    if (c === undefined) return;
    if ((PALETTE as readonly string[]).includes(c) && !isSurfaceToken(c)) {
      const rgba = parseColor(getComputedStyle(document.documentElement).getPropertyValue(`--t-color-${c}`));
      if (rgba) return setColor(rgbaToHex({ ...rgba, a: 1 }), true);
    }
    setColor(c, true);
  };
  const active = cur ? cur.kind : "none";

  return (
    <div ref={ref} className="sm tc" role="dialog" aria-label="Fond du composant" data-testid="fond-menu" style={{ top }}>
      <div className="tc-row">
        <span className="sm-label">Fond</span>
        <span className="tc-seg" role="radiogroup" aria-label="Nature du fond">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={active === k.kind}
              data-kind={k.kind}
              onClick={() => (k.kind === "none" ? change(null) : active !== k.kind && setColor(FIRST_COLOR))}
            >
              {k.label}
            </button>
          ))}
        </span>
      </div>
      {color && s ? (
        <>
          <div className="tc-row">
            <span className="sm-label">Couleur</span>
            <CardColorChoices palette={canvasPalette()} value={color} onPick={(t) => setColor(t)} label="Couleur du fond" />
          </div>
          <div className="tc-row">
            <span className="sm-label" aria-hidden="true" />
            <span className="tc-swatches">
              <ColorPicker value={customColor} onChange={fromPicker} swatch={swatch} />
            </span>
            <span className="sm-hint">Autre couleur…</span>
          </div>
          <p className="sm-hint">La couleur va d&apos;un bord à l&apos;autre de la carte (ou de la page) et sur toute la hauteur du composant. Deux composants de même couleur qui se suivent ne font plus qu&apos;un seul bloc.</p>
          {!s.style.ok && (
            <p className="sm-warn" role="status" data-testid="fond-warning" title={ratioTip(s.style.ratio)}>
              <span className="sm-alert" aria-hidden="true">
                !
              </span>
              {readabilityText(s.style.ratio)} : le texte se lit mal sur cette couleur. Essaie une teinte plus claire ou plus foncée.
            </p>
          )}
        </>
      ) : (
        <p className="sm-hint">Colore tout le composant, d&apos;un bord à l&apos;autre. Le texte passe tout seul à la couleur la plus lisible.</p>
      )}
    </div>
  );
}
