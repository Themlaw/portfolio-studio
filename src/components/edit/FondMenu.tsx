"use client";

/**
 * « Fond & carte » d'une rubrique ou d'un composant (lot 100, sur la « Surface » commune du lot 66) : UN bouton et UN menu, les mêmes pour tous les blocs et
 * composants qui ont un fond, avec DEUX sections toujours affichées, l'une sous l'autre, même quand l'une est sur « Aucun » :
 *  - « Fond » : la zone autour, pleine largeur (aucun : c'est le fond de la page) ;
 *  - « Carte » : le cadre en retrait qui porte le contenu.
 * Chaque section a Aucun / Couleur / Papier peint et ses réglages ; plus de « Régler : La carte / Le fond sur la carte » ni d'« Étendue » (une carte EST un
 * retrait). Modèle de données : src/themes/fondcarte.ts (rangement dans les deux couches déjà écrites, aucune nouvelle forme de donnée) et zone.ts.
 *
 * Retour R5 (impossible d'enlever un papier peint) :
 *  - « Aucun » retire la zone de SA section seulement (jamais l'autre : retour R9b, régler la carte ne fait plus perdre le fond autour) ;
 *  - changer de nature ne remplace jamais un choix : le motif, la couleur et leurs réglages sont gardés (mémoire de la session) ;
 *  - un papier visible qui vient d'une AUTRE couche (papier peint de la page, papier du site) est dit en toutes lettres, avec le moyen de le régler.
 * Retour R6 : le curseur d'opacité du motif va de 0 à 100 %. Lot 90 : avertissement de lisibilité (non bloquant) au-delà de 60 % avec du texte.
 * Retour R9 : plus de couleur imposée autour d'une carte (le jaune de « bgDeep » du premier choix, ou la couleur d'un voisin) : ce qui entoure EST la section Fond.
 *
 * Chaque choix est appliqué à l'instant (aperçu optimiste, `previewZone`) et envoyé à l'éditeur (intention `fond`, un seul pas d'historique) ;
 * Annuler / Rétablir passent par l'historique. Composant de planche : une seule couche (`bitem-fond`), Fond et Carte s'excluent. À ne pas confondre avec
 * « Fond du texte » (BackdropRow) ni « Fond derrière la photo » (ImageBgMenu, « Fond image »).
 */
import { useState } from "react";

import { parseColor, rgbaToHex } from "@/lib/color";
import { PALETTE } from "@/lib/look";
import type { Background } from "@/themes/fond";
import { PAPER_READABLE_MAX, PAPER_READABLE_WARNING } from "@/themes/schema";
import { hiddenContourSwatches, type Rgb } from "@/themes/contour-swatches";
import {
  cardBackground,
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
  SURFACE_DA_TOKENS,
  SURFACE_TINT_BASES,
  SURFACE_TINT_PERCENTS,
  type SurfaceToken,
  type ResolvedBorder,
  type ResolvedSurface,
  type Surface,
} from "@/themes/surface";
import { CONTOUR_ONLY_CLEAR, freshZone, readFondCarte, setSlot, writeFondCarte, type Caps, type Slot } from "@/themes/fondcarte";
import { isCustomColor, zoneColor, zoneExtent, zoneKind, zoneToSurface, zoneWithKind, type Zone, type ZoneMemo, type ZoneStored } from "@/themes/zone";

import CardColorChoices from "./CardColorChoices";
import ColorPicker from "./ColorPicker";
import { canvasPalette, hasFondWrapper, postIntent, previewZone, wallpaperCatalog, zoneState } from "./optimistic";
import { ratioTip, readabilityText } from "./readability";
import { CornersRow, SHAPE_STEPS } from "./ShapeChoices";
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
    return { has: true, onCards: true, opacity: Number.isFinite(wp) ? wp : PAPER_ON_CARDS_DEFAULT };
  }
  const raw = Number.parseFloat(getComputedStyle(root).getPropertyValue("--t-kit-paper-cards"));
  return { has: root.hasAttribute("data-kit-paper"), onCards: root.hasAttribute("data-kit-paper-cards"), opacity: Number.isFinite(raw) ? raw : PAPER_ON_CARDS_DEFAULT };
}

/** Du texte est posé sur ce bloc (la toile le montre) : l'avertissement de lisibilité du papier n'a de sens que dans ce cas. */
function blockHasText(uid: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(uid)}"]`);
  return Boolean(el?.textContent?.trim());
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

/** Bouton « Fond & carte » de la barre d'outils (le MÊME partout, lot 100) : petit échantillon carré de la couleur de la carte (sinon du fond ; rien : aucun ; trame : papier peint sans couleur). */
export function FondButton({ uid, open, onToggle, compact = false }: { uid: string; open: boolean; onToggle: () => void; compact?: boolean }) {
  const st = zoneState(uid);
  const fc = readFondCarte({ surface: st.surface ?? undefined, background: st.background ?? undefined }, st.defaults);
  const s = summary(fc.carte ?? fc.fond, st.defaults);
  return (
    <button type="button" className="pe-tool-text fond-btn" data-testid="fond-button" aria-haspopup="dialog" aria-expanded={open} {...(compact ? { "aria-label": "Fond & carte" } : {})} title="Fond et carte du bloc : le fond autour (pleine largeur) et la carte en retrait qui porte le contenu" onClick={onToggle}>
      {s && <span className="sm-swatch" data-testid="fond-swatch" data-wallpaper={"wallpaperOnly" in s ? "" : undefined} style={!("wallpaperOnly" in s) ? { background: s.style.bg } : undefined} aria-hidden="true" />}
      {compact ? <span aria-hidden="true">▣</span> : "Fond & carte"}
      {s && !s.style.ok && (
        <span className="sm-alert" data-testid="fond-alert" title="Texte peu lisible sur cette couleur" aria-label="Texte peu lisible sur cette couleur">
          !
        </span>
      )}
    </button>
  );
}

/** Fond & carte d'un bloc de la page ou d'un conteneur : aperçu immédiat sur la toile (`previewZone`), puis intention `fond` (les deux couches ensemble). */
export default function FondMenu({ uid, anchor, onClose, onChanged }: { uid: string; anchor: PopoverAnchor; onClose: () => void; onChanged: () => void }) {
  const init = zoneState(uid);
  const [stored, setStored] = useState<ZoneStored>({ surface: init.surface ?? undefined, background: init.background ?? undefined });
  // Lot 105 : Fond et Carte existent PARTOUT. `canCard` ne dit plus que OÙ la Carte est rangée : carte de rubrique (premier niveau de la page) ou
  // panneau intérieur du fond (composant de planche, composant imbriqué, case de grille) ; le fond, sur tout bloc qui a une enveloppe de fond.
  const canCard = !document.querySelector(`[data-edit-block="${CSS.escape(uid)}"]`)?.hasAttribute("data-edit-parent");
  const canFond = hasFondWrapper(uid);
  const change = (next: ZoneStored, continuous = false) => {
    // Un choix déjà actif (même pastille recliquée) n'écrit rien : l'éditeur le refuserait « sans effet » et la toile retirerait son aperçu avant le rendu du serveur.
    if (JSON.stringify(next) === JSON.stringify(stored)) return;
    setStored(next);
    const seq = postIntent({ kind: "fond", uid, surface: next.surface ?? null, background: next.background ?? null, ...(continuous ? { continuous: true } : {}) });
    previewZone(uid, next.surface ?? null, next.background ?? null, seq);
    onChanged();
  };
  return <FondPanel uid={uid} stored={stored} defaults={init.defaults} caps={{ canCard, canFond }} onChange={change} onClose={onClose} anchor={anchor} />;
}

/**
 * Fond & carte d'un composant de la PLANCHE d'un projet (barre du composant, BoardLayer) : même fenêtre, mais une seule couche existe (`fond`) et pas
 * d'aperçu local — la planche appartient au projet et se réécrit par `item-fond` (Annuler / Rétablir, version de page) ; la toile se recharge ensuite.
 */
export function BoardFondMenu({ board, uid, initial, anchor, onClose }: { board: number; uid: string; initial: Background | null; anchor: PopoverAnchor; onClose: () => void }) {
  const [stored, setStored] = useState<ZoneStored>({ background: initial ?? undefined });
  const change = (next: ZoneStored, continuous = false) => {
    if (JSON.stringify(next) === JSON.stringify(stored)) return;
    setStored(next);
    postIntent({ kind: "bitem-fond", board, uid, background: next.background ?? null, ...(continuous ? { continuous: true } : {}) });
  };
  return <FondPanel uid={`${board}:${uid}`} stored={stored} defaults={undefined} caps={{ canCard: false, canFond: true }} onChange={change} onClose={onClose} anchor={anchor} />;
}

/** Teintes proposées pour le contour (ordre d'affichage de CardColorChoices) : pour masquer doublons et couleurs confondues avec la page. */
function contourHidden(border: ResolvedBorder | null, uid: string): Set<string> {
  const palette = canvasPalette();
  const rgbOf = (css: string): Rgb | undefined => {
    const c = parseColor(css);
    return c ? { r: c.r, g: c.g, b: c.b } : undefined;
  };
  const order: string[] = [...SURFACE_DA_TOKENS, "bgDeep", ...SURFACE_TINT_BASES.flatMap((b) => SURFACE_TINT_PERCENTS.map((n) => `${b}${n}`))];
  const colors: Record<string, Rgb | undefined> = {};
  for (const t of order) colors[t] = rgbOf(cardBackground(t as SurfaceToken, palette));
  const root = getComputedStyle(document.documentElement);
  const card = document.querySelector(`[data-edit-block="${CSS.escape(uid)}"] .surface-card, [data-edit-block="${CSS.escape(uid)}"].surface-card`);
  const def = rgbOf((card && getComputedStyle(card).getPropertyValue("--card-ink").trim()) || root.getPropertyValue("--t-color-ink").trim());
  const page = rgbOf(root.getPropertyValue("--t-color-bg").trim());
  return hiddenContourSwatches(order, colors, def, page, border?.color);
}

/**
 * Contour de la carte (lot 100, ex-« Bordure » du lot 32, qui était cachée dans les réglages fins) : TOUJOURS visible dans la section Carte.
 * Aucun / Fin / Moyen / Épais et la couleur ; une pastille est exactement la couleur du contour (règle du lot 95). Un contour qui vient du THÈME
 * (réglages des cartes) est dit tel quel, avec le moyen de le remplacer ou de le retirer pour ce bloc. (« Cadre » est réservé aux images.)
 */
function ContourRows({
  uid,
  border,
  fromTheme,
  themeBorder,
  slot,
  onChange,
}: {
  uid: string;
  border: ResolvedBorder | null;
  fromTheme: boolean;
  themeBorder: ResolvedBorder | null;
  /** La section réglée : le contour est celui de SA section (Fond ou Carte), jamais verrouillé (lot 105). */
  slot: Slot;
  onChange: (b: Surface["border"], continuous?: boolean) => void;
}) {
  const enabled = true;
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
  const hidden = enabled && border ? contourHidden(border, uid) : undefined;
  return (
    <div className="fc-contour" data-testid="fond-contour-row" data-slot={slot} data-state="ok" data-from-theme={fromTheme ? "" : undefined}>
      <div className="tc-row">
        <span className="sm-label">Contour</span>
        <span className="tc-seg" role="radiogroup" aria-label={slot === "fond" ? "Contour du fond" : "Contour de la carte"} data-testid="fond-contour">
          <button type="button" role="radio" aria-checked={border === null} data-contour="none" disabled={!enabled} onClick={() => onChange(false)}>
            Aucun
          </button>
          {SURFACE_BORDER_WIDTHS.map((w) => (
            <button key={w} type="button" role="radio" aria-checked={border?.width === w} data-contour={w} data-border-width={w} disabled={!enabled} onClick={() => set({ width: w })}>
              {SURFACE_BORDER_LABELS[w]}
            </button>
          ))}
        </span>
      </div>
      {fromTheme && border && (
        <p className="sm-hint" data-testid="fond-contour-theme">
          Contour du thème ({SURFACE_BORDER_LABELS[border.width].toLowerCase()}). Choisis une épaisseur pour le remplacer, ou « Aucun » pour le retirer sur ce bloc.
        </p>
      )}
      {!fromTheme && themeBorder && enabled && (
        <p className="sm-hint" data-testid="fond-contour-theme-back">
          Le thème a un contour ({SURFACE_BORDER_LABELS[themeBorder.width].toLowerCase()}).{" "}
          <button type="button" className="sm-link" data-testid="fond-contour-theme-use" onClick={() => onChange(undefined)}>
            Reprendre celui du thème
          </button>
        </p>
      )}
      {enabled && border && (
        <>
          <div className="tc-row">
            <span className="sm-label">Couleur du contour</span>
            <CardColorChoices palette={canvasPalette()} value={border.color ?? ""} onPick={(t) => set({ color: t })} label={slot === "fond" ? "Couleur du contour du fond" : "Couleur du contour"} hidden={hidden} auto={{ label: "Par défaut : la couleur du texte de la carte", onPick: () => set({ color: undefined }) }} />
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
    </div>
  );
}

/** Carte posée par un contour seul (lot 100) : « Fond de page » (jeton du thème) ; sur un papier peint de page, transparente (sinon la carte le cacherait). */
const CONTOUR_ONLY_COLOR = "bg";
const isContourOnly = (z: Zone): boolean => zoneKind(z) === "color" && (z.color === CONTOUR_ONLY_COLOR || z.color === CONTOUR_ONLY_CLEAR) && z.paper === "under" && z.corners === undefined;

const SLOT_TEXT: Record<Slot, { title: string; none: string; lead: string; empty: string; radio: string; kindLabel: string }> = {
  fond: { title: "Fond", none: "Aucun", kindLabel: "Fond", radio: "Nature du fond", lead: "La boîte extérieure : la bande pleine largeur autour d'un bloc, ou toute la surface d'un composant.", empty: "Aucun fond : on voit le fond de la page autour." },
  carte: { title: "Carte", none: "Aucune", kindLabel: "Carte", radio: "Nature de la carte", lead: "Le panneau en retrait, avec sa marge, qui porte le contenu.", empty: "Pas de carte : le contenu est posé directement sur le fond." },
};

/** Petit schéma d'une section (lot 100) : la page (fond) et la carte dedans ; la zone réglée est mise en avant. Aucune couleur en dur : tout vient de la feuille de style. */
function SlotSchema({ slot, filled }: { slot: Slot; filled: boolean }) {
  return (
    <svg className="fc-schema" data-testid="fond-schema" data-slot={slot} data-filled={filled ? "" : undefined} width="44" height="28" viewBox="0 0 44 28" aria-hidden="true" focusable="false">
      <rect className="fc-out" x="1" y="1" width="42" height="26" rx="2" />
      <rect className="fc-in" x="9" y="7" width="26" height="14" rx="3" />
    </svg>
  );
}

/** Une section du menu (Fond ou Carte) : même structure, mêmes testid partout ; la zone `z` est celle de SA section. */
function ZoneSection({
  uid,
  slot,
  z,
  defaults,
  caps,
  fondActive,
  onSet,
}: {
  uid: string;
  slot: Slot;
  z: Zone | null;
  defaults: ResolvedSurface;
  caps: Caps;
  /** Le fond (section Fond) est rempli. */
  fondActive: boolean;
  onSet: (next: Zone | null, continuous?: boolean) => void;
}) {
  const text = SLOT_TEXT[slot];
  const memoKey = `${uid}#${slot}`;
  remember(memoKey, z);
  const memo = memos.get(memoKey) ?? {};
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
  const commit = (next: Zone | null, continuous = false) => onSet(next, continuous);

  const pickKind = (k: "none" | "color" | "wallpaper") => {
    if (k === "none") {
      setWantWallpaper(false);
      return z ? commit(null) : undefined;
    }
    if (k === "color") {
      setWantWallpaper(false);
      if (z && kind === "color") return;
      return commit(zoneWithKind(z ?? freshZone(slot, caps), "color", memo));
    }
    if (z && kind === "wallpaper") return;
    // Le motif d'avant revient tel quel s'il existe encore ; sinon on montre la bibliothèque sans rien choisir à la place de l'artiste.
    const back = memo.wallpaper && catalog.has(memo.wallpaper.id) ? memo.wallpaper.id : undefined;
    if (back === undefined) return setWantWallpaper(true);
    setWantWallpaper(false);
    commit(zoneWithKind(z ?? freshZone(slot, caps), "wallpaper", memo, back));
  };
  const pickWallpaper = (id: number) => {
    setWantWallpaper(false);
    commit(zoneWithKind(z ?? freshZone(slot, caps), "wallpaper", {}, id));
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
        <CardColorChoices palette={canvasPalette()} value={color ?? ""} onPick={(t) => setColor(t)} label={slot === "fond" ? "Couleur du fond" : "Couleur de la carte"} auto={auto} />
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
  // Le papier peint de la PAGE se voit : derrière un Fond absent, à travers un motif sans couleur ou translucide, et autour d'une Carte sans Fond.
  const pageShows =
    hasPageWallpaper &&
    (slot === "fond" && !z
      ? true
      : Boolean(z && ((z.layer === "fond" && kind === "wallpaper" && z.color === undefined) || (slot === "carte" && !fondActive && zoneExtent(z, defaults) === "inset") || (z.opacity !== undefined && z.opacity < 1))));
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

  /* ---- Coins, marge et contour de LA section (lot 105 : les mêmes dans Fond et dans Carte, jamais verrouillés) ---- */
  const corners = z?.layer === "card" ? resolveSurface(zoneToSurface(z), defaults).corners : (z?.corners ?? "none");
  const cornersChoice: "none" | keyof typeof CORNER_STEP_RADII = corners === "none" || corners === "square" ? "none" : corners === "round" ? nearestCornerStep(themeCardRadius()) : corners;
  // Contour : une carte de rubrique lit celui du thème par défaut ; un fond (ou un panneau) n'a que le sien.
  const border: ResolvedBorder | null =
    z?.layer === "card" ? (resolveSurface(zoneToSurface(z), defaults).border ?? null) : z?.border && typeof z.border === "object" ? { width: z.border.width ?? DEFAULT_BORDER_WIDTH, ...(z.border.color ? { color: z.border.color } : {}) } : null;
  const shape = z ? (
    <>
      <CornersRow
        value={cornersChoice}
        label={slot === "fond" ? "Coins du fond" : "Coins de la carte"}
        testid="fond-round"
        attr={(v) => ({ "data-corners": v === "none" ? "square" : v })}
        onPick={(v) => {
          // Un ancien « Coins arrondis » (rayon du thème) s'affiche sur la taille la plus proche : la choisir ne change rien (rendu d'avant gardé).
          if (z.layer === "card" && z.corners === "round" && v === cornersChoice) return;
          if (z.layer === "card") return set({ corners: v === "none" ? "square" : v });
          set({ corners: v === "none" ? undefined : v });
        }}
      />
      {z.layer === "fond" && zoneExtent(z, defaults) === "inset" && (
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
    </>
  ) : null;
  const fine =
    z && slot === "carte" ? (
      <>
        {!site.has && kind === "color" && (
          <p className="sm-hint" data-testid="surface-paper-none">
            Le thème actif n&apos;a pas de papier dessiné : rien à montrer sur le fond.
          </p>
        )}
        {site.has && kind === "color" && (
        <details className="fond-fine" data-testid="fond-fine">
          <summary data-testid="fond-fine-summary">
            <span className="fond-fine-chev" aria-hidden="true" />
            Papier du site : montré ou caché{z.layer === "card" ? ", intensité" : ""}
          </summary>
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
          {z.layer === "card" && kind === "color" && cardPaper?.over && (
            <div className="tc-row">
              <span className="sm-label">Intensité</span>
              <input type="range" className="sm-range" min={0} max={100} step={1} value={Math.round(cardPaper.opacity * 100)} aria-label="Intensité du papier sur la carte" data-testid="surface-paper-opacity" onChange={(e) => set({ paperOpacity: Number(e.target.value) / 100 }, true)} />
              <span className="sm-hint">{Math.round(cardPaper.opacity * 100)} %</span>
            </div>
          )}
          {z.layer === "card" && kind === "color" && cardPaper?.over && cardPaper.opacity > PAPER_READABLE_MAX && blockHasText(uid) && (
            <p className="sm-warn" role="status" data-testid="surface-paper-opacity-warning">
              <span className="sm-alert" aria-hidden="true">
                !
              </span>
              {PAPER_READABLE_WARNING}
            </p>
          )}
        </details>
        )}
      </>
    ) : null;

  /* ---- Contour de la section : toujours visible, Fond comme Carte ---- */
  const themeBorder = z?.layer === "card" ? defaults.border : null;
  const contour = (
    <ContourRows
      uid={uid}
      slot={slot}
      border={border}
      fromTheme={Boolean(z?.layer === "card" && z.border === undefined && themeBorder)}
      themeBorder={themeBorder}
      onChange={(b, continuous) => {
        if (!z) {
          // Depuis « Aucun » : une épaisseur pose une zone « Fond de page » (jeton du thème ; transparente sur un papier peint de page) avec ce contour ; rien d'autre ne change.
          if (b === false || b === undefined) return;
          return commit({ ...zoneWithKind(freshZone(slot, caps), "color", {}), color: hasPageWallpaper ? CONTOUR_ONLY_CLEAR : CONTOUR_ONLY_COLOR, paper: "under", border: b } as Zone);
        }
        // Contour retiré d'une zone qui n'existait que pour lui : le bloc revient exactement à « Aucun » (aucun fond résiduel).
        if (b === false && isContourOnly(z)) return commit(null);
        // Le contour se range dans la couche de la zone (carte : `surface`, fond : `background`) : rien ne bouge d'une couche à l'autre.
        set({ border: z.layer === "fond" && (b === false || b === undefined) ? undefined : b }, continuous);
      }}
    />
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
    <section className="fc-section" data-testid={`fond-section-${slot}`} data-slot={slot} data-kind-now={view} aria-label={text.title}>
      <div className="fc-head">
        <SlotSchema slot={slot} filled={view !== "none"} />
        <div className="fc-head-text">
          <h3 className="fc-title" data-testid="fond-section-title">
            {text.title}
          </h3>
          <p className="sm-hint fc-lead">{text.lead}</p>
        </div>
      </div>
      <div className="tc-row">
        <span className="sm-label">{text.kindLabel}</span>
        <span className="tc-seg" role="radiogroup" aria-label={text.radio} data-testid={`fond-kind-${slot}`}>
          {KINDS.map((k) => (
            <button key={k.kind} type="button" role="radio" aria-checked={view === k.kind} data-kind={k.kind} onClick={() => pickKind(k.kind)}>
              {k.kind === "none" ? text.none : k.label}
            </button>
          ))}
        </span>
      </div>
      {view === "color" && z && color && s ? (
        <>
          {colorRows("Couleur")}
          {notices}
          {shape}
          {contour}
          {fine}
          {warning}
        </>
      ) : view === "wallpaper" ? (
        <>
          <WallpaperGrid value={z?.wallpaper} onPick={pickWallpaper} />
          {z && kind === "wallpaper" && (
            <>
              <WallpaperPaintRows
                entry={wallpaperEntry}
                size={z.size}
                opacity={z.opacity}
                textOver={blockHasText(uid)}
                onChange={(p, continuous) => set({ ...("size" in p ? { size: p.size ?? undefined } : {}), ...("opacity" in p ? { opacity: p.opacity ?? undefined } : {}) }, continuous)}
              />
              {colorRows("Couleur dessous", z.layer === "fond" || slot === "fond" ? { label: "Aucune couleur sous le motif", onPick: () => setColor(undefined) } : undefined)}
              {notices}
              {shape}
              {contour}
              {fine}
              {warning}
            </>
          )}
          {(!z || kind !== "wallpaper") && (
            <>
              {notices}
              {contour}
            </>
          )}
        </>
      ) : (
        <>
          <p className="sm-hint" data-testid="fond-empty">
            {text.empty}
          </p>
          {notices}
          {contour}
        </>
      )}
    </section>
  );
}

/** Le menu « Fond & carte » (lot 100) : DEUX sections toujours affichées, l'une sous l'autre, même quand l'une est sur « Aucun ». */
function FondPanel({
  uid,
  stored,
  defaults: themeDefaults,
  caps,
  onChange,
  onClose,
  anchor,
}: {
  uid: string;
  stored: ZoneStored;
  defaults: ResolvedSurface | undefined;
  caps: Caps;
  onChange: (next: ZoneStored, continuous?: boolean) => void;
  onClose: () => void;
  anchor: PopoverAnchor;
}) {
  const defaults = themeDefaults ?? resolveSurface({});
  const fc = readFondCarte(stored, defaults);
  const onSet = (slot: Slot) => (next: Zone | null, continuous = false) => {
    // Une section AJOUTÉE (l'autre existait) range les deux dans l'ordre normal ; régler une section déjà là ne déplace rien (même l'ancien rendu emboîté).
    const added = next !== null && fc[slot] === null;
    const w = writeFondCarte(setSlot(fc, slot, next, caps), caps, added);
    onChange({ ...(w.surface ? { surface: w.surface } : {}), ...(w.background ? { background: w.background } : {}) }, continuous);
  };
  return (
    <Popover anchor={anchor} label="Fond et carte du bloc" testId="fond-menu" onClose={onClose}>
      <ZoneSection uid={uid} slot="fond" z={fc.fond} defaults={defaults} caps={caps} fondActive={fc.fond !== null} onSet={onSet("fond")} />
      <ZoneSection uid={uid} slot="carte" z={fc.carte} defaults={defaults} caps={caps} fondActive={fc.fond !== null} onSet={onSet("carte")} />
    </Popover>
  );
}
