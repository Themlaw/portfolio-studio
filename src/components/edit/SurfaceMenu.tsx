"use client";

/**
 * Carte d'une rubrique sur la toile (lot 17c ; bouton « Fond » jusqu'à la v0.19, renommé « Carte » au lot 26 : la
 * couleur de la carte posée sous la rubrique, à ne pas confondre avec le « Fond du texte » de la barre d'un texte) :
 * bouton « Carte » de la barre d'outils du bloc (pastille de la couleur courante) et son popover — interrupteur « Une carte sous la rubrique »,
 * couleurs de la DA du thème (avec leur nom) et teintes douces (CardColorChoices, lot 19b), « Autre couleur… » (ColorPicker), Pleine largeur /
 * En retrait, Coins droits / arrondis. Chaque choix est appliqué à l'instant (aperçu
 * optimiste, edit/optimistic.ts) et envoyé à l'éditeur (intention `surface`, validée par
 * le protocole) ; Annuler / Rétablir passent par l'historique de l'éditeur.
 * Si même avec le texte lisible choisi par `cardStyle` le contraste reste sous AA, une
 * pastille d'alerte le dit (jamais bloquant).
 */
import { useRef, useState } from "react";

import { parseColor, rgbaToHex } from "@/lib/color";
import { PALETTE } from "@/lib/look";
import {
  cardStyle,
  cleanSurface,
  isSurfaceToken,
  resolveSurface,
  PAPER_ON_CARDS_DEFAULT,
  resolvePaper,
  SURFACE_CORNER_LABELS,
  SURFACE_CORNERS,
  SURFACE_PAPER_LABELS,
  SURFACE_PAPERS,
  SURFACE_WIDTH_LABELS,
  SURFACE_WIDTHS,
  type ResolvedSurface,
  type Surface,
} from "@/themes/surface";

import CardColorChoices from "./CardColorChoices";
import ColorPicker from "./ColorPicker";
import { canvasPalette, postIntent, previewSurface, surfaceState } from "./optimistic";
import { ratioTip, readabilityText } from "./readability";
import { useDismiss } from "./useDismiss";

import "@/app/admin/typo-controls.css";
import "@/app/admin/surface-menu.css";

/** Papier du site tel que la toile l'affiche : présent dans le thème actif ? montré sur les cartes ? à quelle intensité ? */
function sitePaper() {
  const root = document.documentElement;
  const raw = Number.parseFloat(getComputedStyle(root).getPropertyValue("--t-kit-paper-cards"));
  return { has: root.hasAttribute("data-kit-paper"), onCards: root.hasAttribute("data-kit-paper-cards"), opacity: Number.isFinite(raw) ? raw : PAPER_ON_CARDS_DEFAULT };
}

const swatch = (c: (typeof PALETTE)[number]) => `var(--t-color-${c})`;


/** Résumé du fond courant : réglages complets + contraste du texte sur cette carte. */
function summary(cur: Surface | null, defaults: ResolvedSurface) {
  if (!cur) return null;
  const resolved = resolveSurface(cur, defaults);
  return { resolved, style: cardStyle(resolved.color, canvasPalette()) };
}

/** Bouton « Carte » de la barre d'outils : pastille de la couleur de la carte (vide : pas de carte). */
export function SurfaceButton({ uid, open, onToggle }: { uid: string; open: boolean; onToggle: () => void }) {
  const { surface, defaults } = surfaceState(uid);
  const s = summary(surface, defaults);
  return (
    <button type="button" className="pe-tool-text sm-button" aria-haspopup="dialog" aria-expanded={open} title="Carte de la rubrique : une carte colorée posée sur le papier du site" onClick={onToggle}>
      <span className="sm-dot" data-on={s ? "" : undefined} style={s ? { background: s.style.bg } : undefined} aria-hidden="true" />
      Carte
      {s && !s.style.ok && (
        <span className="sm-alert" data-testid="surface-alert" title="Texte peu lisible sur cette couleur" aria-label="Texte peu lisible sur cette couleur">
          !
        </span>
      )}
    </button>
  );
}

export default function SurfaceMenu({ uid, top, onClose, onChanged }: { uid: string; top: number; onClose: () => void; onChanged: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const initial = surfaceState(uid);
  const [cur, setCur] = useState<Surface | null>(initial.surface);
  const defaults = initial.defaults;
  useDismiss(ref, onClose);

  // `continuous` : roue ou curseur du sélecteur de couleur (fusionnés dans l'historique) ; un clic (pastille, largeur, coins, interrupteur) est un pas à lui seul.
  const change = (next: Surface | null, continuous = false) => {
    setCur(next);
    const seq = postIntent({ kind: "surface", uid, surface: next, ...(continuous ? { continuous: true } : {}) });
    previewSurface(uid, next, seq);
    onChanged();
  };
  const patch = (p: Partial<Surface>, continuous = false) => change(cleanSurface({ ...(cur ?? {}), ...p }), continuous);

  const s = summary(cur, defaults);
  const site = sitePaper();
  const paper = cur ? resolvePaper(cur, site) : null;
  const customColor = cur?.color && !isSurfaceToken(cur.color) ? cur.color : undefined;

  /** Couleur choisie dans la roue : une teinte de la palette devient un jeton si la carte en connaît un, sinon sa valeur. */
  const fromPicker = (c: string | undefined) => {
    if (c === undefined || !(PALETTE as readonly string[]).includes(c)) return patch({ color: c }, true);
    if (isSurfaceToken(c)) return patch({ color: c }, true);
    const raw = getComputedStyle(document.documentElement).getPropertyValue(`--t-color-${c}`);
    const rgba = parseColor(raw);
    patch({ color: rgba ? rgbaToHex({ ...rgba, a: 1 }) : undefined }, true);
  };

  return (
    <div ref={ref} className="sm tc" role="dialog" aria-label="Carte de la rubrique" style={{ top }}>
      <button type="button" role="switch" aria-checked={s !== null} className="sm-switch" onClick={() => change(s ? null : {})}>
        <span className="sm-switch-track" aria-hidden="true">
          <span />
        </span>
        Une carte sous la rubrique
      </button>
      {s ? (
        <>
          <div className="tc-row">
            <span className="sm-label">Couleur de la carte</span>
            <CardColorChoices palette={canvasPalette()} value={s.resolved.color} onPick={(t) => patch({ color: t })} />
          </div>
          <div className="tc-row">
            <span className="sm-label" aria-hidden="true" />
            <span className="tc-swatches">
              <ColorPicker value={customColor} onChange={fromPicker} swatch={swatch} />
            </span>
            <span className="sm-hint">Autre couleur…</span>
          </div>
          <div className="tc-row">
            <span className="sm-label">Largeur</span>
            <span className="tc-seg" role="radiogroup" aria-label="Largeur de la carte">
              {SURFACE_WIDTHS.map((w) => (
                <button key={w} type="button" role="radio" aria-checked={s.resolved.width === w} data-width={w} onClick={() => patch({ width: w })}>
                  {SURFACE_WIDTH_LABELS[w]}
                </button>
              ))}
            </span>
          </div>
          <div className="tc-row">
            <span className="sm-label">Coins</span>
            <span className="tc-seg" role="radiogroup" aria-label="Coins de la carte">
              {SURFACE_CORNERS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={s.resolved.corners === c} data-corners={c} onClick={() => patch({ corners: c })}>
                  {SURFACE_CORNER_LABELS[c]}
                </button>
              ))}
            </span>
          </div>
          {site.has ? (
            <>
              <div className="tc-row">
                <span className="sm-label">Papier du site</span>
                <span className="tc-seg" role="radiogroup" aria-label="Papier du site sur la carte" data-testid="surface-paper">
                  <button type="button" role="radio" aria-checked={cur?.paper === undefined} data-paper="site" onClick={() => patch({ paper: undefined, paperOpacity: undefined })}>
                    Comme le site ({site.onCards ? "sur" : "sous"})
                  </button>
                  {SURFACE_PAPERS.map((p) => (
                    <button key={p} type="button" role="radio" aria-checked={cur?.paper === p} data-paper={p} onClick={() => patch({ paper: p })}>
                      {SURFACE_PAPER_LABELS[p]}
                    </button>
                  ))}
                </span>
              </div>
              {paper?.over && (
                <div className="tc-row">
                  <span className="sm-label">Intensité</span>
                  <input
                    type="range"
                    className="sm-range"
                    min={0}
                    max={60}
                    step={1}
                    value={Math.round(paper.opacity * 100)}
                    aria-label="Intensité du papier sur la carte"
                    data-testid="surface-paper-opacity"
                    onChange={(e) => patch({ paperOpacity: Number(e.target.value) / 100 }, true)}
                  />
                  <span className="sm-hint">{Math.round(paper.opacity * 100)} %</span>
                </div>
              )}
            </>
          ) : (
            <p className="sm-hint" data-testid="surface-paper-none">Le thème actif n&apos;a pas de papier dessiné : rien à montrer sur la carte.</p>
          )}
          {!s.style.ok && (
            <p className="sm-warn" role="status" data-testid="surface-warning" title={ratioTip(s.style.ratio)}>
              <span className="sm-alert" aria-hidden="true">
                !
              </span>
              {readabilityText(s.style.ratio)} : le texte se lit mal sur cette couleur. Essaie une teinte plus claire ou plus foncée.
            </p>
          )}
        </>
      ) : (
        <p className="sm-hint">Pose cette rubrique sur une carte colorée : le papier du site se voit autour. La couleur du texte, elle, se règle sur le texte (« Fond du texte »).</p>
      )}
    </div>
  );
}
