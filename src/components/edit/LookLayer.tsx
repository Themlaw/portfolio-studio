"use client";

/**
 * Mise en page directement sur la toile (lot 2), dans le calque de la couche
 * d'édition (EditLayer) :
 *
 * - poignées d'espacement en haut / en bas du bloc choisi (glisser, aimantées
 *   aux crans du thème Auto · Aucun · S · M · L · XL ; flèches au clavier) ;
 * - barre typographique de tout texte éditable (« Aa » au survol, ou pendant
 *   la saisie) : ce texte (props.look du bloc) ou tous les textes de son rôle
 *   (styles du site, brouillon du site) ;
 * - position du titre (pictogrammes), fond du métier de l'ouverture ;
 * - « Cadrer » une image qui n'a pas le format de son emplacement : zone gardée
 *   claire, le reste grisé ; souris (glisser, molette) et clavier.
 *
 * La couche n'écrit rien : elle envoie l'intention (`look`, `site-style`) à
 * l'éditeur, qui valide, enregistre le brouillon et rafraîchit la toile. Un
 * aperçu immédiat est posé sur le DOM en attendant, et y reste (optimistic.ts)
 * jusqu'à ce que le serveur ait rendu une révision au moins aussi récente :
 * jamais d'affichage intermédiaire de l'ancienne valeur.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import FreeCropDialog from "@/components/edit/FreeCropDialog";
import HeroContrast from "@/components/edit/HeroContrast";
import { type CaptionStyleField, type ProjectCaptionStyle } from "@/blocks/board-layout";
import { applyMediaPatch, type MediaPatch } from "@/lib/edit/media-look";
import { acceptToCanvas, EDIT_MSG, type MediaTarget } from "@/lib/edit/protocol";
import { type Rect as CropRect } from "@/lib/images/crop";
import { parseRatio } from "@/lib/images/sizes";
import {
  BACKDROP_BLOCKED,
  cleanLook,
  cropFromWindow,
  cropWindow,
  googleOf,
  needsCrop,
  readLook,
  resolveTextStyle,
  ROLE_LABELS,
  SPACE_LABELS,
  textStyleDecls,
  TEXT_PATH_RE,
  siteStylesCss,
  SiteStylesSchema,
  type Crop,
  type Look,
  type PaletteColor,
  type Role,
  type SiteStyles,
  spaceLabel,
  type Space,
  type SpaceVal,
  type TextStyle,
  type TileKey,
  TILE_KEYS,
} from "@/lib/look";

import { googleFamily, nearestWeight } from "@/themes/google-fonts";

import { canvasPalette, overlayData, overlayList, postIntent, setOverlay } from "./optimistic";
import TypoControls from "./TypoControls";
import Popover from "./Popover";

import "@/app/admin/look-layer.css";

type Rect = { top: number; left: number; width: number; height: number };
export type LookTarget = { uid: string; type: string; parent?: string; parentType?: string } | null;

const docRect = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
};
const swatch = (c: PaletteColor) => `var(--t-color-${c})`;

/** Enveloppe d'édition d'un bloc. */
const wrapperOf = (uid: string) =>
  document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(uid)}"], [data-edit-bitem="${CSS.escape(uid)}"]:not([data-edit-bitem-rail]), [data-edit-bitem] [data-edit-cell="${CSS.escape(uid)}"]`);

/** Composant d'une planche (lot 31c : un Texte…) : sa mise en forme s'écrit dans ses réglages, par l'opération de planche. */
const itemFrameOf = (uid: string) => document.querySelector<HTMLElement>(`[data-edit-bitem="${CSS.escape(uid)}"]:not([data-edit-bitem-rail])`);

/**
 * Réglages actuels d'un bloc : ceux envoyés mais pas encore acquittés par le
 * serveur (état local, optimistic.ts) font foi — deux gestes rapprochés
 * partent de la bonne base même si la page rendue est en retard —, sinon
 * ceux posés par BlockList en vue brouillon.
 */
export function lookOf(uid: string): Look {
  const pending = overlayData<Look>(`look:${uid}`);
  if (pending) return pending;
  try {
    return readLook(JSON.parse(wrapperOf(uid)?.dataset.editLook ?? "null")) ?? {};
  } catch {
    return {};
  }
}
/** Élément racine rendu par le bloc (sous son enveloppe de mise en page), ou null (conteneur sans boîte). */
function rootOf(uid: string): HTMLElement | null {
  let el = wrapperOf(uid)?.firstElementChild as HTMLElement | null;
  // Carte de rubrique (lot 17c) : l'enveloppe `.surface-card` est toujours là en vue brouillon, elle aussi se traverse.
  if (el?.classList.contains("surface-card")) el = el.firstElementChild as HTMLElement | null;
  if (el?.classList.contains("card-in")) el = el.firstElementChild as HTMLElement | null;
  // Fond de couleur du composant (lot 32) : même chose.
  // Lot 105 : le Fond porte un panneau intérieur (`.fond-bloc[data-fond-panel] > .fond-in`) : on traverse autant de niveaux qu'il y en a
  // (sinon la poignée d'espace et l'aperçu de remplissage visaient l'enveloppe du panneau et non le bloc : état v0.33.1, intégration 105 + 102).
  while (el?.classList.contains("fond-bloc") || el?.classList.contains("fond-in")) el = el.firstElementChild as HTMLElement | null;
  if (el?.classList.contains("blk")) el = el.firstElementChild as HTMLElement | null;
  if (!el || el.hasAttribute("data-edit-block")) return null;
  return el;
}
/** Envoie les réglages d'un bloc ; renvoie le numéro de l'intention (pour les aperçus). */
export function sendLook(uid: string, look: Look): number {
  const clean = cleanLook(look);
  const frame = itemFrameOf(uid);
  const board = Number(frame?.dataset.board);
  // Case d'une grille de planche (lot 31d) : sa mise en forme s'écrit dans les réglages de la grille du projet.
  const cell = frame ? null : document.querySelector<HTMLElement>(`[data-edit-bitem] [data-edit-cell="${CSS.escape(uid)}"]`);
  const cellFrame = cell?.closest<HTMLElement>("[data-edit-bitem]");
  const seq =
    frame && board
      ? postIntent({ kind: "bitem-look", board, uid, look: clean ?? null })
      : cellFrame?.dataset.editBitem && Number(cellFrame.dataset.board)
        ? postIntent({ kind: "cell-look", board: Number(cellFrame.dataset.board), grid: cellFrame.dataset.editBitem, ...(cellFrame.dataset.editBitemProps ? { props: cellFrame.dataset.editBitemProps.slice(0, 100_000) } : {}), uid, look: clean ?? null })
        : postIntent({ kind: "look", uid, look: clean ?? null });
  setOverlay(`look:${uid}`, seq, { data: clean ?? {} });
  return seq;
}

/**
 * Où s'écrit l'habillage (cadre, fond d'image, arrondi) du média `uid` d'après la toile : composant de planche, case d'une grille de planche
 * ou rubrique / case de la page (même routage que `sendLook`).
 */
export function mediaTargetOf(uid: string): MediaTarget {
  const frame = itemFrameOf(uid);
  const board = Number(frame?.dataset.board);
  if (frame && board) return { kind: "item", board, uid };
  const cell = frame ? null : document.querySelector<HTMLElement>(`[data-edit-bitem] [data-edit-cell="${CSS.escape(uid)}"]`);
  const grid = cell?.closest<HTMLElement>("[data-edit-bitem]");
  if (grid?.dataset.editBitem && Number(grid.dataset.board)) {
    return { kind: "cell", board: Number(grid.dataset.board), grid: grid.dataset.editBitem, ...(grid.dataset.editBitemProps ? { props: grid.dataset.editBitemProps.slice(0, 100_000) } : {}), uid };
  }
  return { kind: "block", uid };
}

/**
 * UNE écriture pour l'habillage d'un média (lot 75, R4) : envoie l'intention `media-look` (cible + changement) et garde le résultat comme
 * réglages en attente (comme `sendLook`) : deux gestes rapprochés partent de la bonne base. `target` d'une image de la Planche libre : aucun
 * réglage de bloc à garder (la planche relit sa ligne). Renvoie le numéro de l'intention.
 */
export function sendMediaLook(target: MediaTarget, patch: MediaPatch): number {
  const seq = postIntent({ kind: "media-look", target, patch });
  if (target.kind !== "free") {
    const res = applyMediaPatch(lookOf(target.uid), patch, target.kind === "slot" ? target.slug : undefined);
    if (!("error" in res)) setOverlay(`look:${target.uid}`, seq, { data: res.look ?? {} });
  }
  return seq;
}
/** Habillage du média `uid` (rubrique, case ou composant de planche), routé d'après la toile. */
export const sendOwnMediaLook = (uid: string, patch: MediaPatch): number => sendMediaLook(mediaTargetOf(uid), patch);
/** Habillage d'une place de carrousel : `slug` de la place, écrit dans la rubrique `uid` de la page. */
export const sendSlotLook = (uid: string, slug: string, patch: MediaPatch): number => sendMediaLook({ kind: "slot", uid, slug }, patch);

/* ---- Espaces ---------------------------------------------------------------- */

type Cran = { key: Space | "auto"; px: number };
const SPACE_ORDER: Space[] = ["none", "s", "m", "l", "xl"];

/** Valeur en px des crans du thème (sonde mesurée), et de « Auto » pour ce bloc. */
function crans(root: HTMLElement, side: "top" | "bottom"): Cran[] {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const out: Cran[] = SPACE_ORDER.map((key) => {
    probe.style.paddingTop = key === "none" ? "0px" : `var(--t-space-${key})`;
    return { key, px: parseFloat(getComputedStyle(probe).paddingTop) || 0 };
  });
  probe.remove();
  // Auto : la valeur du bloc sans réglage (attribut retiré le temps de la mesure).
  const blk = root.parentElement?.classList.contains("blk") ? root.parentElement : null;
  const attr = side === "top" ? "data-pt" : "data-pb";
  const saved = blk?.getAttribute(attr) ?? null;
  const inline = side === "top" ? root.style.paddingTop : root.style.paddingBottom;
  if (blk && saved !== null) blk.removeAttribute(attr);
  if (side === "top") root.style.paddingTop = "";
  else root.style.paddingBottom = "";
  const auto = parseFloat(getComputedStyle(root)[side === "top" ? "paddingTop" : "paddingBottom"]) || 0;
  if (blk && saved !== null) blk.setAttribute(attr, saved);
  if (side === "top") root.style.paddingTop = inline;
  else root.style.paddingBottom = inline;
  return [{ key: "auto", px: auto }, ...out];
}
function nearest(list: Cran[], px: number): Cran {
  return list.reduce((best, c) => (Math.abs(c.px - px) < Math.abs(best.px - px) - 0.5 ? c : best), list[0]);
}
const cranLabel = (c: Cran) => (c.key === "auto" ? "Auto (thème)" : SPACE_LABELS[c.key]);

/** Aperçu d'un espace sur le DOM du site (hors rendu React de la couche). */
function setPad(el: HTMLElement, prop: "paddingTop" | "paddingBottom", value: string) {
  el.style[prop] = value;
}

/**
 * Espace validé : posé sur l'élément du bloc et gardé (même si la page est
 * re-rendue par une réponse en retard) jusqu'à ce que le serveur le rende.
 */
function keepPad(uid: string, prop: "paddingTop" | "paddingBottom", px: number, seq: number) {
  const value = `${px}px`;
  setOverlay(`pad:${uid}:${prop}`, seq, {
    data: value,
    apply: () => {
      const el = rootOf(uid);
      if (el && el.style[prop] !== value) setPad(el, prop, value);
    },
    clear: () => {
      const el = rootOf(uid);
      if (el) setPad(el, prop, "");
    },
  });
}

function SpacingHandle({ uid, side, look, announce }: { uid: string; side: "top" | "bottom"; look: Look; announce: (s: string) => void }) {
  const [drag, setDrag] = useState<{ px: number; cran: Cran } | null>(null);
  const root = rootOf(uid);
  if (!root) return null;
  const r = docRect(root);
  const cs = getComputedStyle(root);
  const pad = parseFloat(side === "top" ? cs.paddingTop : cs.paddingBottom) || 0;
  const current: SpaceVal | "auto" = (side === "top" ? look.spaceTop : look.spaceBottom) ?? "auto";
  const prop = side === "top" ? "paddingTop" : "paddingBottom";
  const commit = (c: Cran) => {
    if (c.key === current) {
      // Inchangé : l'aperçu du glisser est retiré (au profit d'un espace validé et pas encore rendu, s'il y en a un).
      setPad(root, prop, overlayData<string>(`pad:${uid}:${prop}`) ?? "");
      return;
    }
    const seq = sendLook(uid, { ...look, [side === "top" ? "spaceTop" : "spaceBottom"]: c.key === "auto" ? undefined : c.key });
    keepPad(uid, prop, c.px, seq);
    announce(`Espace ${side === "top" ? "au-dessus" : "en dessous"} : ${cranLabel(c)}`);
  };
  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const list = crans(root, side);
    const startY = e.clientY;
    const start = pad;
    let last = nearest(list, start);
    const move = (ev: PointerEvent) => {
      const px = Math.max(0, start + (ev.clientY - startY));
      last = nearest(list, px);
      // Aperçu aimanté : le bloc prend la valeur du cran le plus proche.
      setPad(root, prop, `${last.px}px`);
      setDrag({ px, cran: last });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      setDrag(null);
      commit(last);
    };
    const cancel = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      setDrag(null);
      // Retour à l'espace d'avant le geste : validé et en attente, sinon celui du serveur.
      setPad(root, prop, overlayData<string>(`pad:${uid}:${prop}`) ?? "");
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const list = crans(root, side).sort((a, b) => a.px - b.px || (a.key === "auto" ? -1 : 1));
    const i = list.findIndex((c) => c.key === current);
    const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) commit(next);
  };
  const shown = drag ? drag.cran.px : pad;
  const zoneTop = side === "top" ? r.top : r.top + r.height - shown;
  return (
    <>
      <div className="lk-space-zone" data-side={side} data-active={drag ? "" : undefined} style={{ top: zoneTop, left: r.left, width: r.width, height: Math.max(2, shown) }} aria-hidden="true">
        {(drag || shown > 14) && <span className="lk-space-value">{drag ? `${cranLabel(drag.cran)} · ${Math.round(drag.cran.px)} px` : `${current === "auto" ? "Auto" : spaceLabel(current)} · ${Math.round(shown)} px`}</span>}
      </div>
      <button
        type="button"
        className="lk-space-handle"
        data-side={side}
        // Sur le bord de la zone qui suit le curseur : en haut, le bord côté contenu ;
        // en bas, le bord extérieur (le bloc grandit vers le bas, son contenu ne bouge pas).
        style={{ top: side === "top" ? r.top + shown - 5 : r.top + r.height - 5, left: r.left + r.width / 2 - 22 }}
        aria-label={`Espace ${side === "top" ? "au-dessus" : "en dessous"} : ${current === "auto" ? "Auto" : spaceLabel(current)}. Glisser, ou flèches haut et bas.`}
        title={`Espace ${side === "top" ? "au-dessus" : "en dessous"} (glisser : crans du thème)`}
        onPointerDown={onDown}
        onKeyDown={onKey}
      />
    </>
  );
}

/* ---- Textes ------------------------------------------------------------------- */

const TEXT_SEL = "[data-inline], [data-site-inline], [data-slot-inline], [data-project-inline], [data-look-key]";

/** Rôle global d'un texte (styles du site). */
function roleOf(el: HTMLElement): Role {
  if (el.closest(".site-header")) return el.closest(".site-brand") ? "brand" : "menu";
  if (el.closest(".eyebrow")) return "eyebrow";
  if (el.closest("h1")) return "h1";
  if (el.closest("h2, h3")) return "h2";
  if (el.closest(".caption-text, figcaption, .strip-caption")) return "caption";
  // Pied de page : un texte courant (police du texte ; sa taille reste la sienne, voir ROLE_FONT_ONLY_SELECTORS).
  if (el.closest("footer")) return "body";
  return "body";
}

/** Barres d'outils de la toile (blocs, composants, liens du menu…) : la pastille « Aa » ne s'y pose pas non plus. */
const TOOL_SEL = ".pe-layer :is(button, [role=toolbar], .pe-tools):not(.pe-focus)";
const AA_W = 30;
const AA_H = 22;

/**
 * Place de la pastille « Aa » d'un texte (lot 70). Elle se pose d'abord au-dessus de l'angle droit du texte survolé ; si elle y recouvrirait
 * un AUTRE texte modifiable (ligne du dessus d'une légende, date posée sur la ligne suivante…) ou une barre d'outils, elle essaie
 * ailleurs : au-dessus à gauche, hors du texte à droite puis à gauche, en dessous. Un texte passe toujours avant une barre. Dernier recours :
 * dans le texte lui-même s'il est assez grand, sinon la place d'avant. Un clic sur la ligne 2 ne tombe donc jamais sur la pastille de la ligne 1.
 */
function aaPlace(own: HTMLElement, rect: Rect): { top: number; left: number } {
  const minTop = window.scrollY + 2;
  const minLeft = window.scrollX + 2;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - AA_W - 2;
  const boxes = (sel: string) =>
    [...document.querySelectorAll<HTMLElement>(sel)]
      .filter((e) => e !== own && !own.contains(e) && !e.contains(own) && !e.closest(".lk-aa, .lk-bar, .lk-pos"))
      .map(docRect)
      .filter((r) => r.width > 0 && r.height > 0);
  const texts = boxes(TEXT_SEL);
  // Les cadres de focus et autres calques pleine largeur ne sont pas des barres : seules comptent les barres de taille de barre.
  const tools = boxes(TOOL_SEL).filter((r) => r.width < 420 && r.height < 160);
  const hits = (c: { top: number; left: number }, list: Rect[]) => list.some((r) => c.left < r.left + r.width && c.left + AA_W > r.left && c.top < r.top + r.height && c.top + AA_H > r.top);
  const inside = (c: { top: number; left: number }) => c.left >= minLeft && c.left <= maxLeft && c.top >= minTop;
  const right = rect.left + rect.width - AA_W;
  const mid = rect.top + Math.max(0, (rect.height - AA_H) / 2);
  const candidates = [
    { top: Math.max(minTop, rect.top - 24), left: right },
    { top: Math.max(minTop, rect.top - 24), left: rect.left },
    { top: Math.max(minTop, rect.top - 24), left: rect.left - AA_W - 4 },
    { top: Math.max(minTop, rect.top - 24), left: rect.left + rect.width + 4 },
    { top: mid, left: rect.left + rect.width + 4 },
    { top: mid, left: rect.left - AA_W - 4 },
    { top: rect.top + rect.height + 2, left: right },
    { top: rect.top + rect.height + 2, left: rect.left },
  ].filter(inside);
  // D'abord une place libre de tout texte ET de toute barre ; sinon libre de tout texte (la barre passe après) ; sinon, DANS le texte,
  // sur son angle droit, s'il est assez grand pour rester cliquable à côté (jamais hors de lui, donc jamais sur un autre texte) ;
  // sinon la place d'avant (au-dessus de l'angle droit) : un champ étroit ou bas (date vide…) resterait recouvert, donc incliquable.
  const pick = candidates.find((c) => !hits(c, texts) && !hits(c, tools)) ?? candidates.find((c) => !hits(c, texts));
  if (pick) return pick;
  if (rect.width >= 4 * AA_W && rect.height >= AA_H) return { top: Math.max(minTop, mid), left: Math.max(minLeft, Math.min(maxLeft, right)) };
  return { top: Math.max(minTop, rect.top - 24), left: Math.max(minLeft, Math.min(maxLeft, right)) };
}

/** Chemin stable d'un élément (le DOM est re-rendu au rafraîchissement). */
function pathOf(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    const parent: Element | null = cur.parentElement;
    if (!parent) break;
    parts.unshift(`:nth-child(${[...parent.children].indexOf(cur) + 1})`);
    cur = parent;
  }
  return `body > ${parts.join(" > ")}`;
}

type TextTarget = {
  /** Sélecteur STABLE du texte (attributs d'identité) ; à défaut, son chemin dans le DOM (`pathOf`). */
  path: string;
  role: Role;
  /** Texte d'un bloc : style local possible (chemin dans look.text). */
  local: { uid: string; key: string } | null;
  /** Légende d'une planche de projet (lot 98) : champ (titre, légende, date) et projet, pour la portée « Les légendes de ce projet ». */
  cap: { field: CaptionStyleField; board: number } | null;
  /** L'élément lui-même au moment du choix (le DOM est re-rendu : `elementOf` le retrouve par `path` s'il a été remplacé). */
  el?: HTMLElement;
};

/** L'élément d'un texte : celui qu'on a choisi s'il est encore là, sinon celui que son sélecteur désigne. */
function elementOf(target: Pick<TextTarget, "path" | "el">): HTMLElement | null {
  if (target.el?.isConnected) return target.el;
  try {
    return document.querySelector<HTMLElement>(target.path);
  } catch {
    return null;
  }
}

/**
 * Blocs dont des textes sont rendus par un composant client : seuls les chemins
 * listés reçoivent un style local (passé en props). Vidéo : étiquette, titre et légende.
 * Le formulaire de contact transmet tous ses textes (ContactForm, `styles`).
 */
const LOCAL_ONLY: Record<string, Set<string>> = { "video-single": new Set(["eyebrow", "title", "description"]) };

/** Bloc de la page, ou composant d'une planche (lot 31c : un Texte…), qui porte ce texte : le plus proche des deux. */
const OWNER_SEL = "[data-edit-bitem]:not([data-edit-bitem-rail]), [data-edit-block]";
const ownerUid = (b: HTMLElement) => b.dataset.editBlock ?? b.dataset.editBitem;
/** Case d'une grille de PLANCHE : son style s'écrit dans les réglages de la case (`cell-look`), pas dans ceux de la grille. */
const BOARD_CELL_SEL = ".block-grid-cell[data-edit-cell]";

/**
 * Sélecteur stable d'un texte, d'après ses attributs d'identité (jamais son rang dans le DOM : une planche re-rendue change les rangs
 * et la barre « Aa » perdait son texte). Le premier sélecteur qui désigne CE texte et lui seul ; sinon null.
 */
function stableSelector(el: HTMLElement): string | null {
  const q = (name: string, v: string | undefined) => (v === undefined ? "" : `[${name}="${CSS.escape(v)}"]`);
  const own = q("data-inline", el.dataset.inline) + q("data-look-key", el.dataset.lookKey) + q("data-site-inline", el.dataset.siteInline) + q("data-slot-inline", el.dataset.slotInline) + q("data-project-inline", el.dataset.projectInline);
  if (!own) return null;
  const cap = q("data-cap", el.dataset.cap);
  const slot = el.closest<HTMLElement>("[data-slot-slug]");
  const owner = el.closest<HTMLElement>(`${BOARD_CELL_SEL}, ${OWNER_SEL}`);
  const ownerSel = owner ? (owner.matches(BOARD_CELL_SEL) ? q("data-edit-cell", owner.dataset.editCell) : owner.dataset.editBlock !== undefined ? q("data-edit-block", owner.dataset.editBlock) : q("data-edit-bitem", owner.dataset.editBitem)) : "";
  const board = el.closest<HTMLElement>("[data-edit-board]");
  const candidates = [
    `${ownerSel} ${slot ? q("data-slot-slug", slot.dataset.slotSlug) + " " : ""}${own}${cap}`.trim(),
    `${board ? q("data-edit-board", board.dataset.editBoard) + " " : ""}${ownerSel} ${slot ? q("data-slot-slug", slot.dataset.slotSlug) + " " : ""}${own}${cap}`.trim(),
  ];
  for (const sel of candidates) {
    try {
      const all = document.querySelectorAll(sel);
      if (all.length === 1 && all[0] === el) return sel;
    } catch {
      /* sélecteur refusé : on passe au suivant */
    }
  }
  return null;
}

function targetOf(el: HTMLElement): TextTarget {
  const found = el.closest<HTMLElement>(OWNER_SEL);
  const only = found && Object.hasOwn(LOCAL_ONLY, found.dataset.editType ?? found.dataset.editBitemType ?? "") ? LOCAL_ONLY[(found.dataset.editType ?? found.dataset.editBitemType)!] : null;
  // `data-look-key` : texte du PROJET (contenu partagé) mis en forme localement par le bloc qui l'affiche.
  const inline = el.dataset.inline ?? el.dataset.lookKey;
  const block = found && (!only || (inline !== undefined && only.has(inline))) ? found : null;
  const site = el.dataset.siteInline;
  let local: TextTarget["local"] = null;
  const uid = block ? ownerUid(block) : undefined;
  // Case d'une grille de planche : son texte (`children.<rang>.props.<champ>`) se règle dans la case, sous le nom du champ.
  const cell = block?.dataset.editBitem && inline?.startsWith("children.") ? el.closest<HTMLElement>(BOARD_CELL_SEL) : null;
  if (cell?.dataset.editCell && block && block.contains(cell)) local = { uid: cell.dataset.editCell, key: inline!.replace(/^children\.\d+\.props\./, "") };
  else if (uid && inline && el.closest(OWNER_SEL) === block) local = { uid, key: inline };
  else if (uid && (site === "name" || site === "role")) local = { uid, key: `site.${site}` };
  // Une clé que le schéma des réglages refuserait serait perdue en silence (le message est écarté) : pas de « Ce texte » pour elle.
  if (local && !local.key.startsWith("site.") && !TEXT_PATH_RE.test(local.key)) local = null;
  const board = Number(el.closest<HTMLElement>("[data-edit-board]")?.dataset.editBoard);
  const field = el.dataset.cap === "title" || el.dataset.cap === "legend" || el.dataset.cap === "date" ? el.dataset.cap : null;
  return { path: stableSelector(el) ?? pathOf(el), role: roleOf(el), local, cap: board && field ? { field, board } : null, el };
}

/** Styles du site tels que le serveur les a rendus (feuille `#site-styles`). */
function serverStyles(): SiteStyles {
  try {
    return SiteStylesSchema.safeParse(JSON.parse(document.getElementById("site-styles")?.dataset.editStyles ?? "{}")).data ?? {};
  } catch {
    return {};
  }
}

/** Styles du site : ceux du serveur, et par-dessus les styles de rôle posés dont il n'a pas encore acquitté l'enregistrement. */
function siteStyles(): SiteStyles {
  const base = serverStyles();
  const pending = overlayList<{ role: Role; style: TextStyle | undefined }>("role:");
  if (!pending.length) return base;
  const roles = { ...(base.roles ?? {}) };
  for (const p of pending) {
    if (p.style) roles[p.role] = p.style;
    else delete roles[p.role];
  }
  return { ...base, roles };
}

/** Feuille d'aperçu des styles de rôle en attente (retirée quand il n'y en a plus). */
function renderRolePreview() {
  let el = document.getElementById("pe-style-preview");
  if (!overlayList("role:").length) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = "pe-style-preview";
    document.body.appendChild(el);
  }
  const css = siteStylesCss(siteStyles(), canvasPalette());
  if (el.textContent !== css) el.textContent = css;
}

/** Aperçu immédiat d'un style global, gardé jusqu'à ce que la feuille du serveur le porte. */
function previewRole(role: Role, style: TextStyle | undefined, seq: number) {
  setOverlay(`role:${role}`, seq, { data: { role, style }, apply: renderRolePreview, clear: renderRolePreview });
}

/** Éléments d'un texte de bloc visé par un style local (`look.text`). */
function localTexts(local: { uid: string; key: string }): HTMLElement[] {
  const block = wrapperOf(local.uid);
  if (!block) return [];
  const cell = block.matches(BOARD_CELL_SEL);
  // Case d'une grille de planche : ses textes portent le préfixe de la grille (`children.<rang>.props.`).
  const sel = local.key.startsWith("site.")
    ? `[data-site-inline="${CSS.escape(local.key.slice(5))}"]`
    : `[data-inline="${CSS.escape(local.key)}"], [data-look-key="${CSS.escape(local.key)}"]${cell ? `, [data-inline$=".props.${CSS.escape(local.key)}"]` : ""}`;
  return [...block.querySelectorAll<HTMLElement>(sel)].filter((e) => (cell ? block.contains(e) : e.closest(OWNER_SEL) === block));
}

/** Style en ligne d'un aperçu : celui du texte, en gardant le masquage d'un texte en cours de saisie sur la planche (l'original reste caché derrière le champ). */
function setPreviewStyle(el: HTMLElement, css: string) {
  const hidden = el.style.visibility === "hidden";
  const next = hidden ? `${css};visibility:hidden` : css;
  if (el.getAttribute("style") !== next) el.setAttribute("style", next);
}

/** Aperçu immédiat du style de CE texte, gardé jusqu'à ce que le serveur le rende. */
function previewTextStyle(local: { uid: string; key: string }, style: TextStyle | undefined, seq: number, own = Boolean(style)) {
  const css = textStyleDecls(style, canvasPalette()).map(([k, v]) => `${k}:${v}`).join(";");
  setOverlay(`tstyle:${local.uid}:${local.key}`, seq, {
    apply: () => {
      for (const el of localTexts(local)) {
        setPreviewStyle(el, css);
        // Une légende réglée seule ne suit plus le style du projet (aperçu du projet : voir `previewCaptions`).
        if (el.hasAttribute("data-cap")) {
          if (own) el.setAttribute("data-cap-local", "");
          else el.removeAttribute("data-cap-local");
        }
      }
    },
  });
}

/** Style des légendes d'un projet tel que le serveur l'a rendu (`data-edit-capstyle` de la planche), ou celui qu'on vient d'envoyer. */
function captionStyles(board: number): ProjectCaptionStyle {
  const pending = overlayData<{ style: ProjectCaptionStyle }>(`capstyle:${board}`);
  if (pending) return pending.style;
  try {
    return JSON.parse(document.querySelector<HTMLElement>(`[data-edit-board="${board}"]`)?.dataset.editCapstyle ?? "{}") as ProjectCaptionStyle;
  } catch {
    return {};
  }
}

/** Aperçu immédiat du style des légendes d'un projet : toutes ses légendes qui n'ont pas de style propre, jusqu'à ce que le serveur le rende. */
function previewCaptions(board: number, style: ProjectCaptionStyle, seq: number) {
  setOverlay(`capstyle:${board}`, seq, {
    data: { style },
    apply: () => {
      for (const f of ["title", "legend", "date"] as const) {
        const css = textStyleDecls(style[f] as TextStyle | undefined, canvasPalette()).map(([k, v]) => `${k}:${v}`).join(";");
        for (const el of document.querySelectorAll<HTMLElement>(`[data-edit-board="${board}"] [data-cap="${f}"]:not([data-cap-local])`)) setPreviewStyle(el, css);
      }
    },
  });
}

type Scope = "local" | "project" | "role";

function TextBar({
  target,
  installed,
  themeNames,
  onClose,
  tick,
}: {
  target: TextTarget;
  installed: string[];
  themeNames?: Partial<Record<"display" | "body" | "caption", string>>;
  onClose: () => void;
  tick: number;
}) {
  const [scope, setScope] = useState<Scope>(target.local ? "local" : target.cap ? "project" : "role");
  // Redessin à chaque réglage : l'aperçu ne change que des attributs (la page n'est pas observée pour cela). Sans lui, la barre garde
  // l'ancienne valeur jusqu'au prochain redessin de la page, et un second réglage fait aussitôt après écraserait le premier.
  const [, redraw] = useState(0);
  const el = elementOf(target);
  void tick;
  // Le texte n'est plus là (la page s'est redessinée autrement) : la barre n'a plus de cible et, sans cette fermeture, bloquerait le
  // « Aa » des autres textes. Un redessin passager la retrouve avant le délai ; le délai n'est PAS relancé par chaque redessin.
  const missing = !el;
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!missing) return;
    const t = setTimeout(() => closeRef.current(), 2000);
    return () => clearTimeout(t);
  }, [missing]);
  if (!el) return null;
  const look = target.local ? lookOf(target.local.uid) : {};
  // Fond du métier de l'ouverture réglé avant le lot 21 (`look.roleBackdrop`) : « Ombre douce » et « Bandeau » sont montrés comme
  // celui du texte et migrés dans son style dès qu'on le modifie (le rendu ne change pas). L'ancien « Surlignage » (aplat en
  // ligne, look.css) n'a pas le rendu du nouveau (trait derrière le texte) : il reste tel quel, sans être montré ni migré,
  // jusqu'à ce qu'on choisisse un nouveau fond (ou « Revenir au style global »).
  const oldBackdrop = target.local?.key === "site.role" ? look.roleBackdrop : undefined;
  const legacyBackdrop = oldBackdrop && oldBackdrop !== "highlight" ? oldBackdrop : undefined;
  const localStyle: TextStyle = target.local ? { ...(legacyBackdrop ? { backdrop: legacyBackdrop } : {}), ...(look.text?.[target.local.key] ?? {}) } : {};
  // Style des légendes du projet (lot 98) pour le champ de ce texte.
  const projectAll = target.cap ? captionStyles(target.cap.board) : {};
  const projectStyle: TextStyle = target.cap ? ((projectAll[target.cap.field] as TextStyle | undefined) ?? {}) : {};
  // « Titres » : le titre de page et les titres de section partagent UN réglage (lot 68) ; le titre de page n'a son propre style que s'il en a posé un.
  const role: Role = target.role === "h1" ? "h2" : target.role;
  const roleStyle: TextStyle = (() => {
    const roles = siteStyles().roles ?? {};
    // Depuis un titre de page : le réglage commun des titres, avec la taille du titre de page.
    if (target.role !== "h1") return roles[role] ?? {};
    const out = { ...(roles.h2 ?? {}), ...(roles.h1?.size ? { size: roles.h1.size } : { size: undefined }), ...(roles.h1?.scale ? { scale: roles.h1.scale } : { scale: undefined }) };
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as TextStyle;
  })();
  const level: Scope = scope === "local" && !target.local ? (target.cap ? "project" : "role") : scope === "project" && !target.cap ? "role" : scope;
  const value = level === "local" ? localStyle : level === "project" ? projectStyle : roleStyle;
  const change = (input: TextStyle | undefined) => {
    let next = input;
    // Police Google choisie sans graisse : celle du texte affiché (le serveur
    // télécharge exactement ce style).
    const fam = googleOf(next?.font) ? googleFamily(googleOf(next?.font)!) : undefined;
    if (next && fam && !next.weight) next = { ...next, weight: nearestWeight(fam, parseInt(getComputedStyle(el).fontWeight, 10) || 400, Boolean(next.italic)) };
    if (level === "local" && target.local) {
      const text = { ...(look.text ?? {}) };
      if (next) text[target.local.key] = next;
      else delete text[target.local.key];
      const seq = sendLook(target.local.uid, { ...look, text, ...(oldBackdrop && (legacyBackdrop || next === undefined || next.backdrop !== undefined) ? { roleBackdrop: undefined } : {}) });
      // Aperçu immédiat sur ce texte : son style propre par-dessus celui du projet (« Ce texte » passe devant), ou celui du projet s'il est retiré.
      const shown = target.cap && Object.keys(projectStyle).length ? resolveTextStyle(projectStyle, next) : next;
      previewTextStyle(target.local, shown, seq, Boolean(next));
    } else if (level === "project" && target.cap) {
      const style: ProjectCaptionStyle = { ...projectAll };
      const clean = next ? (Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as TextStyle) : undefined;
      if (clean && Object.keys(clean).length) style[target.cap.field] = clean;
      else delete style[target.cap.field];
      const seq = postIntent({ kind: "board-captions", board: target.cap.board, style: Object.keys(style).length ? (style as never) : null });
      previewCaptions(target.cap.board, style, seq);
    } else {
      // « Titres » (lot 68) : police, graisse, couleur… sont UN réglage pour le titre de page et les titres de section ; seule la TAILLE
      // reste propre à chacun (le titre de page est plus grand). Depuis un titre de page, la taille va donc à « Titre de page ».
      const roles = siteStyles().roles ?? {};
      const post = (r: Role, style: TextStyle | undefined) => {
        const seq = postIntent({ kind: "site-style", role: r, style: style ?? null });
        previewRole(r, style, seq);
      };
      const clean = (s: TextStyle): TextStyle | undefined => {
        const out = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as TextStyle;
        return Object.keys(out).length ? out : undefined;
      };
      const SIZE_KEYS = ["size", "scale"];
      const changed = (Object.keys({ ...roleStyle, ...(next ?? {}) }) as (keyof TextStyle)[]).filter((k) => !SIZE_KEYS.includes(k) && JSON.stringify(roleStyle[k]) !== JSON.stringify(next?.[k]));
      const withoutChanged = (s: TextStyle | undefined) => Object.fromEntries(Object.entries(s ?? {}).filter(([k]) => !(changed as string[]).includes(k))) as TextStyle;
      if (target.role === "h1") {
        const { size, scale, ...shared } = next ?? {};
        post("h2", clean({ ...shared, size: roles.h2?.size, scale: roles.h2?.scale }));
        post("h1", clean({ ...withoutChanged(roles.h1), size, scale }));
      } else {
        post(role, next);
        // Un style propre du titre de page ne doit pas empêcher « tous les titres » de changer : ce qu'on vient de régler lui est retiré.
        if (role === "h2" && roles.h1 && changed.some((k) => k in roles.h1!)) post("h1", clean(withoutChanged(roles.h1)));
      }
    }
  };
  const board = Boolean(target.cap);
  // Fenêtre ancrée au bouton « Aa » (lot 65) : au-dessus du texte si la place y est, jamais sur la barre d'outils du bloc ni loin du bouton.
  return (
    <Popover anchor=".lk-aa" dataAttrs={{ "data-text-target": target.local?.key ?? target.role }} avoid={target.path} obstacles=".pe-tools" prefer="above" className="lk-bar" role="toolbar" label="Style du texte" onClose={onClose} ignoreDismiss={(t) => Boolean(elementOf(target)?.contains(t)) || (t instanceof Element && Boolean(t.closest(".pe-text-editor")))} onPointerDown={(e) => e.stopPropagation()}>
      <div className="lk-bar-head">
        <span className="lk-seg" role="radiogroup" aria-label="Appliquer à">
          {target.local && (
            <button type="button" role="radio" aria-checked={level === "local"} onClick={() => setScope("local")}>
              Ce texte
            </button>
          )}
          {target.cap && (
            <button type="button" role="radio" aria-checked={level === "project"} onClick={() => setScope("project")} title="Toutes les légendes de ce champ, sous les images de ce projet : partout où le projet est montré">
              Les légendes de ce projet
            </button>
          )}
          <button type="button" role="radio" aria-checked={level === "role"} onClick={() => setScope("role")} title="Styles du site : toutes les pages (publié avec la page)">
            {board ? "Tout le site" : role === "h2" ? "Tous les titres" : `Tous les « ${ROLE_LABELS[role]} »`}
          </button>
        </span>
        <button type="button" className="lk-close" aria-label="Fermer la barre" onClick={onClose}>
          ✕
        </button>
      </div>
      <TypoControls
        value={value}
        onChange={(v) => {
          change(v);
          redraw((n) => n + 1);
        }}
        installed={installed}
        swatch={swatch}
        themeNames={themeNames}
        compact
        resetLabel={level === "local" ? (board ? "Revenir au style du projet" : "Revenir au style global") : level === "project" ? "Revenir au style du site" : "Revenir au thème"}
        palette={canvasPalette()}
        backdropBlocked={BACKDROP_BLOCKED[role]}
        inheritedColor={level === "local" ? (projectStyle.color ?? roleStyle.color) : level === "project" ? roleStyle.color : undefined}
      />
    </Popover>
  );
}

/* ---- Position du titre ------------------------------------------------------------ */

const TITLE_TYPES = new Set(["section-title", "collection-intro", "hero", "project-board", "collection-tiles"]);

function PosIcon({ axis, v }: { axis: "h" | "v"; v: string }) {
  // Trait épais = le titre ; cadre = l'emplacement.
  const pos = v === "left" || v === "top" ? 3 : v === "right" || v === "bottom" ? 11 : 7;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      {axis === "h" ? <rect x={pos - 2} y="4" width="5" height="8" fill="currentColor" /> : <rect x="4" y={pos - 2} width="8" height="5" fill="currentColor" />}
    </svg>
  );
}

/**
 * Position du titre (ou, sur l'ouverture, du TEXTE : étiquette, nom, accroche). Lot 105 : sur l'ouverture, qui fait la hauteur de la fenêtre, la barre se
 * pose DANS le bloc, au-dessus du texte qu'elle déplace (et non sous le bloc, hors de l'écran), avec son nom visible ; chaque forme d'ouverture dit sa
 * position de départ (le projecteur est centré, les autres sont à gauche et en bas) : le bouton coché est celui qu'on voit.
 */
function TitlePosition({ uid, type, inCell, rect }: { uid: string; type: string; inCell: boolean; rect: Rect }) {
  const look = lookOf(uid);
  const hero = type === "hero";
  const vertical = hero || inCell;
  const wrapper = wrapperOf(uid);
  const spot = hero && Boolean(wrapper?.querySelector(".hero-spotlight"));
  const defH = spot ? "center" : "left";
  const defV = hero ? (spot ? "middle" : "bottom") : "top";
  const what = hero ? "Texte" : "Titre";
  const H = [
    ["left", `${what} à gauche`],
    ["center", `${what} centré`],
    ["right", `${what} à droite`],
  ] as const;
  const V = [
    ["top", `${what} en haut`],
    ["middle", `${what} au milieu`],
    ["bottom", `${what} en bas`],
  ] as const;
  // Ouverture : au-dessus du texte déplacé (sa boîte est dans l'écran) ; sinon sous le bloc, comme avant.
  const anchor = hero ? wrapper?.querySelector<HTMLElement>(".hero-text") : null;
  const place = anchor ? { top: docRect(anchor).top + 12, left: docRect(anchor).left + 12 } : { top: rect.top + rect.height + 4, left: rect.left + 8 };
  const label = hero ? "Position du texte" : "Position du titre";
  return (
    <div className="lk-pos" role="toolbar" aria-label={label} data-testid="title-position" data-what={hero ? "text" : "title"} title={hero ? "Où se place le texte de l'ouverture (étiquette, nom, accroche)" : "Où se place le titre"} style={place}>
      {hero && <span className="lk-pos-label">{label}</span>}
      {H.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={(look.titleH ?? defH) === v} aria-label={text} title={text} onClick={() => sendLook(uid, { ...look, titleH: v === defH ? undefined : v })}>
          <PosIcon axis="h" v={v} />
        </button>
      ))}
      {vertical && <span className="lk-sep" aria-hidden="true" />}
      {vertical &&
        V.map(([v, text]) => (
          <button key={v} type="button" aria-pressed={(look.titleV ?? defV) === v} aria-label={text} title={text} onClick={() => sendLook(uid, { ...look, titleV: v === defV ? undefined : v })}>
            <PosIcon axis="v" v={v} />
          </button>
        ))}
    </div>
  );
}

/* ---- Cadrage ------------------------------------------------------------------------ */

type CropTarget = {
  uid: string;
  field: "mediaId" | "backgroundMediaId" | "portraitMediaId";
  media: HTMLImageElement | HTMLVideoElement;
  /** Tuile de collection : son cadrage vit dans `look.tileCrop[tile]`. */
  tile?: TileKey;
  /**
   * Bloc Image (lot 17d) : l'image ENTIÈRE (le cadre peut afficher une variante recadrée), son rapport, ses
   * pixels, et le format imposé au cadre (null : aucun). Recadrage libre possible seulement avec elle.
   */
  full?: { src: string; ratio: number; w: number; h: number; box: number | null };
};
const CROPPABLE: Record<string, CropTarget["field"]> = { image: "mediaId", hero: "backgroundMediaId", profile: "portraitMediaId" };

function mediaRatio(m: HTMLImageElement | HTMLVideoElement): number {
  const w = m instanceof HTMLImageElement ? m.naturalWidth : m.videoWidth;
  const h = m instanceof HTMLImageElement ? m.naturalHeight : m.videoHeight;
  return w && h ? w / h : 0;
}

/** Image d'un emplacement qui n'a pas son format (affichée en « cover »). */
function cropTargetAt(t: EventTarget | null): CropTarget | null {
  if (!(t instanceof Element)) return null;
  // Tuile de collection (accueil) : une image par collection, format imposé par le bloc.
  const tileHost = t.closest<HTMLElement>("[data-edit-tile]");
  if (tileHost) {
    const tileBlock = tileHost.closest<HTMLElement>("[data-edit-block]");
    const tile = tileHost.dataset.editTile as TileKey | undefined;
    const img = tileHost.querySelector<HTMLImageElement>("img");
    if (!tileBlock?.dataset.editBlock || !tile || !(TILE_KEYS as readonly string[]).includes(tile) || !img) return null;
    // Couverture raster : recadrage libre toujours possible (l'image ENTIÈRE vient de la tuile, pas de la variante affichée).
    const fullSrc = tileHost.dataset.fullSrc;
    if (fullSrc) {
      const [fw, fh] = (tileHost.dataset.fullPx ?? "0x0").split("x").map(Number);
      const ratio = Number(tileHost.dataset.fullRatio);
      if (!ratio || !fw || !fh) return null;
      return { uid: tileBlock.dataset.editBlock, field: "mediaId", media: img, tile, full: { src: fullSrc, ratio, w: fw, h: fh, box: parseRatio(tileHost.closest<HTMLElement>(".tiles")?.dataset.ratio) } };
    }
    const ir = mediaRatio(img);
    const box = img.getBoundingClientRect();
    // Le zoom agrandit l'image dans son cadre : le cadre (parent) donne le format.
    const frame = tileHost.getBoundingClientRect();
    if (!ir || !frame.height || !box.height || !needsCrop(ir, frame.width / frame.height)) return null;
    return { uid: tileBlock.dataset.editBlock, field: "mediaId", media: img, tile };
  }
  const host = t.closest<HTMLElement>("[data-edit-media]");
  // Case d'une grille de planche (lot 31d) : la case est le « bloc » (elle n'en est pas un de la page).
  const boardCell = host?.closest("[data-edit-bitem]") ? host.closest<HTMLElement>(".block-grid-cell[data-edit-cell]") : null;
  const block = boardCell ?? host?.closest<HTMLElement>("[data-edit-block]");
  const blockUid = boardCell ? boardCell.dataset.editCell : block?.dataset.editBlock;
  const blockType = boardCell ? boardCell.dataset.cellType : block?.dataset.editType;
  const field = block ? CROPPABLE[blockType ?? ""] : undefined;
  if (!host || !block || !blockUid || !field || host.dataset.editMedia !== field) return null;
  // Ouverture : seulement une image ou vidéo de fond choisie (pas le décor du thème).
  const media = host.querySelector<HTMLImageElement | HTMLVideoElement>(field === "backgroundMediaId" ? ".hero-backdrop img, .hero-backdrop video" : "img");
  if (!media) return null;
  // Bloc Image : toujours recadrable (libre) ; l'image entière vient du bloc, pas de la variante affichée.
  const fullSrc = host.dataset.fullSrc;
  if (field === "mediaId" && fullSrc && media instanceof HTMLImageElement) {
    const [fw, fh] = (host.dataset.fullPx ?? "0x0").split("x").map(Number);
    const ratio = Number(host.dataset.fullRatio);
    if (!ratio || !fw || !fh) return null;
    const figure = host.closest<HTMLElement>("figure.block-image");
    const box = parseRatio(figure?.dataset.editBox);
    return { uid: blockUid, field, media, full: { src: fullSrc, ratio, w: fw, h: fh, box } };
  }
  const ir = mediaRatio(media);
  const box = media.getBoundingClientRect();
  if (!ir || !box.height || !needsCrop(ir, box.width / box.height)) return null;
  return { uid: blockUid, field, media };
}

/** Onglets Libre / Cadre du bloc de la modale « Cadrer l'image ». */
function CropTabs({ mode, onMode }: { mode: "free" | "frame"; onMode: (m: "free" | "frame") => void }) {
  return (
    <div className="lk-crop-tabs" role="tablist" aria-label="Mode de cadrage">
      <button type="button" role="tab" aria-selected={mode === "free"} onClick={() => onMode("free")}>
        Libre
      </button>
      <button type="button" role="tab" aria-selected={mode === "frame"} onClick={() => onMode("frame")} title="Point focal et zoom dans le format imposé au bloc">
        Dans le cadre du bloc
      </button>
    </div>
  );
}

/** Modale de cadrage : « Libre » par défaut pour une image seule ; « Dans le cadre de la rubrique » (point focal + zoom) quand un format est imposé. */
function CropDialog({ target, onClose }: { target: CropTarget; onClose: () => void }) {
  const look = lookOf(target.uid);
  const existing = target.tile ? look.tileCrop?.[target.tile] : look.crop?.[target.field];
  const full = target.full;
  // Lot 77 (MENU-11) : la fenêtre vit dans la toile ; l'éditeur (page parente) pose un voile sur son panneau et sa barre tant qu'elle est ouverte.
  useEffect(() => {
    const tell = (open: boolean) => {
      if (window.parent !== window) window.parent.postMessage({ type: EDIT_MSG, kind: "modal", open }, window.location.origin);
    };
    tell(true);
    return () => tell(false);
  }, []);
  // Cadre au format imposé : l'ancien mode (point focal + zoom) reste possible, et reste ouvert s'il est déjà réglé.
  const frameOk = Boolean(full?.box) || Boolean(existing && !existing.rect);
  const [mode, setMode] = useState<"free" | "frame">(full && !(existing && !existing.rect && frameOk) ? "free" : "frame");
  if (full && mode === "free") {
    return (
      <FreeCropDialog
        src={full.src}
        px={{ w: full.w, h: full.h }}
        initial={existing?.rect ?? null}
        tabs={frameOk ? <CropTabs mode="free" onMode={setMode} /> : undefined}
        onClose={onClose}
        onSave={(rect: CropRect | null) => {
          if (target.tile) {
            const tiles = { ...(look.tileCrop ?? {}) };
            if (rect) tiles[target.tile] = { x: 50, y: 50, zoom: 1, rect };
            else delete tiles[target.tile];
            sendLook(target.uid, { ...look, tileCrop: tiles });
          } else {
            const next = { ...(look.crop ?? {}) };
            if (rect) next[target.field] = { x: 50, y: 50, zoom: 1, rect };
            else delete next[target.field];
            sendLook(target.uid, { ...look, crop: next });
          }
          onClose();
        }}
      />
    );
  }
  return <FrameCropDialog target={target} onClose={onClose} tabs={full && frameOk ? <CropTabs mode="frame" onMode={setMode} /> : undefined} />;
}

function FrameCropDialog({ target, onClose, tabs }: { target: CropTarget; onClose: () => void; tabs?: React.ReactNode }) {
  const look = lookOf(target.uid);
  // Une tuile : le cadre est le parent de l'image (l'image zoomée déborde de sa boîte).
  const box = (target.tile ? target.media.closest("[data-edit-tile]") ?? target.media : target.media).getBoundingClientRect();
  // Bloc Image : le format du cadre est celui que le bloc impose (l'image affichée peut être une variante recadrée).
  const boxRatio = target.full?.box ?? box.width / box.height;
  const ir = target.full?.ratio ?? mediaRatio(target.media);
  const stored = target.tile ? look.tileCrop?.[target.tile] : look.crop?.[target.field];
  const [crop, setCrop] = useState<Crop>(stored && !stored.rect ? stored : { x: 50, y: 50, zoom: 1 });
  const stage = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => dialog.current?.focus(), []);
  const win = cropWindow(crop, ir, boxRatio);
  const src = target.full?.src ?? (target.media instanceof HTMLImageElement ? target.media.currentSrc || target.media.src : "");
  const poster = target.media instanceof HTMLVideoElement ? target.media.poster : "";
  // Taille de l'image affichée : tient dans 80 % × 62 % de la fenêtre.
  const maxW = window.innerWidth * 0.8;
  const maxH = window.innerHeight * 0.62;
  const w = Math.min(maxW, maxH * ir);
  const h = w / ir;
  const moveBy = (dx: number, dy: number) => setCrop((c) => {
    const cw = cropWindow(c, ir, boxRatio);
    return cropFromWindow(Math.min(1 - cw.width, Math.max(0, cw.left + dx)), Math.min(1 - cw.height, Math.max(0, cw.top + dy)), c.zoom, ir, boxRatio);
  });
  const zoomTo = (z: number) => setCrop((c) => {
    const cw = cropWindow(c, ir, boxRatio);
    const nz = Math.min(4, Math.max(1, Math.round(z * 100) / 100));
    const nw = cropWindow({ ...c, zoom: nz }, ir, boxRatio);
    // Zoom autour du centre de la zone gardée.
    const cx = cw.left + cw.width / 2;
    const cy = cw.top + cw.height / 2;
    return cropFromWindow(Math.min(1 - nw.width, Math.max(0, cx - nw.width / 2)), Math.min(1 - nw.height, Math.max(0, cy - nw.height / 2)), nz, ir, boxRatio);
  });
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let lx = e.clientX;
    let ly = e.clientY;
    const move = (ev: PointerEvent) => {
      moveBy((ev.clientX - lx) / w, (ev.clientY - ly) / h);
      lx = ev.clientX;
      ly = ev.clientY;
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const save = () => {
    const centered = crop.zoom === 1 && Math.abs(crop.x - 50) < 0.01 && Math.abs(crop.y - 50) < 0.01;
    if (target.tile) {
      const tiles = { ...(look.tileCrop ?? {}) };
      if (centered) delete tiles[target.tile];
      else tiles[target.tile] = crop;
      sendLook(target.uid, { ...look, tileCrop: tiles });
      onClose();
      return;
    }
    const next = { ...(look.crop ?? {}) };
    if (centered) delete next[target.field];
    else next[target.field] = crop;
    sendLook(target.uid, { ...look, crop: next });
    onClose();
  };
  return (
    <div className="lk-crop-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="lk-crop"
        role="dialog"
        aria-modal="true"
        aria-label="Cadrer l'image"
        tabIndex={-1}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          const keys: Record<string, () => void> = {
            ArrowLeft: () => moveBy(-step, 0),
            ArrowRight: () => moveBy(step, 0),
            ArrowUp: () => moveBy(0, -step),
            ArrowDown: () => moveBy(0, step),
            "+": () => zoomTo(crop.zoom + 0.1),
            "=": () => zoomTo(crop.zoom + 0.1),
            "-": () => zoomTo(crop.zoom - 0.1),
            Escape: onClose,
            Enter: save,
          };
          if (keys[e.key] && !(e.target instanceof HTMLButtonElement && e.key === "Enter")) {
            e.preventDefault();
            e.stopPropagation();
            keys[e.key]();
          }
        }}
      >
        <p className="lk-crop-title">Cadrer l&apos;image</p>
        {tabs}
        <p className="lk-crop-help">La zone claire est gardée sur la page. Glisse-la, zoome à la molette (ou + / −) ; flèches pour la déplacer.</p>
        <div
          ref={stage}
          className="lk-crop-stage"
          style={{ width: w, height: h, backgroundImage: src || poster ? `url("${(src || poster).replace(/"/g, "%22")}")` : undefined }}
          onWheel={(e) => {
            e.preventDefault();
            zoomTo(crop.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
          }}
        >
          <div
            className="lk-crop-window"
            data-testid="crop-window"
            style={{ left: win.left * w, top: win.top * h, width: win.width * w, height: win.height * h }}
            onPointerDown={onDown}
          />
        </div>
        <div className="lk-crop-actions">
          <label className="lk-crop-zoom">
            Zoom
            <input type="range" min={1} max={4} step={0.05} value={crop.zoom} onChange={(e) => zoomTo(Number(e.target.value))} aria-label="Zoom" />
            <output>{Math.round(crop.zoom * 100)} %</output>
          </label>
          <button type="button" onClick={() => setCrop({ x: 50, y: 50, zoom: 1 })}>
            Recentrer
          </button>
          <span className="lk-spacer" />
          <button type="button" onClick={onClose}>
            Fermer sans enregistrer
          </button>
          <button type="button" className="lk-primary" onClick={save}>
            Enregistrer le cadrage
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Calque --------------------------------------------------------------------------- */

export default function LookLayer({
  selected,
  dragging,
  announce,
}: {
  selected: LookTarget;
  dragging: boolean;
  announce: (s: string) => void;
}) {
  const [hoverText, setHoverText] = useState<{ el: HTMLElement; rect: Rect; anchor?: HTMLElement } | null>(null);
  const [bar, setBar] = useState<TextTarget | null>(null);
  // Texte en cours de saisie (lot 98) : la pastille « Aa » reste sur lui, quelle que soit la souris, jusqu'à la fin de la saisie.
  const [active, setActive] = useState<TextTarget | null>(null);
  const activeRef = useRef<TextTarget | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const [cropHover, setCropHover] = useState<CropTarget | null>(null);
  const [cropOpen, setCropOpen] = useState<CropTarget | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [themeNames] = useState(readThemeNames);

  // Polices déjà téléchargées (message de l'éditeur).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = acceptToCanvas(event, window.location.origin, window.parent);
      if (msg?.kind === "fonts") setInstalled(msg.installed);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Re-mesure au défilement, au redimensionnement et quand la page est re-rendue.
  const bump = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(bump);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [bump]);

  // « Cadrer » depuis la barre d'une case de grille (GridLayer).
  useEffect(() => {
    const onCrop = (e: Event) => {
      const uid = (e as CustomEvent<{ cell?: string }>).detail?.cell;
      const cell = uid ? document.querySelector<HTMLElement>(`[data-edit-cell="${CSS.escape(uid)}"]`) : null;
      const img = cell?.querySelector<HTMLElement>("[data-edit-media] img") ?? null;
      const target = img ? cropTargetAt(img) : null;
      if (target) setCropOpen(target);
      else announce("Cette image ne peut pas être cadrée.");
    };
    window.addEventListener("pe:crop", onCrop);
    return () => window.removeEventListener("pe:crop", onCrop);
  }, [announce]);

  // Saisie d'un texte (page : EditLayer ; planche : BoardLayer) : sa barre s'ouvre d'elle-même, sans prendre le focus ; elle se ferme avec la saisie
  // (Entrée, Échap, clic ailleurs). Un clic DANS la barre ne doit ni ôter le focus au texte ni fermer la saisie (la souris ne le « prend » pas).
  useEffect(() => {
    let downInBar = 0;
    const onEdit = (e: Event) => {
      const el = (e as CustomEvent<{ el?: HTMLElement }>).detail?.el;
      if (!el || !el.isConnected) return;
      const t = targetOf(el);
      setActive(t);
      setBar((b) => (b && b.path === t.path ? b : t));
    };
    const onEnd = (e: Event) => {
      const el = (e as CustomEvent<{ el?: HTMLElement }>).detail?.el;
      const cur = activeRef.current;
      // Un autre texte que celui de la barre (et encore là) : rien à fermer. Un élément remplacé par un rendu du serveur est le même texte.
      if (!cur || (el && el.isConnected && cur.el !== el && cur.path !== targetOf(el).path)) return;
      setActive(null);
      // Fin de saisie causée par un geste dans la barre elle-même (champ de la barre) : elle reste ouverte, comme ouverte par « Aa ».
      if (Date.now() - downInBar < 600) return;
      setBar((b) => (b && b.path === cur.path ? null : b));
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t?.closest(".lk-bar, .lk-aa")) return;
      // Sauf dans un champ à saisir, un bouton de la barre ne prend pas le focus : le texte en cours de saisie le garde.
      if (!t.closest("input, textarea, select, [contenteditable=true], [contenteditable=plaintext-only]")) e.preventDefault();
      else downInBar = Date.now();
    };
    window.addEventListener("pe:text-edit", onEdit);
    window.addEventListener("pe:text-end", onEnd);
    // Lot 110 : la roue des couleurs annule `pointerdown` (la souris ne produit alors plus de `mousedown`) : le geste dans la barre se compte aussi ici.
    const onPtr = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest(".lk-bar")) downInBar = Date.now();
    };
    document.addEventListener("pointerdown", onPtr, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPtr, true);
      window.removeEventListener("pe:text-edit", onEdit);
      window.removeEventListener("pe:text-end", onEnd);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, []);

  // Une seule fenêtre à la fois (lot 31e) : la fenêtre « Réglages » d'une grille ferme la barre « Aa ».
  useEffect(() => {
    const closeBar = () => setBar(null);
    window.addEventListener("pe:popups-close", closeBar);
    return () => window.removeEventListener("pe:popups-close", closeBar);
  }, []);

  // Survol : « Aa » sur un texte éditable, « Cadrer » sur une image à cadrer.
  useEffect(() => {
    const inLayer = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest(".pe-layer"));
    const onMove = (e: PointerEvent) => {
      if (inLayer(e.target)) {
        clearTimeout(hideTimer.current);
        return;
      }
      const t = e.target instanceof Element ? e.target.closest<HTMLElement>(TEXT_SEL) : null;
      clearTimeout(hideTimer.current);
      // Logo image (médiathèque ou signature dessinée du kit, lot 84) : ce n'est pas du texte, pas de « Aa ». Sa taille, sa place et sa position
      // se règlent par les poignées de l'en-tête et le panneau « Logo ». Le nom écrit (logo texte) garde son « Aa ».
      const logo = !t && e.target instanceof Element ? e.target.closest<HTMLElement>(".site-header .site-signature, .site-header .site-logo-img") : null;
      if (logo) setHoverText(null);
      else if (t) setHoverText((h) => (h?.el === t && !h.anchor ? h : { el: t, rect: docRect(t) }));
      else hideTimer.current = setTimeout(() => setHoverText(null), 500);
      // Case d'une grille : sa barre (GridLayer) propose « Cadrer ».
      const c = e.target instanceof Element && e.target.closest(".block-grid-cell[data-edit-cell]") ? null : cropTargetAt(e.target);
      setCropHover((prev) => (c ? (prev?.media === c.media ? prev : c) : prev && (e.target as Element)?.closest?.("[data-edit-media], [data-edit-tile]") ? prev : null));
    };
    // Saisie d'un texte : sa barre s'ouvre d'elle-même.
    const onFocus = (e: FocusEvent) => {
      const el = e.target instanceof HTMLElement && e.target.hasAttribute("data-editing") ? e.target : null;
      if (el) {
        const t = targetOf(el);
        setActive(t);
        setBar((b) => (b && b.path === t.path ? b : t));
      }
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("focusin", onFocus);
      clearTimeout(hideTimer.current);
    };
  }, []);

  if (dragging) return null;
  void tick;
  const root = selected && !selected.uid.startsWith("site-") ? rootOf(selected.uid) : null;
  const selLook = selected ? lookOf(selected.uid) : {};
  const selRect = selected ? (wrapperOf(selected.uid) ? rectOfWrapper(selected.uid) : null) : null;
  const hoverValid = hoverText && document.contains(hoverText.el) ? { ...hoverText, rect: docRect(hoverText.anchor ?? hoverText.el) } : null;
  const barEl = bar ? elementOf(bar) : null;
  const activeEl = active ? elementOf(active) : null;
  // « Aa » : sur la barre ouverte, sinon sur le texte en cours de saisie (il ne bouge pas avec la souris), sinon sur le texte survolé.
  const aaView = bar ? (barEl ? { el: barEl, rect: docRect(barEl) } : null) : activeEl ? { el: activeEl, rect: docRect(activeEl) } : hoverValid;
  const cropValid = cropHover && document.contains(cropHover.media) ? cropHover : null;

  return (
    <div className="pe-layer pe-look-layer" lang="fr">
      {root && selected && (
        <>
          <SpacingHandle key={`t-${selected.uid}`} uid={selected.uid} side="top" look={selLook} announce={announce} />
          <SpacingHandle key={`b-${selected.uid}`} uid={selected.uid} side="bottom" look={selLook} announce={announce} />
        </>
      )}
      {selected && selRect && TITLE_TYPES.has(selected.type) && <TitlePosition uid={selected.uid} type={selected.type} inCell={selected.parentType === "grid"} rect={selRect} />}

      {aaView && (
        <button
          type="button"
          className="lk-aa"
          style={bar || active ? { top: Math.max(window.scrollY + 2, aaView.rect.top - 24), left: aaView.rect.left + aaView.rect.width - 30 } : aaPlace((aaView as { anchor?: HTMLElement }).anchor ?? aaView.el, aaView.rect)}
          aria-label="Style du texte"
          aria-expanded={bar ? true : undefined}
          data-pinned={bar || active ? "" : undefined}
          title="Police, taille, couleur… de ce texte"
          onClick={() => (bar ? setBar(null) : setBar(active ?? targetOf(aaView.el)))}
        >
          Aa
        </button>
      )}
      {bar && <TextBar key={bar.path} target={bar} installed={installed} themeNames={themeNames} onClose={() => setBar(null)} tick={tick} />}

      {cropValid && !cropOpen && (() => {
        const r = docRect(cropValid.media.closest("[data-edit-media], [data-edit-tile]") ?? cropValid.media);
        const look = lookOf(cropValid.uid);
        // Fond de l'ouverture : la barre « Changer le fond » occupe déjà le coin bas droit
        // de la partie visible ; « Cadrer » se pose juste à sa gauche, sur la même ligne.
        const bar = !cropValid.tile && cropValid.field === "backgroundMediaId" ? document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Fond de l\'ouverture"]') : null;
        const barBox = bar ? docRect(bar) : null;
        const pos = barBox
          ? { top: barBox.top, left: Math.max(r.left + 8, barBox.left - 112) }
          : { top: r.top + Math.max(8, r.height - 46), left: r.left + Math.max(8, r.width - 120) };
        return (
          <button
            type="button"
            className="lk-crop-btn"
            style={pos}
            onClick={() => setCropOpen(cropValid)}
            title="Choisir la zone gardée de l'image"
          >
            {(cropValid.tile ? look.tileCrop?.[cropValid.tile] : look.crop?.[cropValid.field]) ? "Recadrer" : "Cadrer"}
          </button>
        );
      })()}
      {cropOpen && <CropDialog target={cropOpen} onClose={() => setCropOpen(null)} />}
      <HeroContrast />
    </div>
  );
}

/** Nom réel des polices du thème (affiché dans le menu des polices). */
function readThemeNames(): Partial<Record<"display" | "body" | "caption", string>> {
  const names: Partial<Record<"display" | "body" | "caption", string>> = {};
  if (typeof document === "undefined") return names;
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["display", "body", "caption"] as const) {
    const probe = document.createElement("span");
    probe.style.fontFamily = cs.getPropertyValue(`--t-font-${k}`);
    document.body.appendChild(probe);
    const fam = getComputedStyle(probe).fontFamily.split(",")[0]?.replace(/["']/g, "").replace(/^__|_Fallback.*$|_[0-9a-f]{6,}$/g, "").replace(/_/g, " ").trim();
    probe.remove();
    if (fam) names[k] = fam;
  }
  return names;
}

/** Boîte d'une enveloppe display: contents (réunion de ses enfants). */
function rectOfWrapper(uid: string): Rect | null {
  const el = wrapperOf(uid);
  if (!el) return null;
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const visit = (node: Element) => {
    const r = node.getBoundingClientRect();
    if (r.width || r.height) {
      top = Math.min(top, r.top);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    } else for (const c of node.children) visit(c);
  };
  for (const c of el.children) visit(c);
  if (top === Infinity) return null;
  return { top: top + window.scrollY, left: left + window.scrollX, width: right - left, height: bottom - top };
}
