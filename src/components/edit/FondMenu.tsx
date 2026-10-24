"use client";

/**
 * « Fond » d'une rubrique ou d'un composant sur la toile (lot 66, « Surface » commune) : UN bouton, UN menu, pour ce que l'artiste appelait
 * « Carte » et « Fond » (le menu « Carte » a disparu). Modèle de données : src/themes/zone.ts (les deux couches déjà écrites, lues et écrites
 * sans perte). Menu COURT (retour R7) : en haut ce qui sert le plus (Aucun / Couleur / Papier peint, puis Étendue : Pleine largeur ou Carte en
 * retrait, puis la couleur ou le motif) ; les réglages fins (coins, marge, bordure, papier du site) sont dans une section repliée.
 *
 * Retour R5 (impossible d'enlever un papier peint) :
 *  - « Aucun » retire la zone ENTIÈRE (carte et fond), « Couleur » cache le papier du site sur la zone ;
 *  - changer de nature ne remplace jamais un choix : le motif, la couleur et leurs réglages sont gardés (mémoire de la session) ; sans motif
 *    choisi avant, « Papier peint » montre la bibliothèque sans rien écrire tant qu'aucun motif n'est cliqué ;
 *  - un papier visible qui vient d'une AUTRE couche (papier peint de la page, papier du site) est dit en toutes lettres, avec le moyen de le régler.
 * Retour R6 : le curseur d'opacité du motif descend à 0 %.
 *
 * Chaque choix est appliqué à l'instant (aperçu optimiste, `previewZone`) et envoyé à l'éditeur (intention `fond`, un seul pas d'historique) ;
 * Annuler / Rétablir passent par l'historique. Texte illisible sur la couleur : avertissement seulement. Composant de planche : seule la couche
 * « fond » existe (`bitem-fond`). À ne pas confondre avec « Fond du texte » (BackdropRow) ni « Fond derrière la photo » (ImageBgMenu).
 */
import { useState } from "react";

import { parseColor, rgbaToHex } from "@/lib/color";
import { PALETTE } from "@/lib/look";
import type { Background } from "@/themes/fond";
import {
  cardStyle,
  CORNER_STEP_RADII,
  DEFAULT_BORDER_WIDTH,
  isSurfaceToken,
  nearestCornerStep,
  PAPER_ON_CARDS_DEFAULT,
  resolvePaper,
  resolveSurface,
  SURFACE_BORDER_LABELS,
  SURFACE_BORDER_WIDTHS,
  type ResolvedBorder,
  type ResolvedSurface,
  type Surface,
} from "@/themes/surface";
import { FIRST_COLOR, isCustomColor, readZone, zoneColor, zoneExtent, zoneInLayer, zoneKind, zoneToStored, zoneToSurface, zoneWithKind, type Zone, type ZoneMemo, type ZoneStored } from "@/themes/zone";

import CardColorChoices from "./CardColorChoices";
import ColorPicker from "./ColorPicker";
import { canvasPalette, hasFondWrapper, postIntent, previewZone, wallpaperCatalog, zoneState } from "./optimistic";
import { ratioTip, readabilityText } from "./readability";
import { CornersRow, ExtentRow, SHAPE_STEPS } from "./ShapeChoices";
import Popover, { type PopoverAnchor } from "./Popover";
import { WallpaperGrid, WallpaperPaintRows } from "./WallpaperChoices";

import "@/app/admin/typo-controls.css";
import "@/app/admin/surface-menu.css";

const KINDS: { kind: "none" | "color" | "wallpaper"; label: string }[] = [
  { kind: "none", label: "Aucun" },
  { kind: "color", label: "Couleur" },
  { kind: "wallpaper", label: "Papier peint" },
];
const swatch = (c: (typeof PALETTE)[number]) => `var(--t-color-${c})`;

/**
 * Mémoire de la session, par composant : la couleur et le motif (avec taille et opacité) déjà choisis. Passer de « Papier peint » à « Couleur »
 * puis revenir rend le même motif, jamais un autre (retour R5).
 */
const memos = new Map<string, ZoneMemo>();
function remember(uid: string, z: Zone | null) {
  if (!z) return;
  const m = memos.get(uid) ?? {};
  if (z.color !== undefined) m.color = z.color;
  if (z.wallpaper !== undefined) m.wallpaper = { id: z.wallpaper, ...(z.size !== undefined ? { size: z.size } : {}), ...(z.opacity !== undefined ? { opacity: z.opacity } : {}) };
  memos.set(uid, m);
}

/** Papier du site tel que la toile l'affiche : présent dans le thème actif ? montré sur les cartes et les fonds ? à quelle intensité ? */
function sitePaper() {
  const root = document.documentElement;
  const frame = document.querySelector<HTMLElement>(".site-frame[data-wp-cards]");
  if (frame) {
    const wp = Number.parseFloat(getComputedStyle(frame).getPropertyValue("--card-wp-opacity"));
    return { has: true, onCards: true, opacity: Math.min(0.6, Number.isFinite(wp) ? wp : PAPER_ON_CARDS_DEFAULT) };
  }
  const raw = Number.parseFloat(getComputedStyle(root).getPropertyValue("--t-kit-paper-cards"));
  return { has: root.hasAttribute("data-kit-paper"), onCards: root.hasAttribute("data-kit-paper-cards"), opacity: Number.isFinite(raw) ? raw : PAPER_ON_CARDS_DEFAULT };
}

/** Rayon de l'ancien « Coins arrondis » : « grands blocs » du thème, jamais moins de 12 px (même formule que look.css, `--card-radius`). */
function themeCardRadius(): number {
  const probe = document.createElement("i");
  probe.style.cssText = "position:absolute;visibility:hidden;border-radius:max(var(--t-radius-lg), 12px)";
  document.body.append(probe);
  const r = Number.parseFloat(getComputedStyle(probe).borderTopLeftRadius);
  probe.remove();
  return Number.isFinite(r) ? r : 12;
}

function summary(z: Zone | null, defaults: ResolvedSurface) {
  if (!z) return null;
  const color = zoneColor(z, defaults);
  if (color) return { color, style: cardStyle(color, canvasPalette()) };
  // Papier peint sans couleur dessous : le texte garde l'encre du thème, rien à avertir.
  return { color: undefined, style: cardStyle("bg", canvasPalette()), wallpaperOnly: true as const };
}

/** Bouton « Fond » de la barre d'outils : pastille de la couleur de la zone (vide : aucun fond). */
export function FondButton({ uid, open, onToggle }: { uid: string; open: boolean; onToggle: () => void }) {
  const st = zoneState(uid);
  const s = summary(readZone({ surface: st.surface ?? undefined, background: st.background ?? undefined }).zone, st.defaults);
  return (
    <button type="button" className="pe-tool-text fond-btn" data-testid="fond-button" aria-haspopup="dialog" aria-expanded={open} title="Fond du bloc : couleur ou papier peint, pleine largeur ou en carte" onClick={onToggle}>
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

/** Fond d'un bloc de la page ou d'un conteneur : aperçu immédiat sur la toile (`previewZone`), puis intention `fond` (carte et fond ensemble). */
export default function FondMenu({ uid, anchor, onClose, onChanged }: { uid: string; anchor: PopoverAnchor; onClose: () => void; onChanged: () => void }) {
  const init = zoneState(uid);
  const [stored, setStored] = useState<ZoneStored>({ surface: init.surface ?? undefined, background: init.background ?? undefined });
  // La carte n'existe qu'au premier niveau de la page ; le fond sur les grands composants (le bloc a alors une enveloppe de fond).
  const canCard = !document.querySelector(`[data-edit-block="${CSS.escape(uid)}"]`)?.hasAttribute("data-edit-parent");
  const canFond = hasFondWrapper(uid);
  const change = (next: ZoneStored, continuous = false) => {
    setStored(next);
    const seq = postIntent({ kind: "fond", uid, surface: next.surface ?? null, background: next.background ?? null, ...(continuous ? { continuous: true } : {}) });
    previewZone(uid, next.surface ?? null, next.background ?? null, seq);
    onChanged();
  };
  return <FondPanel uid={uid} stored={stored} defaults={init.defaults} canCard={canCard} canFond={canFond} onChange={change} onClose={onClose} anchor={anchor} />;
}

/**
 * Fond d'un composant de la PLANCHE d'un projet (barre du composant, BoardLayer) : même fenêtre, mais seule la couche « fond » existe et pas
 * d'aperçu local — la planche appartient au projet et se réécrit par `item-fond` (Annuler / Rétablir, version de page) ; la toile se recharge ensuite.
 */
export function BoardFondMenu({ board, uid, initial, anchor, onClose }: { board: number; uid: string; initial: Background | null; anchor: PopoverAnchor; onClose: () => void }) {
  const [stored, setStored] = useState<ZoneStored>({ background: initial ?? undefined });
  const change = (next: ZoneStored, continuous = false) => {
    setStored(next);
    postIntent({ kind: "bitem-fond", board, uid, background: next.background ?? null, ...(continuous ? { continuous: true } : {}) });
  };
  return <FondPanel uid={`${board}:${uid}`} stored={stored} defaults={undefined} canCard={false} canFond onChange={change} onClose={onClose} anchor={anchor} />;
}

/** Bordure de la carte (lot 32) : interrupteur, épaisseur Fin / Moyen / Épais, couleur (« Par défaut » = la couleur lisible du texte). */
function BorderRows({ border, onChange }: { border: ResolvedBorder | null; onChange: (b: Surface["border"], continuous?: boolean) => void }) {
  const customColor = border?.color && !isSurfaceToken(border.color) ? border.color : undefined;
  const width = border?.width ?? DEFAULT_BORDER_WIDTH;
  const set = (p: { width?: (typeof SURFACE_BORDER_WIDTHS)[number]; color?: string | undefined }, continuous = false) =>
    onChange({ width: p.width ?? width, ...("color" in p ? (p.color ? { color: p.color } : {}) : border?.color ? { color: border.color } : {}) }, continuous);
  const fromPicker = (c: string | undefined) => {
    if (c === undefined) return set({ color: undefined }, true);
    if ((PALETTE as readonly string[]).includes(c) && !isSurfaceToken(c)) {
      const rgba = parseColor(getComputedStyle(document.documentElement).getPropertyValue(`--t-color-${c}`));
      if (rgba) return set({ color: rgbaToHex({ ...rgba, a: 1 }) }, true);
    }
    set({ color: c }, true);
  };
  return (
    <>
      <div className="tc-row">
        <span className="sm-label">Bordure</span>
        <button type="button" role="switch" aria-checked={border !== null} className="sm-switch" data-testid="surface-border-switch" onClick={() => onChange(border ? false : {})}>
          <span className="sm-switch-track" aria-hidden="true">
            <span />
          </span>
          {border ? "Oui" : "Non"}
        </button>
      </div>
      {border && (
        <>
          <div className="tc-row">
            <span className="sm-label">Épaisseur</span>
            <span className="tc-seg" role="radiogroup" aria-label="Épaisseur de la bordure" data-testid="surface-border-width">
              {SURFACE_BORDER_WIDTHS.map((w) => (
                <button key={w} type="button" role="radio" aria-checked={width === w} data-border-width={w} onClick={() => set({ width: w })}>
                  {SURFACE_BORDER_LABELS[w]}
                </button>
              ))}
            </span>
          </div>
          <div className="tc-row">
            <span className="sm-label">Couleur de la bordure</span>
            <CardColorChoices palette={canvasPalette()} value={border.color ?? ""} onPick={(t) => set({ color: t })} label="Couleur de la bordure" auto={{ label: "Par défaut : la couleur du texte de la carte", onPick: () => set({ color: undefined }) }} />
          </div>
          <div className="tc-row">
            <span className="sm-label" aria-hidden="true" />
            <span className="tc-swatches">
              <ColorPicker value={customColor} onChange={fromPicker} swatch={swatch} />
            </span>
            <span className="sm-hint">Autre couleur…</span>
          </div>
        </>
      )}
    </>
  );
}

function FondPanel({
  uid,
  stored,
  defaults: themeDefaults,
  canCard,
  canFond,
  onChange,
  onClose,
  anchor,
}: {
  uid: string;
  stored: ZoneStored;
  defaults: ResolvedSurface | undefined;
  canCard: boolean;
  canFond: boolean;
  onChange: (next: ZoneStored, continuous?: boolean) => void;
  onClose: () => void;
  anchor: PopoverAnchor;
}) {
  const defaults = themeDefaults ?? resolveSurface({});
  const { zone: main, inner } = readZone(stored);
  // Un bloc qui portait une carte ET un fond dessus garde ses deux couches : on choisit celle qu'on règle.
  const [layerSel, setLayerSel] = useState<"main" | "inner">("main");
  const z = layerSel === "inner" && inner ? inner : main;
  remember(uid, main);
  remember(uid, inner);
  const memo = memos.get(uid) ?? {};

  /** Zone neuve : le fond pleine largeur d'avant quand le bloc le porte, sinon la carte. */
  const fresh = (): Zone => (canFond ? { layer: "fond", extent: "full" } : { layer: "card", extent: "full" });
  const commit = (next: Zone | null, continuous = false) => {
    if (!next) return onChange({}, continuous);
    // Réglage de la couche emboîtée : seule `background` change ; sinon la zone écrit sa couche et garde l'autre telle quelle.
    const w = zoneToStored(next, stored);
    onChange({ ...(w.surface ? { surface: w.surface } : {}), ...(w.background ? { background: w.background } : {}) }, continuous);
  };

  const kind = z ? zoneKind(z) : null;
  const [wantWallpaper, setWantWallpaper] = useState(false);
  // Papier peint demandé sans motif choisi avant : on montre la bibliothèque, rien n'est écrit tant qu'aucun motif n'est cliqué.
  const view = wantWallpaper && (!z || kind === "color") ? "wallpaper" : (kind ?? "none");
  const catalog = wallpaperCatalog();
  const wallpaperEntry = z?.wallpaper !== undefined ? catalog.get(z.wallpaper) : undefined;
  const color = z ? zoneColor(z, defaults) : undefined;
  const s = summary(z, defaults);
  const site = sitePaper();
  const hasPageWallpaper = Boolean(document.querySelector(".page-wallpaper"));

  // Le menu change de hauteur avec la nature du fond : le Popover le replace (retourné, ou défilant) quand il change de taille.
  const pickKind = (k: "none" | "color" | "wallpaper") => {
    if (k === "none") {
      setWantWallpaper(false);
      // Sur le fond emboîté d'une carte, « Aucun » ne retire que ce fond ; sinon il retire la zone entière (les deux couches) : plus aucun papier de ce bloc.
      if (layerSel === "inner" && inner) {
        setLayerSel("main");
        return onChange({ ...(stored.surface ? { surface: stored.surface } : {}) });
      }
      return stored.surface || stored.background ? commit(null) : undefined;
    }
    if (k === "color") {
      setWantWallpaper(false);
      if (z && kind === "color") return;
      return commit(zoneWithKind(z ?? fresh(), "color", memo));
    }
    if (z && kind === "wallpaper") return;
    // Le motif d'avant revient tel quel s'il existe encore ; sinon on montre la bibliothèque sans rien choisir à la place de l'artiste.
    const back = memo.wallpaper && catalog.has(memo.wallpaper.id) ? memo.wallpaper.id : undefined;
    if (back === undefined) return setWantWallpaper(true);
    setWantWallpaper(false);
    commit(zoneWithKind(z ?? fresh(), "wallpaper", memo, back));
  };
  const pickWallpaper = (id: number) => {
    setWantWallpaper(false);
    commit(zoneWithKind(z ?? fresh(), "wallpaper", {}, id));
  };
  const setColor = (c: string | undefined, continuous = false) => z && commit({ ...z, ...(c === undefined ? { color: undefined } : { color: c }) } as Zone, continuous);
  const set = (p: Partial<Zone>, continuous = false) => z && commit({ ...z, ...p } as Zone, continuous);

  const fromPicker = (c: string | undefined) => {
    if (c === undefined) return;
    if ((PALETTE as readonly string[]).includes(c) && !isSurfaceToken(c)) {
      const rgba = parseColor(getComputedStyle(document.documentElement).getPropertyValue(`--t-color-${c}`));
      if (rgba) return setColor(rgbaToHex({ ...rgba, a: 1 }), true);
    }
    setColor(c, true);
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
          <ColorPicker value={isCustomColor(z?.color) ? z?.color : undefined} onChange={fromPicker} swatch={swatch} />
        </span>
        <span className="sm-hint">Autre couleur…</span>
      </div>
    </>
  );

  /* ---- Papier qui se voit et qui vient d'ailleurs (R5) ---- */
  const cardPaper = z?.layer === "card" ? resolvePaper(zoneToSurface(z), site) : null;
  const siteShows = Boolean(z && kind === "color" && z.paper !== "under" && site.has && (z.layer === "card" ? cardPaper?.over : site.onCards));
  const pageShows = hasPageWallpaper && (!z || (z.layer === "fond" && kind === "wallpaper" && z.color === undefined) || zoneExtent(z, defaults) === "inset" || (z.opacity !== undefined && z.opacity < 1));
  const openPageSettings = () => postIntent({ kind: "page-settings", focus: "wallpaper" });
  const notices = (
    <>
      {siteShows && z && (
        <p className="sm-hint" data-testid="fond-site-paper">
          Le papier du site se voit sur ce fond.{" "}
          <button type="button" className="sm-link" data-testid="fond-site-paper-hide" onClick={() => set({ paper: "under" })}>
            Le cacher
          </button>
        </p>
      )}
      {pageShows && (
        <p className="sm-hint" data-testid="fond-page-paper">
          {z ? "Le papier peint de la page se voit autour ou à travers ce fond." : "Un papier peint de la page se voit derrière."}{" "}
          <button type="button" className="sm-link" data-testid="fond-page-paper-link" onClick={openPageSettings}>
            Papier peint de la page : le régler
          </button>
        </p>
      )}
    </>
  );

  /* ---- Réglages fins (section repliée) ---- */
  const corners = z?.layer === "card" ? resolveSurface(zoneToSurface(z), defaults).corners : (z?.corners ?? "none");
  const cornersChoice: "none" | keyof typeof CORNER_STEP_RADII = corners === "none" || corners === "square" ? "none" : corners === "round" ? nearestCornerStep(themeCardRadius()) : corners;
  const border = z?.layer === "card" ? (resolveSurface(zoneToSurface(z), defaults).border ?? null) : null;
  const extent = z ? zoneExtent(z, defaults) : "full";
  const fine = z && (
    <details className="fond-fine" data-testid="fond-fine">
      <summary>Réglages fins : coins, marge, bordure, papier du site</summary>
      <CornersRow
        value={cornersChoice}
        label="Coins du fond"
        testid="fond-round"
        attr={(v) => ({ "data-corners": v === "none" ? "square" : v })}
        onPick={(v) => {
          // Un ancien « Coins arrondis » (rayon du thème) s'affiche sur la taille la plus proche : la choisir ne change rien (rendu d'avant gardé).
          if (z.layer === "card" && z.corners === "round" && v === cornersChoice) return;
          if (z.layer === "card") return set({ corners: v === "none" ? "square" : v });
          set({ corners: v === "none" ? undefined : v });
        }}
      />
      {z.layer === "fond" && extent === "inset" && (
        <div className="tc-row">
          <span className="sm-label">Marge</span>
          <span className="tc-seg" role="radiogroup" aria-label="Taille de la marge" data-testid="fond-inset">
            {SHAPE_STEPS.map((st) => (
              <button key={st.step} type="button" role="radio" aria-checked={(z.margin ?? "m") === st.step} data-step={st.step} onClick={() => set({ margin: st.step })}>
                {st.label}
              </button>
            ))}
          </span>
        </div>
      )}
      {(z.layer === "card" || canCard) && (
        <BorderRows
          border={border}
          onChange={(b, continuous) => {
            // Une bordure est un réglage de carte : sur un fond, la poser le transforme en carte (couleur, motif, marge et coins gardés).
            if (z.layer === "fond") {
              // La couche « fond » est remplacée par la carte (pas gardée dessous) : on écrit la carte sans l'ancien fond.
              const w = zoneToStored({ ...zoneInLayer(z, "card"), border: b }, {});
              return onChange({ ...(w.surface ? { surface: w.surface } : {}) }, continuous);
            }
            set({ border: b }, continuous);
          }}
        />
      )}
      {site.has && kind === "color" && (
        <div className="tc-row">
          <span className="sm-label">Papier du site</span>
          <span className="tc-seg" role="radiogroup" aria-label="Papier du site sur le fond" data-testid="surface-paper">
            <button type="button" role="radio" aria-checked={z.paper === undefined} data-paper="site" onClick={() => set({ paper: undefined, paperOpacity: undefined })}>
              Comme le site ({site.onCards ? "sur" : "sous"})
            </button>
            <button type="button" role="radio" aria-checked={z.paper === "under"} data-paper="under" onClick={() => set({ paper: "under" })}>
              Sous la carte (caché)
            </button>
            {z.layer === "card" && (
              <button type="button" role="radio" aria-checked={z.paper === "over"} data-paper="over" onClick={() => set({ paper: "over" })}>
                Sur la carte
              </button>
            )}
          </span>
        </div>
      )}
      {!site.has && kind === "color" && (
        <p className="sm-hint" data-testid="surface-paper-none">
          Le thème actif n&apos;a pas de papier dessiné : rien à montrer sur le fond.
        </p>
      )}
      {z.layer === "card" && kind === "color" && cardPaper?.over && (
        <div className="tc-row">
          <span className="sm-label">Intensité</span>
          <input type="range" className="sm-range" min={0} max={60} step={1} value={Math.round(cardPaper.opacity * 100)} aria-label="Intensité du papier sur la carte" data-testid="surface-paper-opacity" onChange={(e) => set({ paperOpacity: Number(e.target.value) / 100 }, true)} />
          <span className="sm-hint">{Math.round(cardPaper.opacity * 100)} %</span>
        </div>
      )}
    </details>
  );

  const warning = s && !s.style.ok && (
    <p className="sm-warn" role="status" data-testid="fond-warning" title={ratioTip(s.style.ratio)}>
      <span className="sm-alert" aria-hidden="true">
        !
      </span>
      {readabilityText(s.style.ratio)} : le texte se lit mal sur cette couleur. Essaie une teinte plus claire ou plus foncée.
    </p>
  );

  // Étendue : toujours proposée. Sans fond encore, « Carte en retrait » pose une carte (couleur du thème, papier du site comme le site) quand le bloc peut
  // en porter une, sinon un fond avec marge ; « Pleine largeur » pose un fond de couleur d'un bord à l'autre.
  const extentRow = (
    <ExtentRow
      inset={z ? extent === "inset" : false}
      label="Étendue du fond"
      testid="fond-extent"
      fullLabel="Pleine largeur"
      insetLabel="Carte en retrait"
      attr={(inset) => ({ "data-width": inset ? "inset" : "full" })}
      onPick={(inset) => {
        if (!z) {
          setWantWallpaper(false);
          if (!inset) return commit(zoneWithKind(fresh(), "color", memo));
          const base: Zone = canCard ? { layer: "card", extent: "inset" } : { layer: "fond", extent: "inset", margin: "m", color: memo.color ?? FIRST_COLOR, paper: "under" };
          return commit(base);
        }
        if (inset === (extent === "inset")) return;
        set(z.layer === "fond" ? { extent: inset ? "inset" : "full", margin: inset ? (z.margin ?? "m") : undefined } : { extent: inset ? "inset" : "full" });
      }}
    />
  );

  return (
    <Popover anchor={anchor} label="Fond du bloc" testId="fond-menu" onClose={onClose}>
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
      {inner && (
        <div className="tc-row">
          <span className="sm-label">Régler</span>
          <span className="tc-seg" role="radiogroup" aria-label="Couche à régler" data-testid="fond-layer">
            <button type="button" role="radio" aria-checked={layerSel === "main"} data-layer="main" onClick={() => setLayerSel("main")}>
              La carte
            </button>
            <button type="button" role="radio" aria-checked={layerSel === "inner"} data-layer="inner" onClick={() => setLayerSel("inner")}>
              Le fond sur la carte
            </button>
          </span>
        </div>
      )}
      {view === "color" && z && color && s ? (
        <>
          {extentRow}
          {colorRows("Couleur")}
          {notices}
          {fine}
          {warning}
        </>
      ) : view === "wallpaper" ? (
        <>
          {z && extentRow}
          <WallpaperGrid value={z?.wallpaper} onPick={pickWallpaper} />
          {z && kind === "wallpaper" && (
            <>
              <WallpaperPaintRows
                entry={wallpaperEntry}
                size={z.size}
                opacity={z.opacity}
                maxOpacity={z.layer === "card" ? 0.6 : 1}
                onChange={(p, continuous) => set({ ...("size" in p ? { size: p.size ?? undefined } : {}), ...("opacity" in p ? { opacity: p.opacity ?? undefined } : {}) }, continuous)}
              />
              {colorRows("Couleur dessous", z.layer === "fond" ? { label: "Aucune couleur sous le motif", onPick: () => setColor(undefined) } : undefined)}
              {notices}
              {fine}
              {warning}
            </>
          )}
          {(!z || kind !== "wallpaper") && notices}
        </>
      ) : (
        <>
          {extentRow}
          <p className="sm-hint">Colore le bloc, pleine largeur ou en carte, ou pose un papier peint de ta bibliothèque. Le texte passe tout seul à la couleur la plus lisible.</p>
          {notices}
        </>
      )}
      {main?.layer === "card" && !inner && canFond && (
        <button
          type="button"
          className="sm-link"
          data-testid="fond-inner-add"
          onClick={() => {
            setLayerSel("inner");
            onChange({ ...(stored.surface ? { surface: stored.surface } : {}), background: { kind: "color", color: FIRST_COLOR } });
          }}
        >
          Ajouter une bande de couleur sur la carte
        </button>
      )}
      {inner && layerSel === "main" && (
        <button
          type="button"
          className="sm-link"
          data-testid="fond-inner-remove"
          onClick={() => {
            const next = { ...(stored.surface ? { surface: stored.surface } : {}) };
            onChange(next);
          }}
        >
          Retirer le fond posé sur la carte
        </button>
      )}
    </Popover>
  );
}
