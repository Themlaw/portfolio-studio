"use client";

/**
 * Fond de couleur d'un composant sur la toile (lot 32) : bouton « Fond » de la barre d'outils du composant (pastille de la couleur
 * courante) et son popover. « Aucun / Couleur / Papier peint » (lot 35 : un motif de la bibliothèque, une couleur facultative dessous, sa
 * taille et son opacité), puis les couleurs de la DA
 * avec leur nom et les teintes douces (CardColorChoices, comme la carte) et « Autre couleur… » (ColorPicker du lot 29).
 * Chaque choix est appliqué à l'instant (aperçu optimiste, `previewFond`) et envoyé à l'éditeur (intention `background`) ;
 * Annuler / Rétablir passent par l'historique de l'éditeur. Texte illisible sur la couleur : avertissement seulement.
 * À ne pas confondre avec « Carte » (la carte posée sous une rubrique, SurfaceMenu) ni « Fond du texte » (BackdropRow).
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { parseColor, rgbaToHex } from "@/lib/color";
import { PALETTE } from "@/lib/look";
import { fondColor, readBackground, type Background, type FondStep } from "@/themes/fond";
import { cardStyle, isSurfaceToken } from "@/themes/surface";

import CardColorChoices from "./CardColorChoices";
import ColorPicker from "./ColorPicker";
import { canvasPalette, fondState, postIntent, previewFond, wallpaperCatalog } from "./optimistic";
import { ratioTip, readabilityText } from "./readability";
import { useDismiss } from "./useDismiss";
import { WallpaperGrid, WallpaperPaintRows } from "./WallpaperChoices";

import "@/app/admin/typo-controls.css";
import "@/app/admin/surface-menu.css";

/** Natures de fond proposées. */
const KINDS: { kind: "none" | Background["kind"]; label: string }[] = [
  { kind: "none", label: "Aucun" },
  { kind: "color", label: "Couleur" },
  { kind: "wallpaper", label: "Papier peint" },
];
/** Couleur posée au premier choix « Couleur » : le fond profond du thème. */
const FIRST_COLOR = "bgDeep";

/** Étendue et coins (lot 43) : réglages communs à tout fond, gardés quand on change de couleur ou de nature. */
type Shape = { inset?: FondStep; round?: FondStep };
const STEPS: { step: FondStep; label: string }[] = [
  { step: "s", label: "Petit" },
  { step: "m", label: "Moyen" },
  { step: "l", label: "Grand" },
];

/** Mini-schéma : le cadre de la carte, le fond en couleur, avec ou sans marge, coins droits ou arrondis. */
function Mini({ inset, round }: { inset: boolean; round: number }) {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true" focusable="false" className="fond-mini">
      <rect x="0.5" y="0.5" width="21" height="15" rx="2" fill="none" stroke="currentColor" opacity="0.45" />
      <rect x={inset ? 4 : 0.5} y={inset ? 4 : 0.5} width={inset ? 14 : 21} height={inset ? 8 : 15} rx={round} fill="currentColor" />
    </svg>
  );
}

const swatch = (c: (typeof PALETTE)[number]) => `var(--t-color-${c})`;

function summary(cur: Background | null) {
  const color = fondColor(cur ?? undefined);
  if (color) return { color, style: cardStyle(color, canvasPalette()) };
  // Papier peint sans couleur dessous : le texte garde l'encre du thème, rien à avertir.
  return cur ? { color: undefined, style: cardStyle("bg", canvasPalette()), wallpaperOnly: true as const } : null;
}

/** Bouton « Fond » de la barre d'outils : pastille de la couleur du fond (vide : aucun). */
export function FondButton({ uid, open, onToggle }: { uid: string; open: boolean; onToggle: () => void }) {
  const s = summary(fondState(uid));
  return (
    <button type="button" className="pe-tool-text fond-btn" data-testid="fond-button" aria-haspopup="dialog" aria-expanded={open} title="Fond de couleur du composant, sur toute sa hauteur" onClick={onToggle}>
      <span className="sm-dot" data-on={s ? "" : undefined} data-wallpaper={s && "wallpaperOnly" in s ? "" : undefined} style={s && !("wallpaperOnly" in s) ? { background: s.style.bg } : undefined} aria-hidden="true" />
      Fond
      {s && !s.style.ok && (
        <span className="sm-alert" data-testid="fond-alert" title="Texte peu lisible sur cette couleur" aria-label="Texte peu lisible sur cette couleur">
          !
        </span>
      )}
    </button>
  );
}

/** Fond d'un composant de la page ou d'un conteneur : aperçu immédiat sur la toile (`previewFond`), puis intention `background`. */
export default function FondMenu({ uid, top, onClose, onChanged }: { uid: string; top: number; onClose: () => void; onChanged: () => void }) {
  const [cur, setCur] = useState<Background | null>(() => fondState(uid));
  const change = (next: Background | null, continuous = false) => {
    setCur(next);
    const seq = postIntent({ kind: "background", uid, background: next, ...(continuous ? { continuous: true } : {}) });
    previewFond(uid, next, seq);
    onChanged();
  };
  return <FondPanel cur={cur} onChange={change} onClose={onClose} style={{ top }} />;
}

/**
 * Fond d'un composant de la PLANCHE d'un projet (barre du composant, BoardLayer) : même fenêtre, mais pas d'aperçu local — la
 * planche appartient au projet et se réécrit par `item-fond` (Annuler / Rétablir, version de page) ; la toile se recharge ensuite.
 */
export function BoardFondMenu({ board, uid, initial, top, left, onClose }: { board: number; uid: string; initial: Background | null; top: number; left: number; onClose: () => void }) {
  const [cur, setCur] = useState<Background | null>(initial);
  const change = (next: Background | null, continuous = false) => {
    setCur(next);
    postIntent({ kind: "bitem-fond", board, uid, background: next, ...(continuous ? { continuous: true } : {}) });
  };
  return <FondPanel cur={cur} onChange={change} onClose={onClose} style={{ top, left, right: "auto" }} />;
}

function FondPanel({ cur, onChange: change, onClose, style }: { cur: Background | null; onChange: (next: Background | null, continuous?: boolean) => void; onClose: () => void; style: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);

  const color = fondColor(cur ?? undefined);
  const s = summary(cur);
  const wp = cur?.kind === "wallpaper" ? cur : null;
  const customColor = color && !isSurfaceToken(color) ? color : undefined;
  /** Papier peint valide à partir de champs sans valeur vide (le schéma est strict). */
  const wpBg = (p: { wallpaper: number; color?: string | undefined; size?: number | undefined; opacity?: number | undefined }) =>
    readBackground({ kind: "wallpaper", ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) }) ?? null;
  const shape: Shape = { ...(cur?.inset ? { inset: cur.inset } : {}), ...(cur?.round ? { round: cur.round } : {}) };
  const setColor = (c: string, continuous = false) => change(wp ? wpBg({ ...wp, color: c }) : (readBackground({ kind: "color", color: c, ...shape }) ?? null), continuous);
  /** Étendue / coins : même fond, seul le réglage change (`undefined` le retire = comportement d'avant). */
  const setShape = (p: Shape) => {
    if (!cur) return;
    const next = { ...cur, ...p } as Record<string, unknown>;
    for (const k of ["inset", "round"]) if (next[k] === undefined) delete next[k];
    change(readBackground(next) ?? null);
  };

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
  // Papier peint choisi alors que la bibliothèque est vide : on garde la vue pour dire où importer des motifs.
  const [wantWallpaper, setWantWallpaper] = useState(false);
  const view = wantWallpaper && !cur ? "wallpaper" : active;
  const entry = wp ? wallpaperCatalog().get(wp.wallpaper) : undefined;
  // Le menu d'un papier peint est plus haut que celui d'une couleur : on l'amène dans la vue (toile) quand il s'ouvre ou change de nature.
  const hasWp = wp !== null;
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [view, hasWp]);

  const pickKind = (kind: string) => {
    if (kind === "none") {
      setWantWallpaper(false);
      return change(null);
    }
    if (kind === "color") {
      setWantWallpaper(false);
      return active !== "color" && change(readBackground({ kind: "color", color: color ?? FIRST_COLOR, ...shape }) ?? null);
    }
    if (active === "wallpaper") return;
    const first = [...wallpaperCatalog().values()][0];
    if (!first) return setWantWallpaper(true);
    change(wpBg({ wallpaper: first.id, color, ...shape }));
  };

  const colorRows = (label: string, auto?: { label: string; onPick: () => void }) => (
    <>
      <div className="tc-row">
        <span className="sm-label">{label}</span>
        <CardColorChoices palette={canvasPalette()} value={color ?? ""} onPick={(t) => setColor(t)} label="Couleur du fond" auto={auto} />
      </div>
      <div className="tc-row">
        <span className="sm-label" aria-hidden="true" />
        <span className="tc-swatches">
          <ColorPicker value={customColor} onChange={fromPicker} swatch={swatch} />
        </span>
        <span className="sm-hint">Autre couleur…</span>
      </div>
    </>
  );
  const shapeRows = cur && (
    <>
      <div className="tc-row">
        <span className="sm-label">Étendue</span>
        <span className="tc-seg" role="radiogroup" aria-label="Étendue du fond" data-testid="fond-extent">
          <button type="button" role="radio" aria-checked={!cur.inset} data-extent="full" onClick={() => setShape({ inset: undefined, round: cur.round })}>
            <Mini inset={false} round={0} /> Bord à bord
          </button>
          <button type="button" role="radio" aria-checked={Boolean(cur.inset)} data-extent="margin" onClick={() => !cur.inset && setShape({ inset: "m" })}>
            <Mini inset round={0} /> Avec marge
          </button>
        </span>
      </div>
      {cur.inset && (
        <div className="tc-row">
          <span className="sm-label">Marge</span>
          <span className="tc-seg" role="radiogroup" aria-label="Taille de la marge" data-testid="fond-inset">
            {STEPS.map((st) => (
              <button key={st.step} type="button" role="radio" aria-checked={cur.inset === st.step} data-step={st.step} onClick={() => setShape({ inset: st.step })}>
                {st.label}
              </button>
            ))}
          </span>
        </div>
      )}
      <div className="tc-row">
        <span className="sm-label">Coins</span>
        <span className="tc-seg" role="radiogroup" aria-label="Coins du fond" data-testid="fond-round">
          <button type="button" role="radio" aria-checked={!cur.round} data-step="none" onClick={() => setShape({ round: undefined })}>
            <Mini inset round={0} /> Droits
          </button>
          {STEPS.map((st, i) => (
            <button key={st.step} type="button" role="radio" aria-checked={cur.round === st.step} data-step={st.step} onClick={() => setShape({ round: st.step })}>
              <Mini inset round={[2, 4, 6][i]} /> {st.label}
            </button>
          ))}
        </span>
      </div>
      <p className="sm-hint">{cur.inset ? "La couleur du composant voisin (avant, sinon après) entoure celui-ci ; sans voisin coloré : la carte ou la page." : "Les coins arrondis se voient avec une marge."}</p>
    </>
  );
  const warning = s && !s.style.ok && (
    <p className="sm-warn" role="status" data-testid="fond-warning" title={ratioTip(s.style.ratio)}>
      <span className="sm-alert" aria-hidden="true">
        !
      </span>
      {readabilityText(s.style.ratio)} : le texte se lit mal sur cette couleur. Essaie une teinte plus claire ou plus foncée.
    </p>
  );

  return (
    <div ref={ref} className="sm tc" role="dialog" aria-label="Fond du composant" data-testid="fond-menu" style={style}>
      <div className="tc-row">
        <span className="sm-label">Fond</span>
        <span className="tc-seg" role="radiogroup" aria-label="Nature du fond">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" role="radio" aria-checked={view === k.kind} data-kind={k.kind} onClick={() => pickKind(k.kind)}>
              {k.label}
            </button>
          ))}
        </span>
      </div>
      {view === "color" && color && s ? (
        <>
          {colorRows("Couleur")}
          {shapeRows}
          <p className="sm-hint">Bord à bord, la couleur va d&apos;un bord à l&apos;autre de la carte (ou de la page) et sur toute la hauteur du composant. Deux composants de même couleur qui se suivent ne font plus qu&apos;un seul bloc.</p>
          {warning}
        </>
      ) : view === "wallpaper" ? (
        <>
          <WallpaperGrid value={wp?.wallpaper} onPick={(id) => change(wpBg({ wallpaper: id, color, size: undefined, opacity: undefined, ...shape }))} />
          {wp && (
            <>
              <WallpaperPaintRows
                entry={entry}
                size={wp.size}
                opacity={wp.opacity}
                onChange={(p, continuous) =>
                  change(wpBg({ ...wp, ...("size" in p ? { size: p.size ?? undefined } : {}), ...("opacity" in p ? { opacity: p.opacity ?? undefined } : {}) }), continuous)
                }
              />
              {colorRows("Couleur dessous", { label: "Aucune couleur sous le motif", onPick: () => change(wpBg({ ...wp, color: undefined })) })}
              {shapeRows}
              <p className="sm-hint">Le motif se répète d&apos;un bord à l&apos;autre du composant. Deux composants voisins qui ont le même motif et les mêmes réglages ne font plus qu&apos;un seul bloc. Sans couleur dessous, le texte garde la couleur du thème.</p>
              {warning}
            </>
          )}
        </>
      ) : (
        <p className="sm-hint">Colore tout le composant, d&apos;un bord à l&apos;autre, ou pose un papier peint de ta bibliothèque. Le texte passe tout seul à la couleur la plus lisible.</p>
      )}
    </div>
  );
}
