"use client";

/**
 * Planches sur la toile (éditeur visuel, phase 7b) — partie de la couche
 * d'édition (EditLayer). Repères posés par ProjectStrip en vue brouillon :
 * `data-edit-board` (projet), `data-edit-rail` (bande), `data-edit-slot`
 * (emplacement, `data-empty` : place gardée), `data-slot-inline` /
 * `data-project-inline` (textes), `data-edit-board-new` (planche neuve).
 *
 * - Barre au survol ou au focus d'une image : Remplacer, Supprimer (la place
 *   reste), Retirer la place. Au toucher : un premier toucher la montre.
 * - Glisser une image sur sa bande pour la déplacer ; au clavier : ← → pour
 *   passer d'une image à l'autre, Maj+← → pour la déplacer, Suppr pour retirer
 *   l'image, Maj+Suppr pour retirer la place, Entrée pour la remplacer.
 * - Dépôt d'un média (glissé depuis l'éditeur) ou de fichiers (depuis
 *   l'ordinateur) : curseur d'insertion vertical entre deux images, place vide
 *   en surbrillance, ou planche neuve.
 * - Emplacements fantômes (envoi, conversion, échec) insérés à la position
 *   même, pilotés par l'éditeur.
 * - Planche neuve : nom du projet (Entrée crée le projet), ou projet existant.
 * - Titres, légendes et (projet créé ici) nom, contexte, année : double-clic,
 *   éditeur posé par-dessus le texte (le DOM du site n'est jamais modifié).
 * - Contenu de la planche (lot 31, `data-edit-bitem*` posés par ProjectStrip) : « + Ajouter » entre deux
 *   composants et en bas (menu des composants permis), barre de chaque composant (monter, descendre,
 *   supprimer, réglages), composant choisi d'un clic ; tout passe par des messages à l'éditeur.
 */
import { NATIVE_SCROLL } from "@/components/rail-step";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { acceptToCanvas, EDIT_MSG, type DropTargetInfo, type FromCanvas, type Ghost } from "@/lib/edit/protocol";
import { postIntent, previewBoardText, previewItemText } from "./edit/optimistic";
import { BoardFondMenu } from "./edit/FondMenu";
import FrameWindow from "./edit/FrameMenu";
import QuickMenu, { type QuickKind } from "./edit/QuickMenus";
import { readBackground, type Background } from "@/themes/fond";

import { FrameSchema, ImageBgSchema, RADII, RADIUS_LABELS, type Frame, type ImageBg, type Radius } from "@/lib/look";
import { slotOf } from "@/lib/edit/media-look";
import { BOARD_ITEM_HINTS, BOARD_ITEM_LABELS, BOARD_ITEM_TYPES, MAX_BOARD_ITEMS, isBoardItemType, parseRailKey, railKey, type BoardItemType } from "@/blocks/board-layout";

import ImageBgWindow from "./edit/ImageBgMenu";
import Popover from "./edit/Popover";
import { VIDEO_MODE_HINTS, VIDEO_MODE_LABELS, VIDEO_MODES } from "@/blocks/video-mode";
import { lookOf, sendMediaLook, sendSlotLook } from "./edit/LookLayer";
import ProjectCombobox, { type ComboProject } from "./edit/ProjectCombobox";
import { freeRefOf } from "./edit/free-dom";
import { cellIndex, cellsOf, gridRefOf } from "./edit/grid-dom";
import { useDismiss } from "./edit/useDismiss";

type Rect = { top: number; left: number; width: number; height: number };
type SlotRef = { board: number; key: string; empty: boolean };
type Marker = ({ kind: "item"; rect: Rect } | { kind: "cursor"; rect: Rect } | { kind: "slot"; rect: Rect } | { kind: "new"; rect: Rect } | { kind: "media"; rect: Rect }) & { label?: string };
type MediaRef = { uid: string; field: "mediaId" | "backgroundMediaId" | "portraitMediaId"; kind: string; empty: boolean };
const MEDIA_FIELDS = ["mediaId", "backgroundMediaId", "portraitMediaId"] as const;
const COLLECTIONS = ["characters", "backgrounds", "animation"] as const;

const EDGE = 64;

/** Le bouton de la barre du composant `uid` de la planche `board` qui a ouvert une fenêtre : son ancre (retrouvée à chaque calcul). */
const opAnchor = (op: string, board: number, uid: string) => `[data-edit-bitem-op="${op}"][data-board="${board}"][data-uid="${CSS.escape(uid)}"]`;

function post(msg: FromCanvas) {
  window.parent.postMessage({ type: EDIT_MSG, ...msg }, window.location.origin);
}

/** Boîte (fenêtre) d'un élément ; en display: contents, réunion de celles de ses enfants, récursivement (enveloppe de carte comprise). */
function viewBox(el: Element): { top: number; left: number; right: number; bottom: number } | null {
  const r = el.getBoundingClientRect();
  if (r.width || r.height) return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
  let out: { top: number; left: number; right: number; bottom: number } | null = null;
  for (const c of el.children) {
    const b = viewBox(c);
    if (!b) continue;
    out = out ? { top: Math.min(out.top, b.top), left: Math.min(out.left, b.left), right: Math.max(out.right, b.right), bottom: Math.max(out.bottom, b.bottom) } : b;
  }
  return out;
}

/** Boîte d'un élément en coordonnées du document (réunion des enfants s'il est en display: contents). */
function boxOf(el: Element): Rect | null {
  const r = viewBox(el);
  if (!r) return null;
  return { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.right - r.left, height: r.bottom - r.top };
}

/** Bande qui reçoit un glisser au point (fenêtre) : celle sous le pointeur (images du projet ou carrousel), sinon la bande des images du projet de la planche. */
const railUnder = (el: Element | undefined): HTMLElement | null => el?.closest<HTMLElement>("[data-edit-rail]") ?? el?.closest("[data-edit-board]")?.querySelector<HTMLElement>('[data-edit-rail=""]') ?? null;
/** Bande d'une planche : celle du composant `uid` (carrousel à liste propre), ou celle des images du projet. */
const railOf = (board: number, uid?: string) => document.querySelector<HTMLElement>(`[data-edit-board="${board}"] [data-edit-rail="${uid ? CSS.escape(uid) : ""}"]`);
const slotEls = (rail: Element) => [...rail.querySelectorAll<HTMLElement>(":scope > [data-edit-slot]")];
const boardEl = (board: number) => document.querySelector<HTMLElement>(`[data-edit-board="${board}"]`);
/** Ce que la palette peut déposer dans une planche (lot 31b) : mêmes composants que le menu « + Ajouter ». */
const BOARD_DROP = ["grid", "image", "video-single", "free-board", "rich-text", "board-strip"];

const itemFrames = (board: Element) => [...board.querySelectorAll<HTMLElement>("[data-edit-bitem]")];

/** Rang d'insertion parmi les composants d'une planche selon y (fenêtre) : nombre de composants dont le milieu est au-dessus. */
function itemIndexAt(frames: HTMLElement[], y: number): number {
  let n = 0;
  for (const f of frames) {
    const b = viewBox(f);
    if (b && (b.top + b.bottom) / 2 < y) n++;
  }
  return n;
}

/** Trait de dépôt avant le composant n° `index` (ou sous le dernier), en coordonnées du document. */
function itemLine(board: Element, frames: HTMLElement[], index: number): Rect | null {
  const host = board.querySelector("[data-edit-bitems]");
  const hb = host ? boxOf(host) : null;
  if (!hb) return null;
  const at = index < frames.length ? boxOf(frames[index]) : frames.length ? boxOf(frames[frames.length - 1]) : null;
  const top = at ? (index < frames.length ? at.top : at.top + at.height) : hb.top;
  return { top, left: hb.left, width: hb.width, height: 0 };
}

/** Planche sous le point (fenêtre) qui reçoit un composant de la palette de ce type, avec son rang d'insertion. */
function paletteDropAt(x: number, y: number, type: string | undefined): { board: number; index: number; rect: Rect } | null {
  if (!type || !BOARD_DROP.includes(type)) return null;
  const el = document.elementsFromPoint(x, y).find((e) => !e.closest(".pe-layer"));
  const board = el?.closest<HTMLElement>("[data-edit-board]");
  if (!board || !board.querySelector("[data-edit-bitems]")) return null;
  const frames = itemFrames(board);
  const index = itemIndexAt(frames, y);
  const rect = itemLine(board, frames, index);
  const id = Number(board.dataset.editBoard);
  return rect && id ? { board: id, index, rect } : null;
}

const boardOf = (el: Element | null) => el?.closest<HTMLElement>("[data-edit-board]") ?? null;
const slotRefOf = (el: HTMLElement): SlotRef | null => {
  const board = Number(boardOf(el)?.dataset.editBoard);
  const key = el.dataset.editSlot;
  return board && key ? { board, key, empty: el.hasAttribute("data-empty") } : null;
};
const findSlot = (ref: { board: number; key: string }) =>
  document.querySelector<HTMLElement>(`[data-edit-board="${ref.board}"] [data-edit-slot="${CSS.escape(ref.key)}"]`);

/**
 * Rang dans la planche ENTIÈRE de l'emplacement visible n° `i` de la bande
 * (une planche filtrée par métier n'en montre qu'une partie : `data-slot-pos`).
 */
export function fullIndex(els: HTMLElement[], i: number): number {
  const pos = (el: HTMLElement | undefined) => (el?.dataset.slotPos !== undefined && el.dataset.slotPos !== "" ? Number(el.dataset.slotPos) : null);
  if (i < els.length) return pos(els[i]) ?? i;
  const last = pos(els[els.length - 1]);
  return last !== null ? last + 1 : els.length;
}

/** Position d'insertion dans une bande selon x (fenêtre) : nombre d'images dont le milieu est à gauche. */
function railIndex(rail: Element, x: number): { index: number; visible: number; rect: Rect } {
  const els = slotEls(rail);
  let index = 0;
  for (const el of els) {
    const b = el.getBoundingClientRect().width ? el.getBoundingClientRect() : (el.firstElementChild?.getBoundingClientRect() ?? el.getBoundingClientRect());
    if (b.left + b.width / 2 < x) index++;
  }
  const visible = index;
  const railBox = rail.getBoundingClientRect();
  let cx: number;
  if (!els.length) cx = railBox.left + 24;
  else if (index === 0) cx = (boxOf(els[0])?.left ?? railBox.left) - window.scrollX - 6;
  else {
    const prev = boxOf(els[index - 1]);
    const next = index < els.length ? boxOf(els[index]) : null;
    cx = next && prev ? (prev.left + prev.width + next.left) / 2 - window.scrollX : (prev ? prev.left + prev.width - window.scrollX + 6 : railBox.left);
  }
  const first = els[0] ? els[0].querySelector(".strip-media, .pe-empty-box") ?? els[0] : null;
  const media = first?.getBoundingClientRect();
  const top = media?.height ? media.top : railBox.top;
  const height = media?.height ? media.height : Math.max(120, railBox.height);
  return { index: fullIndex(els, visible), visible, rect: { top: top + window.scrollY, left: cx + window.scrollX - 2, width: 4, height } };
}

/** Bloc média sous un élément (image, vidéo, fond de l'ouverture, portrait). */
function mediaRefOf(el: Element | null): { ref: MediaRef; el: HTMLElement } | null {
  const host = el?.closest<HTMLElement>("[data-edit-media]");
  const field = host?.dataset.editMedia as MediaRef["field"] | undefined;
  // Case d'une grille : sa barre (GridLayer) remplace celle-ci.
  if (host?.closest(".block-grid-cell[data-edit-cell]")) return null;
  const uid = host?.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock;
  if (!host || !uid || !field || !MEDIA_FIELDS.includes(field)) return null;
  // L'ouverture : seulement quand on vise son décor, pas un texte ou un bouton posé dessus.
  return { ref: { uid, field, kind: host.dataset.editMediaKind ?? "image", empty: host.classList.contains("pe-media-empty") || Boolean(host.querySelector(".pe-media-empty")) }, el: host };
}

/** Cible de dépôt sous le point (fenêtre). */
function dropTargetAt(x: number, y: number, items = false): { target: DropTargetInfo; marker: Marker } | null {
  // Sous le point : la page (le calque d'édition est ignoré, sauf le panneau d'une planche neuve).
  const el = document.elementsFromPoint(x, y).find((e) => !e.closest(".pe-layer") || e.closest("[data-new-board-uid]"));
  if (!el) return null;
  const newPanel = el.closest<HTMLElement>("[data-new-board-uid]");
  if (newPanel?.dataset.newBoardUid) {
    const box = boxOf(newPanel);
    return box ? { target: { kind: "new", uid: newPanel.dataset.newBoardUid }, marker: { kind: "new", rect: box } } : null;
  }
  // Planche libre (lot 42, page ou planche) : le média est posé là même (le point visé devient le centre de l'image).
  const free = el.closest<HTMLElement>("[data-edit-free]");
  const fref = free ? freeRefOf(free) : null;
  if (free && fref) {
    const zr = free.getBoundingClientRect();
    const box = boxOf(free);
    if (box && zr.width > 0 && zr.height > 0) {
      const fx = Math.round(Math.min(100, Math.max(0, ((x - zr.left) / zr.width) * 100)) * 100) / 100;
      const fy = Math.round(Math.min(100, Math.max(0, ((y - zr.top) / zr.height) * 100)) * 100) / 100;
      return { target: { kind: "free", uid: fref.uid, ...(fref.board ? { board: fref.board, ...(fref.props ? { props: fref.props } : {}) } : {}), x: fx, y: fy }, marker: { kind: "media", rect: box, label: "Pose l'image ici" } };
    }
  }
  // Case d'une grille (page ou planche, lot 31d) : le média remplace l'image de cette case ; sur une place libre, il se range à la
  // suite des images (une grille se remplit dans l'ordre) : la case qui le recevra est surlignée avec son numéro.
  const gcell = el.closest<HTMLElement>(".block-grid-cell[data-cell-index]");
  const gref = gcell ? gridRefOf(gcell) : null;
  if (gcell && gref && gcell.parentElement === gref.grid) {
    const cells = cellsOf(gref.grid);
    const filled = cells.filter((c) => c.hasAttribute("data-edit-cell")).length;
    const at = Math.min(cellIndex(gcell), filled);
    const targetEl = cells.find((c) => cellIndex(c) === at) ?? gcell;
    const box = boxOf(targetEl);
    if (box) return { target: { kind: "gcell", uid: gref.uid, ...(gref.board ? { board: gref.board, ...(gref.props ? { props: gref.props } : {}) } : {}), index: at }, marker: { kind: "media", rect: box, label: at < filled ? `Remplace l'image de la case ${at + 1}` : `Case ${at + 1}` } };
  }
  // Place libre d'une grille : un composant y est créé avec le média.
  const cell = el.closest<HTMLElement>("[data-edit-cell-free]");
  const gridUid = cell?.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock;
  if (cell && gridUid) {
    const box = boxOf(cell);
    return box ? { target: { kind: "cell", uid: gridUid }, marker: { kind: "media", rect: box } } : null;
  }
  // Lot 31f : un carrousel se traite comme la bande du projet : une place vide reçoit le média, sinon il se range à la position visée.
  const emptyPlace = el.closest<HTMLElement>("[data-edit-slot][data-empty]");
  if (emptyPlace) {
    const ref = slotRefOf(emptyPlace);
    const box = boxOf(emptyPlace.querySelector(".pe-empty-box") ?? emptyPlace);
    if (ref && box) return { target: { kind: "slot", board: ref.board, key: ref.key }, marker: { kind: "slot", rect: box } };
  }
  const ownFrame = items ? el.closest<HTMLElement>("[data-edit-bitem-rail]:not([data-edit-bitem-project])") : null;
  const ownRail = el.closest<HTMLElement>("[data-edit-rail]:not([data-edit-rail=\"\"])") ?? ownFrame?.querySelector<HTMLElement>("[data-edit-rail]") ?? null;
  if (ownRail?.dataset.editRail) {
    const board = Number(boardOf(ownRail)?.dataset.editBoard);
    if (board) {
      const { index, rect } = railIndex(ownRail, x);
      return { target: { kind: "rail", board, uid: ownRail.dataset.editRail, index }, marker: { kind: "cursor", rect } };
    }
  }
  // Carrousel encore sans image (cadre « rien à montrer », pas de bande) : le média s'ajoute à sa liste.
  if (ownFrame && !ownRail) {
    const board = Number(ownFrame.dataset.board);
    const uid = ownFrame.dataset.editBitem;
    const box = boxOf(ownFrame);
    if (board && uid && box) return { target: { kind: "bitem", board, uid }, marker: { kind: "media", rect: box } };
  }
  // Lot 31b : un composant de la planche (autre qu'une bande d'images) reçoit un média de la médiathèque :
  // une Image / une Vidéo le remplace, une Grille l'ajoute.
  const frame = items ? el.closest<HTMLElement>("[data-edit-bitem]:not([data-edit-bitem-rail])") : null;
  if (frame) {
    const board = Number(frame.dataset.board);
    const uid = frame.dataset.editBitem;
    const box = boxOf(frame);
    if (board && uid && box && frame.dataset.editBitemType !== "rich-text") return { target: { kind: "bitem", board, uid }, marker: { kind: "media", rect: box } };
  }
  const media = mediaRefOf(el);
  if (media && !el.closest("[data-edit-board]")) {
    const box = boxOf(media.el);
    return box ? { target: { kind: "media", uid: media.ref.uid, field: media.ref.field }, marker: { kind: "media", rect: box } } : null;
  }
  const empty = el.closest<HTMLElement>("[data-edit-slot][data-empty]");
  if (empty) {
    const ref = slotRefOf(empty);
    const box = boxOf(empty.querySelector(".pe-empty-box") ?? empty);
    if (ref && box) return { target: { kind: "slot", board: ref.board, key: ref.key }, marker: { kind: "slot", rect: box } };
  }
  const board = boardOf(el);
  const rail = board?.querySelector('[data-edit-rail=""]');
  if (board && rail) {
    const { index, rect } = railIndex(rail, x);
    const c = board.dataset.editBoardCollection as (typeof COLLECTIONS)[number] | undefined;
    return { target: { kind: "board", board: Number(board.dataset.editBoard), index, ...(c && COLLECTIONS.includes(c) ? { collection: c } : {}) }, marker: { kind: "cursor", rect } };
  }
  return null;
}

/**
 * Défilement des bandes et de la page près des bords pendant un glisser. Une
 * bande ne défile qu'après un court arrêt près de son bord (pas en passant).
 */
let edgeSince = 0;
function autoScroll(x: number, y: number) {
  const el = document.elementsFromPoint(x, y).find((e) => !e.closest(".pe-layer"));
  const rail = railUnder(el);
  if (rail) {
    const b = rail.getBoundingClientRect();
    const dir = x < b.left + EDGE ? -1 : x > b.right - EDGE ? 1 : 0;
    if (!dir) edgeSince = 0;
    else if (!edgeSince) edgeSince = Date.now();
    else if (Date.now() - edgeSince > 400) rail.scrollBy({ left: dir * 18 });
  }
  if (y < EDGE) window.scrollBy(0, -14);
  else if (y > window.innerHeight - EDGE) window.scrollBy(0, 14);
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

type TextEdit = { el: HTMLElement; kind: "slot" | "project" | "item"; board: number; key?: string; field: string; original: string; value: string; rect: Rect; style: React.CSSProperties };

export default function BoardLayer({
  mode,
  host,
  announce,
  pickerFor,
  onPickerClose,
}: {
  mode: "off" | "edit" | "preview";
  host: HTMLElement | null;
  announce: (text: string) => void;
  /** Conteneur dont on change le projet (barre de la toile), ou null. */
  pickerFor: string | null;
  onPickerClose: () => void;
}) {
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<SlotRef | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SlotRef | null>(null);
  /** Image dont la fenêtre « Cadre » (lot 34) est ouverte : la barre de cette image reste affichée tant qu'elle l'est. */
  const [frameSlot, setFrameSlot] = useState<SlotRef | null>(null);
  /** Image dont la fenêtre « Fond de l'image » (lot 41) est ouverte : même principe que « Cadre ». */
  const [bgSlot, setBgSlot] = useState<SlotRef | null>(null);
  const [focusSlot, setFocusSlot] = useState<SlotRef | null>(null);
  const [marker, setMarker] = useState<Marker | null>(null);
  // Un glisser est en cours (média, fichiers, image) : pas de barre d'image.
  const [dragActive, setDragActive] = useState(false);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [projects, setProjects] = useState<ComboProject[]>([]);
  const [text, setText] = useState<TextEdit | null>(null);
  // Le champ de saisie reste collé à SA ligne : la mise en page peut bouger après le clic (barres, légendes qui se rangent, images qui
  // se chargent) ; la position mesurée au clic ne suffit pas (lot 65 : champ du Titre d'une place de carrousel 18 px trop bas).
  const textEl = text?.el ?? null;
  useEffect(() => {
    if (!textEl) return;
    let raf = 0;
    const sync = () => {
      raf = requestAnimationFrame(sync);
      const r = textEl.isConnected ? boxOf(textEl) : null;
      if (!r) return;
      setText((t) => {
        if (!t || t.el !== textEl) return t;
        const w = Math.max(r.width, 160);
        if (Math.abs(t.rect.top - r.top) < 0.5 && Math.abs(t.rect.left - r.left) < 0.5 && Math.abs(t.rect.width - w) < 0.5 && Math.abs(t.rect.height - r.height) < 0.5) return t;
        return { ...t, rect: { ...r, width: w } };
      });
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [textEl]);
  // Contenu de la planche (lot 31) : menu « + Ajouter » ouvert, composant choisi.
  const [addMenu, setAddMenu] = useState<{ board: number; index: number; hasStrip: boolean; count: number } | null>(null);
  const [itemSel, setItemSel] = useState<{ board: number; uid: string } | null>(null);
  // Lot 34 : fenêtre « Cadre » de la barre d'un composant Image (même principe que « Fond »).
  const [frameMenu, setFrameMenu] = useState<{ board: number; uid: string; frame: Frame | undefined; what: "photo" | "vidéo" } | null>(null);
  // Lot 41 : fenêtre « Fond de l'image » de la barre d'un composant Image.
  const [bgMenu, setBgMenu] = useState<{ board: number; uid: string; bg: string | undefined } | null>(null);
  const bgMenuRef = useRef(bgMenu);
  useEffect(() => {
    bgMenuRef.current = bgMenu;
  }, [bgMenu]);
  // Lot 32 : fenêtre « Fond » de la barre d'un composant (position dans la page, fond courant lu sur la barre).
  /** Fenêtre « Taille » (image) ou « Espace » (au-dessus) d'un composant de la planche (lot 40) ; les réglages passent par `sendLook`. */
  const [quickMenu, setQuickMenu] = useState<{ board: number; uid: string; kind: QuickKind } | null>(null);
  const [fondMenu, setFondMenu] = useState<{ board: number; uid: string; background: Background | null } | null>(null);
  // Texte (ou image) d'un projet survolé : indicateur « modifié aussi sur sa planche et sa page ».
  const [projectHint, setProjectHint] = useState<{ el: HTMLElement; board: number; label: string; draft: boolean; textHeld: string | null; slotHeld?: boolean } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hoverMedia, setHoverMedia] = useState<MediaRef | null>(null);
  const ghostsRef = useRef<Ghost[]>([]);
  const lastItemDrop = useRef("");
  const pendingFocus = useRef<string | null>(null);
  const textRef = useRef<TextEdit | null>(null);
  // « Ajouter des images » : champ fichier de la couche, et planche visée.
  const addInput = useRef<HTMLInputElement>(null);
  const addBoard = useRef<number | null>(null);
  /** Carrousel qui reçoit les fichiers choisis (absent : la bande des images du projet). */
  const addRail = useRef<string | undefined>(undefined);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  const edit = mode === "edit";

  /* ---- Messages de l'éditeur (planches) ----------------------------------- */

  useEffect(() => {
    if (window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      const msg = acceptToCanvas(event, window.location.origin, window.parent);
      if (!msg) return;
      if (msg.kind === "select" && msg.uid) setItemSel(null);
      // Clic sur une carte de la palette : le composant s'ajoute à la fin de la planche de la rubrique choisie.
      if (msg.kind === "board-add") {
        const wrapper = document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(msg.uid)}"]`);
        const board = wrapper?.querySelector<HTMLElement>("[data-edit-board]");
        const id = Number(board?.dataset.editBoard);
        if (board && id) post({ kind: "bitem-add", board: id, item: msg.item, index: itemFrames(board).length });
        else announce("Ce bloc n'a pas de projet où ajouter un bloc.");
        return;
      }
      if (msg.kind === "ghosts") {
        ghostsRef.current = msg.items;
        setGhosts(msg.items);
      } else if (msg.kind === "projects") setProjects(msg.list);
      else if (msg.kind === "focus-slot") pendingFocus.current = msg.key;
      else if (msg.kind === "drag" && msg.payload === "media") {
        if (!document.documentElement.hasAttribute("data-edit-dragging")) {
          document.documentElement.setAttribute("data-edit-dragging", "");
          try {
            window.getSelection()?.removeAllRanges();
          } catch {}
        }
        setDragActive(true);
        const hit = dropTargetAt(msg.x, msg.y, true);
        setMarker(hit?.marker ?? null);
        post({ kind: "drop-target", target: hit?.target ?? null });
        autoScroll(msg.x, msg.y);
      } else if (msg.kind === "drag" && msg.blockType) {
        // Composant glissé depuis « Ajouter » : au-dessus d'une planche, il se pose entre ses composants (même repère que la page).
        const hit = paletteDropAt(msg.x, msg.y, msg.blockType);
        document.documentElement.toggleAttribute("data-board-drop", Boolean(hit));
        setMarker(hit ? { kind: "item", rect: hit.rect } : null);
        const sig = hit ? `${hit.board}:${hit.index}` : "";
        if (sig !== lastItemDrop.current) {
          lastItemDrop.current = sig;
          post({ kind: "bitem-drop", board: hit?.board ?? null, index: hit?.index ?? 0 });
        }
      } else if (msg.kind === "drag-end") {
        document.documentElement.removeAttribute("data-board-drop");
        lastItemDrop.current = "";
        document.documentElement.removeAttribute("data-edit-dragging");
        setMarker(null);
        setDragActive(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /* ---- Mesures : rafraîchissement, défilement des bandes, fantômes ------- */

  const reconcileGhosts = useCallback(() => {
    const items = ghostsRef.current;
    const live = new Set<string>();
    for (const g of items) {
      // Emplacement créé et rendu : le fantôme s'efface.
      if (g.phase === "done" && g.key && findSlot({ board: g.board, key: g.key })) continue;
      if (g.slot || g.index === undefined) continue;
      const rail = railOf(g.board, g.rail);
      if (!rail) continue;
      live.add(g.id);
      let node = rail.querySelector<HTMLElement>(`:scope > [data-ghost="${CSS.escape(g.id)}"]`);
      let fresh = false;
      if (!node) {
        node = document.createElement("div");
        node.dataset.ghost = g.id;
        node.className = "strip-frame pe-ghost-slot";
        node.setAttribute("role", "status");
        fresh = true;
      }
      // Avant le n-ième emplacement réel (les fantômes d'un même dépôt se suivent).
      const els = slotEls(rail);
      const before = els.find((el, i) => fullIndex(els, i) >= g.index!) ?? null;
      const siblings = items.filter((x) => x.board === g.board && x.rail === g.rail && x.index === g.index && !x.slot && x.phase !== "done");
      const after = siblings.slice(siblings.indexOf(g) + 1).map((x) => rail.querySelector(`:scope > [data-ghost="${CSS.escape(x.id)}"]`)).find(Boolean) ?? null;
      const anchor = (after as Element | null) ?? before;
      if (node.parentElement !== rail || node.nextElementSibling !== anchor) rail.insertBefore(node, anchor);
      // Un fantôme neuf est amené à l'écran (dans sa bande).
      if (fresh) node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      const pct = g.progress === null ? null : Math.round(g.progress * 100);
      const state =
        g.phase === "failed" ? `Échec${g.message ? ` : ${g.message}` : ""}` : g.phase === "convert" ? `Conversion…${pct !== null ? ` ${pct} %` : ""}` : g.phase === "done" ? "Placée" : `Envoi ${pct ?? 0} %`;
      // Contenu construit par l'API DOM (jamais de HTML assemblé), refait seulement s'il change.
      const sig = JSON.stringify([g.preview, g.aspect, state, pct, g.phase, g.label]);
      if (node.dataset.sig !== sig) {
        node.dataset.sig = sig;
        node.replaceChildren(ghostContent(g, state, pct));
      }
      node.dataset.phase = g.phase;
      node.setAttribute("aria-label", `${g.label} : ${state}`);
    }
    for (const node of document.querySelectorAll<HTMLElement>("[data-ghost]")) if (!live.has(node.dataset.ghost ?? "")) node.remove();
  }, []);

  useEffect(() => {
    reconcileGhosts();
  }, [ghosts, reconcileGhosts]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        reconcileGhosts();
        if (pendingFocus.current) {
          const el = document.querySelector<HTMLElement>(`[data-edit-slot="${CSS.escape(pendingFocus.current)}"]`);
          if (el) {
            pendingFocus.current = null;
            el.focus({ preventScroll: false });
          }
        }
        setTick((n) => n + 1);
      });
    };
    const mutations = new MutationObserver((records) => {
      // Les fantômes eux-mêmes ne relancent pas la boucle.
      if (records.every((r) => [...r.addedNodes, ...r.removedNodes].every((n) => n instanceof HTMLElement && n.dataset.ghost !== undefined) && r.addedNodes.length + r.removedNodes.length > 0)) return;
      schedule();
    });
    mutations.observe(document.getElementById("contenu") ?? document.body, { childList: true, subtree: true, characterData: true });
    const onScroll = () => schedule();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [reconcileGhosts]);

  /* ---- Texte en place (titres, légendes, projet créé ici) ----------------- */

  const startText = useCallback((el: HTMLElement) => {
    const board = Number(boardOf(el)?.dataset.editBoard);
    if (!board) return;
    // Texte d'un composant de la planche (lot 31c, un Texte) : modifié en place comme un texte de page.
    // (lot 39 : aussi un texte posé sous une image d'« Images qui défilent », `captions.<place>.<champ>`).
    const itemFrame = el.dataset.inline ? el.closest<HTMLElement>("[data-edit-bitem]") : null;
    if (itemFrame?.dataset.editBitem) {
      const rect = boxOf(el);
      if (!rect) return;
      const cs = getComputedStyle(el);
      el.style.visibility = "hidden";
      const original = el.textContent ?? "";
      setText({
        el,
        kind: "item",
        board,
        key: itemFrame.dataset.editBitem,
        field: el.dataset.inline ?? "",
        original,
        value: original,
        rect: { ...rect, width: Math.max(rect.width, 160) },
        style: { font: cs.font, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform as React.CSSProperties["textTransform"], lineHeight: cs.lineHeight, textAlign: cs.textAlign as React.CSSProperties["textAlign"] },
      });
      return;
    }
    // Textes du projet en cours de modification sur une autre page : un seul brouillon à la fois.
    const heldBy = el.dataset.projectInline ? boardOf(el)?.dataset.editBoardTextHeld : undefined;
    if (heldBy) {
      announce(`Les textes de ce projet sont en cours de modification sur la page « ${heldBy} » : publie-la ou abandonne-la d'abord.`);
      return;
    }
    // Légendes d'une planche dont les images sont tenues par une autre page : l'écriture serait refusée.
    const imagesHeldBy = el.dataset.slotInline ? boardOf(el)?.dataset.editBoardHeld : undefined;
    if (imagesHeldBy) {
      announce(`Ce projet est en cours de modification sur la page « ${imagesHeldBy} » : publie-le ou abandonne-le d'abord.`);
      return;
    }
    const slotEl = el.closest<HTMLElement>("[data-edit-slot]");
    const kind = el.dataset.slotInline ? "slot" : "project";
    const field = (el.dataset.slotInline ?? el.dataset.projectInline) as string;
    const rect = boxOf(el);
    if (!rect) return;
    const cs = getComputedStyle(el);
    const style: React.CSSProperties = {
      font: cs.font,
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform as React.CSSProperties["textTransform"],
      lineHeight: cs.lineHeight,
      textAlign: cs.textAlign as React.CSSProperties["textAlign"],
    };
    el.style.visibility = "hidden";
    const original = el.textContent ?? "";
    setText({ el, kind, board, key: slotEl?.dataset.editSlot, field, original, value: original, rect: { ...rect, width: Math.max(rect.width, 160) }, style });
  }, [announce]);

  const finishText = useCallback((commit: boolean, value?: string) => {
    const t = textRef.current;
    if (!t) return;
    const next = (value ?? t.value).replace(/\s*\n\s*/g, " ");
    if (!commit || next === t.original) {
      t.el.style.visibility = "";
      setText(null);
      return;
    }
    const locale = document.documentElement.lang === "en" ? "en" : "fr";
    // Le texte posé reste affiché (edit/optimistic.ts) jusqu'à ce que le serveur le rende :
    // aucun retour à l'ancienne valeur, y compris dans les autres blocs qui citent ce projet.
    if (t.kind === "item" && t.key) {
      const value = next.slice(0, 2000);
      const seq = postIntent({ kind: "bitem-text", board: t.board, uid: t.key, path: t.field, locale, value });
      previewItemText(t.key, t.field, value, seq);
    } else if (t.kind === "slot" && t.key) {
      const value = next.slice(0, 2000);
      const seq = postIntent({ kind: "slot-text", board: t.board, key: t.key, field: t.field as "title" | "description", locale, value });
      previewBoardText({ board: t.board, field: t.field, key: t.key }, value, seq);
    } else {
      const value = next.slice(0, t.field === "description" ? 2000 : 200);
      const seq = postIntent({ kind: "project-text", board: t.board, field: t.field as "title" | "context" | "description" | "year", locale, value });
      previewBoardText({ board: t.board, field: t.field }, value, seq);
    }
    t.el.style.visibility = "";
    setText(null);
  }, []);

  /* ---- Pointeur, clavier, fichiers --------------------------------------- */

  useEffect(() => {
    if (!edit) return;
    const inLayer = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest(".pe-layer"));
    let pressed: { el: HTMLElement; ref: SlotRef; x: number; y: number; id: number } | null = null;
    let dragging: { ref: SlotRef; rail: Element; index: number } | null = null;

    const onMove = (e: PointerEvent) => {
      if (itemDrag) {
        if (!itemDrag.active && Math.hypot(e.clientX - itemDrag.x, e.clientY - itemDrag.y) > 6) {
          itemDrag.active = true;
          document.documentElement.setAttribute("data-edit-dragging", "");
          try {
            window.getSelection()?.removeAllRanges();
          } catch {}
        }
        if (itemDrag.active) {
          const board = boardEl(itemDrag.board);
          if (board) {
            const frames = itemFrames(board);
            itemDrag.index = itemIndexAt(frames, e.clientY);
            const rect = itemLine(board, frames, itemDrag.index);
            setMarker(rect ? { kind: "item", rect } : null);
          }
          autoScroll(e.clientX, e.clientY);
        }
        return;
      }
      if (inLayer(e.target)) {
        // Sur l'indicateur lui-même : il reste (le lien « Voir le projet » est cliquable).
        if (e.target instanceof Element && e.target.closest(".pe-project-hint")) clearTimeout(hintTimer.current);
        return;
      }
      let field = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-project-inline]") : null;
      // Légende d'une planche tenue par une autre page : indication « lecture seule » (sinon aucune).
      const slotField = !field && e.target instanceof Element ? e.target.closest<HTMLElement>("[data-slot-inline]") : null;
      if (slotField && boardOf(slotField)?.dataset.editBoardHeld) field = slotField;
      const owner = field ? boardOf(field) : null;
      clearTimeout(hintTimer.current);
      if (field && owner) {
        setProjectHint((h) =>
          h?.el === field
            ? h
            : {
                el: field,
                board: Number(owner.dataset.editBoard),
                label: owner.dataset.editBoardLabel ?? "",
                draft: owner.hasAttribute("data-edit-board-draft"),
                textHeld: field.dataset.slotInline ? (owner.dataset.editBoardHeld ?? null) : (owner.dataset.editBoardTextHeld ?? null),
                ...(field.dataset.slotInline ? { slotHeld: true } : {}),
              },
        );
      } else {
        hintTimer.current = setTimeout(() => setProjectHint(null), 700);
      }
      if (pressed && !dragging && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 6) {
        const rail = pressed.el.closest("[data-edit-rail]");
        if (rail) {
          dragging = { ref: pressed.ref, rail, index: 0 };
          try {
            window.getSelection()?.removeAllRanges();
          } catch {}
          document.documentElement.setAttribute("data-edit-dragging", "");
          pressed.el.setAttribute("data-slot-dragging", "");
        }
      }
      if (dragging) {
        const { index, rect } = railIndex(dragging.rail, e.clientX);
        dragging.index = index;
        setMarker({ kind: "cursor", rect });
        autoScroll(e.clientX, e.clientY);
        return;
      }
      if (e.pointerType === "touch") return;
      const slot = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-edit-slot]") : null;
      setHover(slot ? slotRefOf(slot) : null);
      const media = e.target instanceof Element && !slot ? mediaRefOf(e.target) : null;
      setHoverMedia((h) => (media ? (h && h.uid === media.ref.uid && h.field === media.ref.field && h.empty === media.ref.empty ? h : media.ref) : null));
    };
    // Réordonner les composants de la planche : glisser la poignée de leur barre (lot 31b).
    let itemDrag: { board: number; uid: string; from: number; index: number; x: number; y: number; active: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      const handle = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-edit-bitem-handle]") : null;
      if (handle && e.button === 0) {
        const board = Number(handle.dataset.board);
        const uid = handle.dataset.editBitemHandle ?? "";
        const frames = itemFrames(boardEl(board) ?? document.body);
        const from = frames.findIndex((f) => f.dataset.editBitem === uid);
        if (board && uid && from >= 0) {
          e.preventDefault();
          itemDrag = { board, uid, from, index: from, x: e.clientX, y: e.clientY, active: false };
        }
        return;
      }
      if (e.button !== 0 || inLayer(e.target) || isTyping(e.target)) return;
      const slot = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-edit-slot]") : null;
      const ref = slot && slotRefOf(slot);
      if (!slot || !ref || e.pointerType === "touch") return;
      pressed = { el: slot, ref, x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    const onUp = () => {
      if (itemDrag) {
        const d = itemDrag;
        itemDrag = null;
        if (d.active) {
          document.documentElement.removeAttribute("data-edit-dragging");
          setMarker(null);
          // Même place (avant ou après lui-même) : rien à faire.
          if (d.index !== d.from && d.index !== d.from + 1) {
            post({ kind: "bitem-to", board: d.board, uid: d.uid, index: d.index });
            announce("Bloc déplacé.");
          }
          // Le clic qui suit un glisser ne sélectionne rien.
          const swallow = (ev: MouseEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
          };
          document.addEventListener("click", swallow, { capture: true, once: true });
          setTimeout(() => document.removeEventListener("click", swallow, { capture: true }), 0);
        }
        return;
      }
      if (dragging) {
        const { ref, index } = dragging;
        const els = slotEls(dragging.rail);
        const vis = els.findIndex((el) => el.dataset.editSlot === ref.key);
        const from = vis >= 0 ? fullIndex(els, vis) : -1;
        if (from >= 0 && index !== from && index !== from + 1) post({ kind: "slot-move", board: ref.board, key: ref.key, index });
        pressed?.el.removeAttribute("data-slot-dragging");
        document.documentElement.removeAttribute("data-edit-dragging");
        setMarker(null);
        // Le clic qui suit un glisser ne sélectionne rien.
        const swallow = (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        document.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => document.removeEventListener("click", swallow, { capture: true }), 0);
      }
      pressed = null;
      dragging = null;
    };
    const onClick = (e: MouseEvent) => {
      if (inLayer(e.target)) return;
      // Flèches et barre de défilement de la bande : le clic leur appartient (la sélection de l'image ne bouge pas).
      if (e.target instanceof Element && e.target.closest(NATIVE_SCROLL)) return;
      // Contenu de la planche (lot 31).
      const hit = e.target instanceof Element ? e.target : null;
      const itemAdd = hit?.closest<HTMLElement>("[data-edit-bitem-add]");
      const itemOp = hit?.closest<HTMLElement>("[data-edit-bitem-op]");
      const itemFrame = hit?.closest<HTMLElement>("[data-edit-bitem]");
      if (itemAdd) {
        e.preventDefault();
        e.stopPropagation();
        const board = Number(itemAdd.dataset.board);
        const frames = [...(boardEl(board)?.querySelectorAll<HTMLElement>("[data-edit-bitem]") ?? [])];
        setAddMenu({
          board,
          index: Number(itemAdd.dataset.editBitemAdd),
          hasStrip: frames.some((f) => f.hasAttribute("data-edit-bitem-project")),
          count: frames.length,
        });
        return;
      }
      if (itemOp) {
        e.preventDefault();
        e.stopPropagation();
        const board = Number(itemOp.dataset.board);
        const uid = itemOp.dataset.uid ?? "";
        const op = itemOp.dataset.editBitemOp;
        if (!board || !uid) return;
        if (op === "video-loop" || op === "video-player") {
          const frame = itemOp.closest<HTMLElement>("[data-edit-bitem]");
          const kind = frame?.dataset.editBitemType;
          if (isBoardItemType(kind)) post({ kind: "video-mode", board, uid, item: kind, ...(frame?.dataset.editBitemProps ? { props: frame.dataset.editBitemProps.slice(0, 100_000) } : {}), mode: op === "video-loop" ? "loop" : "player" });
        } else if (op === "frame") {
          const frame = itemOp.closest<HTMLElement>("[data-edit-bitem]");
          let current: Frame | undefined;
          try {
            const raw = (JSON.parse(frame?.dataset.editBitemProps ?? "{}") as { props?: { look?: { frame?: unknown } } }).props?.look?.frame;
            const parsed = FrameSchema.safeParse(raw);
            current = parsed.success ? parsed.data : undefined;
          } catch {}
          setFondMenu(null);
          setQuickMenu(null);
          setFrameMenu((cur) => (cur?.uid === uid ? null : { board, uid, frame: current, what: frame?.dataset.editBitemType === "video-single" ? "vidéo" : "photo" }));
        } else if (op === "size" || op === "space") {
          setFondMenu(null);
          setFrameMenu(null);
          setBgMenu(null);
          // Le composant devient le composant choisi (panneau de gauche à jour) ; la fenêtre se pose sous le bouton, centrée dessus.
          const frame = itemOp.closest<HTMLElement>("[data-edit-bitem]");
          if (frame && !frame.hasAttribute("data-edit-bitem-rail") && itemSel?.uid !== uid) selectItem(frame);
          setQuickMenu((cur) => (cur?.uid === uid && cur.kind === op ? null : { board, uid, kind: op }));
        } else if (op === "imgbg") {
          const frame = itemOp.closest<HTMLElement>("[data-edit-bitem]");
          let current: string | undefined;
          try {
            const raw = (JSON.parse(frame?.dataset.editBitemProps ?? "{}") as { props?: { look?: { imageBg?: unknown } } }).props?.look?.imageBg;
            const parsed = ImageBgSchema.safeParse(raw);
            current = parsed.success ? parsed.data : undefined;
          } catch {}
          const wasOpen = bgMenuRef.current?.uid === uid;
          // Une seule fenêtre à la fois : pe:popups-close ferme les autres (et celle-ci), puis on ouvre la sienne.
          window.dispatchEvent(new CustomEvent("pe:popups-close"));
          setBgMenu(wasOpen ? null : { board, uid, bg: current });
        } else if (op === "fond") {
          setBgMenu(null);
          setFrameMenu(null);
          setQuickMenu(null);
          const frame = itemOp.closest<HTMLElement>("[data-edit-bitem]");
          let background: Background | null = null;
          try {
            background = readBackground((JSON.parse(frame?.dataset.editBitemProps ?? "{}") as { props?: { background?: unknown } }).props?.background) ?? null;
          } catch {}
          setFondMenu((cur) => (cur?.uid === uid ? null : { board, uid, background }));
        } else if (op === "add-images") {
          const input = addInput.current;
          if (input) {
            addBoard.current = board;
            addRail.current = frame0(itemOp)?.hasAttribute("data-edit-bitem-project") ? undefined : uid;
            input.value = "";
            input.click();
          }
        } else if (op === "settings") {
          const frame = itemOp.closest<HTMLElement>("[data-edit-bitem]") ?? itemFrame ?? null;
          // Une grille : « Réglages » ouvre la fenêtre blanche sur la toile (GridLayer) ; les autres composants, le panneau de gauche.
          if (frame?.dataset.editBitemType === "grid") window.dispatchEvent(new CustomEvent("pe:grid-settings", { detail: { uid, board } }));
          else selectItem(frame);
        }
        else if (op === "up" || op === "down" || op === "remove") {
          setItemSel((cur) => (cur?.uid === uid && op === "remove" ? null : cur));
          post({ kind: "bitem-op", board, uid, op });
          announce(op === "remove" ? "Bloc supprimé. Annuler le rétablit." : op === "up" ? "Bloc monté." : "Bloc descendu.");
        }
        return;
      }
      // Titre, Légende, Date sous un média (lot 39) : un clic écrit directement dedans (champ vide compris).
      const cap = hit?.closest<HTMLElement>("[data-cap]");
      if (cap && (cap.dataset.inline || cap.dataset.slotInline)) {
        e.preventDefault();
        e.stopPropagation();
        // (Un champ déjà ouvert a été validé par la perte du focus : on ouvre simplement celui-ci.)
        startText(cap);
        return;
      }
      // Un carrousel encore vide (« rien à montrer ») : un clic sur sa zone le choisit, comme un autre composant (lot 57).
      if (itemFrame && hit?.closest("[data-edit-bitem-pick]")) {
        e.preventDefault();
        e.stopPropagation();
        selectItem(itemFrame);
        return;
      }
      // Un composant autre que la bande : un clic le choisit (ses réglages s'ouvrent dans le panneau).
      if (itemFrame && !itemFrame.hasAttribute("data-edit-bitem-rail")) {
        e.preventDefault();
        e.stopPropagation();
        selectItem(itemFrame);
        return;
      }
      if (itemSel) setItemSel(null);
      const op = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-ghost-op]") : null;
      if (op) {
        e.preventDefault();
        e.stopPropagation();
        post({ kind: "ghost-op", id: op.dataset.ghostId ?? "", op: op.dataset.ghostOp === "retry" ? "retry" : "remove" });
        return;
      }
      // « Ajouter des images » de la planche : le sélecteur de fichiers, puis dépôt à la fin de la bande.
      const add = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-edit-board-add]") : null;
      if (add) {
        e.preventDefault();
        e.stopPropagation();
        const board = boardOf(add);
        const input = addInput.current;
        if (board && input) {
          addBoard.current = Number(board.dataset.editBoard) || null;
          addRail.current = undefined;
          input.value = "";
          input.click();
        }
        return;
      }
      const slot = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-edit-slot]") : null;
      setSelectedSlot(slot ? slotRefOf(slot) : null);
    };
    const frame0 = (el: Element) => el.closest<HTMLElement>("[data-edit-bitem]");
    // Un composant de la planche choisi : l'éditeur ouvre ses réglages.
    const selectItem = (frame: HTMLElement | null) => {
      const board = Number(frame?.dataset.board);
      const uid = frame?.dataset.editBitem;
      const type = frame?.dataset.editBitemType;
      if (!frame || !board || !uid || !isBoardItemType(type)) return;
      setItemSel({ board, uid });
      post({ kind: "bitem-select", board, uid, item: type, props: (frame.dataset.editBitemProps ?? "{}").slice(0, 100_000) });
    };
    const onDblClick = (e: MouseEvent) => {
      const field = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-slot-inline], [data-project-inline], [data-edit-bitem] [data-inline]") : null;
      if (!field) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      startText(field);
    };
    const onFocusIn = (e: FocusEvent) => {
      const slot = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("[data-edit-slot]") : null;
      setFocusSlot(slot && e.target === slot ? slotRefOf(slot) : null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || textRef.current) return;
      const slot = e.target instanceof HTMLElement && e.target.matches("[data-edit-slot]") ? e.target : null;
      const ref = slot && slotRefOf(slot);
      if (!slot || !ref) return;
      const rail = slot.closest("[data-edit-rail]");
      const els = rail ? slotEls(rail) : [];
      const i = els.indexOf(slot);
      const handled = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        handled();
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (e.shiftKey) {
          const to = i + dir;
          if (to < 0 || to >= els.length) return announce(dir < 0 ? "Déjà en première position." : "Déjà en dernière position.");
          const own = parseRailKey(ref.key);
          pendingFocus.current = own ? railKey(own.uid, to) : ref.key;
          post({ kind: "slot-move", board: ref.board, key: ref.key, index: fullIndex(els, dir < 0 ? to : to + 1) });
          announce(`Image déplacée en position ${to + 1} sur ${els.length}.`);
        } else {
          const next = els[i + dir];
          if (next) {
            next.focus();
            next.scrollIntoView({ block: "nearest", inline: "nearest" });
            announce(`Image ${i + dir + 1} sur ${els.length}.`);
          }
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        handled();
        // Une place retirée d'un carrousel décale les suivantes d'un rang : la clé de la voisine est celle d'un rang.
        const own = parseRailKey(ref.key);
        const nextKey = own ? (i + 1 < els.length ? railKey(own.uid, i) : i > 0 ? railKey(own.uid, i - 1) : undefined) : (els[i + 1]?.dataset.editSlot ?? els[i - 1]?.dataset.editSlot);
        if (e.shiftKey) {
          if (nextKey) pendingFocus.current = nextKey;
          post({ kind: "slot-op", board: ref.board, key: ref.key, op: "retire" });
        } else {
          pendingFocus.current = ref.key;
          post({ kind: "slot-op", board: ref.board, key: ref.key, op: "remove" });
        }
      } else if (e.key === "Enter" || e.key === " ") {
        handled();
        setSelectedSlot(ref);
        post({ kind: "slot-op", board: ref.board, key: ref.key, op: "replace" });
      }
    };
    // Fichiers glissés depuis l'ordinateur.
    let lastTarget: DropTargetInfo | null = null;
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer && [...e.dataTransfer.types].includes("Files"));
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      const hit = dropTargetAt(e.clientX, e.clientY, true);
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = hit ? "copy" : "none";
      lastTarget = hit?.target ?? null;
      setMarker(hit?.marker ?? null);
      autoScroll(e.clientX, e.clientY);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) {
        lastTarget = null;
        setMarker(null);
      }
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const hit = dropTargetAt(e.clientX, e.clientY, true);
      const target = hit?.target ?? lastTarget;
      setMarker(null);
      lastTarget = null;
      const files = [...(e.dataTransfer?.files ?? [])].slice(0, 30);
      if (target && files.length) post({ kind: "files", target, files });
      else if (files.length) announce("Dépose les fichiers sur un projet, entre deux images ou sur une place vide.");
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("dblclick", onDblClick, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKey, true);
    // Pas de glisser natif des images de la bande (le glisser est celui de la couche).
    const onDragStart = (e: DragEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-edit-slot]")) e.preventDefault();
    };
    // Une seule fenêtre à la fois (lot 31e) ; « Plus de réglages… » d'une grille : le panneau de gauche.
    const closeAll = () => {
      setFondMenu(null);
      setFrameMenu(null);
      setQuickMenu(null);
      setBgMenu(null);
      setFrameSlot(null);
      setBgSlot(null);
    };
    const openPanel = (e: Event) => {
      const d = (e as CustomEvent<{ uid?: string; board?: number }>).detail;
      if (!d?.uid || !d.board) return;
      selectItem(document.querySelector<HTMLElement>(`[data-edit-bitem="${CSS.escape(d.uid)}"][data-board="${d.board}"]`));
    };
    window.addEventListener("pe:popups-close", closeAll);
    window.addEventListener("pe:open-panel", openPanel);
    document.addEventListener("dragstart", onDragStart, true);
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("dragleave", onDragLeave, true);
    document.addEventListener("drop", onDrop, true);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("dblclick", onDblClick, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pe:popups-close", closeAll);
      window.removeEventListener("pe:open-panel", openPanel);
      document.removeEventListener("dragstart", onDragStart, true);
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("dragleave", onDragLeave, true);
      document.removeEventListener("drop", onDrop, true);
    };
  }, [edit, startText, announce, itemSel]);

  if (!edit || !host) return null;
  void tick;
  // Composant choisi : repère sur la toile (réappliqué à chaque rafraîchissement du rendu).
  for (const el of document.querySelectorAll("[data-edit-bitem][data-selected]")) {
    if (!itemSel || (el as HTMLElement).dataset.editBitem !== itemSel.uid) el.removeAttribute("data-selected");
  }
  if (itemSel) document.querySelector(`[data-edit-bitem="${CSS.escape(itemSel.uid)}"]`)?.setAttribute("data-selected", "");

  // Barre : survol, sinon focus clavier, sinon dernière image touchée.
  const active = frameSlot ?? bgSlot ?? hover ?? focusSlot ?? selectedSlot;
  const activeEl = active ? findSlot(active) : null;
  const activeBox = activeEl ? boxOf(activeEl.querySelector(".strip-media, .pe-empty-box") ?? activeEl) : null;
  const fillGhosts = ghosts.filter((g) => g.slot && g.phase !== "done");
  const newBoards = [...document.querySelectorAll<HTMLElement>("[data-edit-board-new]")]
    .map((el) => ({ uid: el.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock ?? "", box: boxOf(el) }))
    .filter((b): b is { uid: string; box: Rect } => Boolean(b.uid && b.box));
  // Projet d'un conteneur : place réservée tant qu'il n'en a pas, ou « Changer de projet ».
  const pickers = [
    ...[...document.querySelectorAll<HTMLElement>("[data-edit-container-pick]")].map((el) => ({ uid: el.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock ?? "", box: boxOf(el), change: false })),
    ...(pickerFor
      ? [{ uid: pickerFor, box: boxOf(document.querySelector(`[data-edit-block="${CSS.escape(pickerFor)}"]`) ?? document.body), change: true }]
      : []),
  ].filter((b): b is { uid: string; box: Rect; change: boolean } => Boolean(b.uid && b.box));
  const mediaEl = hoverMedia ? document.querySelector<HTMLElement>(`[data-edit-block="${CSS.escape(hoverMedia.uid)}"] [data-edit-media="${hoverMedia.field}"], [data-edit-block="${CSS.escape(hoverMedia.uid)}"][data-edit-media="${hoverMedia.field}"]`) : null;
  const mediaBox = mediaEl ? boxOf(mediaEl) : null;
  const mediaWord = hoverMedia?.kind === "video" ? "la vidéo" : hoverMedia?.kind === "background" ? "le fond" : hoverMedia?.kind === "pdf" ? "le PDF" : "l'image";

  return createPortal(
    <div className="pe-layer pe-board-layer" lang="fr">
      <input
        ref={addInput}
        className="pe-board-file"
        data-edit-board-file=""
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm,.mkv"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])].slice(0, 30);
          const board = addBoard.current;
          e.target.value = "";
          if (!board || !files.length) return;
          const el = document.querySelector<HTMLElement>(`[data-edit-board="${board}"]`);
          const uid = addRail.current;
          const rail = railOf(board, uid);
          const c = el?.dataset.editBoardCollection as (typeof COLLECTIONS)[number] | undefined;
          const index = rail ? fullIndex(slotEls(rail), slotEls(rail).length) : 0;
          post({ kind: "files", target: uid ? { kind: "rail", board, uid, index } : { kind: "board", board, index, ...(c && COLLECTIONS.includes(c) ? { collection: c } : {}) }, files });
        }}
      />
      {newBoards.map(({ uid, box }) => (
        <div
          key={`new-${uid}`}
          className="pe-board-new"
          data-new-board-uid={uid}
          data-over={(marker?.kind === "new" && Math.abs(marker.rect.top - box.top) < 2) || undefined}
          style={{ top: box.top + 24, left: Math.max(16, box.left + 16), width: Math.min(560, box.width - 32), minHeight: box.height - 48 }}
        >
          <p className="pe-board-new-title">Nouveau projet</p>
          <ProjectCombobox
            prefix="pe"
            label="Projet du bloc"
            projects={projects}
            onPick={(slug) => post({ kind: "board-pick", uid, slug })}
            onCreate={(name) => post({ kind: "board-create", uid, name })}
          />
          <small className="pe-board-help">Tape un nom : choisis un projet existant, ou « Créer » le nouveau. Contexte et année se règlent ensuite sur la page.</small>
          <div className="pe-board-drop" aria-hidden="true">
            Dépose tes images ici
          </div>
        </div>
      ))}

      {pickers.map(({ uid, box, change }) => (
        <PickerCard
          key={`pick-${uid}`}
          change={change}
          onClose={onPickerClose}
          style={{ top: box.top + (change ? 40 : 12), left: Math.max(16, box.left + 16), width: Math.min(560, box.width - 32) }}
        >
          <p className="pe-board-new-title">{change ? "Changer de projet" : "Projet mis en avant"}</p>
          <ProjectCombobox
            prefix="pe"
            label="Projet"
            autoFocus={change}
            projects={projects}
            onPick={(slug) => {
              post({ kind: "board-pick", uid, slug });
              onPickerClose();
            }}
            onCreate={(name) => {
              post({ kind: "board-create", uid, name });
              onPickerClose();
            }}
          />
          <small className="pe-board-help">
            Choisis le projet de ce bloc : son titre, sa présentation et ses images viennent de lui (textes et images se modifient ensuite sur la page). Un projet créé ici devient public avec la page.
          </small>
          {change && (
            <button type="button" className="pe-link-btn" onClick={onPickerClose}>
              Fermer
            </button>
          )}
        </PickerCard>
      ))}

      {mediaBox && hoverMedia && !marker && !dragActive && (
        <div
          className="pe-slot-tools pe-media-tools"
          role="toolbar"
          aria-label={hoverMedia.kind === "background" ? "Fond de l'ouverture" : hoverMedia.kind === "video" ? "Vidéo" : hoverMedia.kind === "pdf" ? "CV (PDF)" : "Image"}
          // En bas à gauche du média : jamais sur l'étiquette ni le fil d'Ariane du bloc choisi (en haut).
          // Fond de l'ouverture : en bas à DROITE — le texte de défilement (modifiable) occupe le bas à gauche.
          style={
            hoverMedia.kind === "background"
              ? (() => {
                  // Le fond déborde souvent de la fenêtre (parallaxe, hero plus haut que la toile) :
                  // la barre reste dans la partie visible, sans sortir de la toile ni par le bas ni par la droite.
                  const view = document.documentElement;
                  const bottom = Math.min(mediaBox.top + mediaBox.height - 46, window.scrollY + window.innerHeight - 54);
                  const right = Math.min(mediaBox.left + mediaBox.width - 8, window.scrollX + view.clientWidth - 8);
                  return { top: Math.max(mediaBox.top + 8, bottom), left: right, width: "max-content", transform: "translateX(-100%)" };
                })()
              : { top: mediaBox.top + Math.max(8, mediaBox.height - 46), left: Math.max(window.scrollX + 4, mediaBox.left + 8) }
          }
          onPointerEnter={() => setHoverMedia(hoverMedia)}
        >
          <button type="button" onClick={() => post({ kind: "media-op", uid: hoverMedia.uid, field: hoverMedia.field, op: "replace" })}>
            {hoverMedia.empty ? (hoverMedia.kind === "video" ? "Choisir une vidéo" : hoverMedia.kind === "pdf" ? "Choisir un PDF" : "Choisir une image") : hoverMedia.kind === "background" ? "Changer le fond" : hoverMedia.kind === "pdf" ? "Remplacer le PDF" : "Remplacer"}
          </button>
          {!hoverMedia.empty && hoverMedia.kind === "video" && mediaEl?.dataset.videoMode && (
            <span className="pe-seg" role="group" aria-label="Lecture de la vidéo" data-testid="media-video-mode">
              <span className="pe-seg-label" aria-hidden="true">
                Lecture
              </span>
              {VIDEO_MODES.map((m) => (
                <button key={m} type="button" aria-pressed={mediaEl.dataset.videoMode === m} title={VIDEO_MODE_HINTS[m]} data-video-mode-set={m} onClick={() => post({ kind: "video-mode", uid: hoverMedia.uid, mode: m })}>
                  {VIDEO_MODE_LABELS[m]}
                </button>
              ))}
            </span>
          )}
          {!hoverMedia.empty && (
            <button type="button" className="pe-danger" onClick={() => post({ kind: "media-op", uid: hoverMedia.uid, field: hoverMedia.field, op: "clear" })}>
              {hoverMedia.kind === "background" ? "Fond du thème" : `Retirer ${mediaWord}`}
            </button>
          )}
        </div>
      )}

      {activeBox && active && !marker && !dragActive && (
        <div
          className="pe-slot-tools"
          role="toolbar"
          aria-label={active.empty ? "Place gardée" : "Image du projet"}
          // Dans l'image, à gauche : jamais hors de l'écran, même sur une image étroite.
          style={{ top: activeBox.top + 8, left: Math.max(window.scrollX + 4, activeBox.left + 8), maxWidth: Math.max(160, activeBox.width - 16) }}
          onPointerEnter={() => setHover(active)}
        >
          <button type="button" onClick={() => post({ kind: "slot-op", board: active.board, key: active.key, op: "replace" })}>
            {active.empty ? "Choisir une image" : "Remplacer"}
          </button>
          {!active.empty && (
            <button type="button" onClick={() => post({ kind: "slot-op", board: active.board, key: active.key, op: "remove" })} title="La place reste, vide">
              Supprimer
            </button>
          )}
          <button type="button" className="pe-danger" onClick={() => post({ kind: "slot-op", board: active.board, key: active.key, op: "retire" })}>
            Retirer la place
          </button>
          {!active.empty && <SlotRadius el={activeEl} />}
          {!active.empty && activeEl && activeEl.querySelector("video, .strip-duration, [data-video-mode]") && <SlotVideoMode el={activeEl} />}
          {!active.empty && activeEl && activeEl.hasAttribute("data-pano") && <SlotPano el={activeEl} />}
          {!active.empty && activeEl && (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={frameSlot?.key === active.key}
              data-testid="slot-frame-button"
              title={activeEl.querySelector("video, .strip-duration") ? "Cadre autour de cette vidéo" : "Cadre autour de cette photo"}
              onClick={() => {
                setBgSlot(null);
                setFrameSlot((f) => (f?.key === active.key ? null : active));
              }}
            >
              Cadre
            </button>
          )}
          {!active.empty && activeEl && !activeEl.querySelector("video, .strip-duration") && (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={bgSlot?.key === active.key}
              data-testid="slot-imgbg-button"
              title="Fond derrière cette image (utile pour un PNG détouré)"
              onClick={() => {
                const wasOpen = bgSlot?.key === active.key;
                // Une seule fenêtre à la fois : pe:popups-close ferme les autres (et celle-ci), puis on ouvre la sienne.
                window.dispatchEvent(new CustomEvent("pe:popups-close"));
                setBgSlot(wasOpen ? null : active);
              }}
            >
              Fond image
            </button>
          )}
        </div>
      )}
      {bgSlot && activeBox && active && bgSlot.key === active.key && !marker && !dragActive && activeEl && (
        <SlotLookWindow el={activeEl} kind="bg" onClose={() => setBgSlot(null)} />
      )}
      {frameSlot && activeBox && active && frameSlot.key === active.key && !marker && !dragActive && activeEl && (
        <SlotLookWindow el={activeEl} kind="frame" onClose={() => setFrameSlot(null)} />
      )}

      {fillGhosts.map((g) => {
        const el = g.slot ? findSlot({ board: g.board, key: g.slot }) : null;
        const box = el ? boxOf(el.querySelector(".strip-media, .pe-empty-box") ?? el) : null;
        if (!box) return null;
        const pct = g.progress === null ? null : Math.round(g.progress * 100);
        return (
          <div key={g.id} className="pe-fill-ghost" data-phase={g.phase} role="status" style={{ top: box.top, left: box.left, width: box.width, height: box.height }}>
            <span>{g.phase === "failed" ? `Échec${g.message ? ` : ${g.message}` : ""}` : g.phase === "convert" ? "Conversion…" : `Envoi ${pct ?? 0} %`}</span>
            {g.phase === "failed" && (
              <span className="pe-ghost-actions">
                <button type="button" onClick={() => post({ kind: "ghost-op", id: g.id, op: "retry" })}>
                  Réessayer
                </button>
                <button type="button" onClick={() => post({ kind: "ghost-op", id: g.id, op: "remove" })}>
                  Retirer
                </button>
              </span>
            )}
          </div>
        );
      })}

      {marker?.kind === "item" && (
        <div className="pe-marker pe-marker-board" style={{ top: marker.rect.top, left: marker.rect.left, width: marker.rect.width }} aria-hidden="true">
          <span>Déposer ici</span>
        </div>
      )}
      {marker && marker.kind !== "item" && (
        <div
          className={`pe-drop pe-drop-${marker.kind}`}
          aria-hidden="true"
          style={{ top: marker.rect.top, left: marker.rect.left, width: marker.rect.width, height: marker.rect.height }}
        >
          {marker.label && <span className="pe-drop-label">{marker.label}</span>}
        </div>
      )}

      {projectHint && !text && projectHint.el.isConnected && (() => {
        const box = boxOf(projectHint.el);
        if (!box) return null;
        const name = projectHint.label ? `« ${projectHint.label} »` : "";
        return (
          <div className="pe-project-hint" role="status" style={{ top: box.top + box.height + 6, left: Math.max(window.scrollX + 8, box.left) }}>
            {projectHint.textHeld ? (
              <span>
                {projectHint.slotHeld ? "Projet" : "Textes du projet"} {name} en cours de modification sur la page « {projectHint.textHeld} » : lecture seule ici.
              </span>
            ) : projectHint.draft ? (
              <span>Texte du projet {name}, créé sur cette page : visible partout où ce projet apparaît.</span>
            ) : (
              <>
                <span>Texte du projet {name} — modifié aussi partout où ce projet est montré.</span>
                <a href={`/admin/projets/${projectHint.board}`} target="_blank" rel="noreferrer">
                  Voir le projet
                </a>
              </>
            )}
          </div>
        );
      })()}

      {text && (
        <div
          className={text.el.hasAttribute("data-cap") ? "pe-text-editor pe-text-editor-line" : "pe-text-editor"}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Modifier le texte"
          style={
            text.el.hasAttribute("data-cap")
              ? // Titre / Légende / Date : le champ a la hauteur de SA ligne (les lignes se touchent, il ne doit recouvrir ni celle du dessus ni celle du dessous).
                { ...text.style, top: text.rect.top, left: text.rect.left - 6, minWidth: text.rect.width + 12, minHeight: text.rect.height }
              : { ...text.style, top: text.rect.top - 4, left: text.rect.left - 6, minWidth: text.rect.width + 12, minHeight: text.rect.height + 8 }
          }
          ref={(node) => {
            if (node && !node.dataset.ready) {
              node.dataset.ready = "1";
              node.textContent = text.original;
              node.focus();
              const range = document.createRange();
              range.selectNodeContents(node);
              range.collapse(false);
              window.getSelection()?.removeAllRanges();
              window.getSelection()?.addRange(range);
            }
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              finishText(true, e.currentTarget.textContent ?? "");
            } else if (e.key === "Escape") {
              e.preventDefault();
              // Titre, Légende, Date (lot 39) : Échap valide, comme sur une page (ce qui est tapé n'est jamais perdu).
              if (text.el.hasAttribute("data-cap")) finishText(true, e.currentTarget.textContent ?? "");
              else finishText(false);
            }
          }}
          onBlur={(e) => finishText(true, e.currentTarget.textContent ?? "")}
        />
      )}

      {quickMenu && <QuickMenu key={`${quickMenu.uid}-${quickMenu.kind}`} uid={quickMenu.uid} kind={quickMenu.kind} anchor={opAnchor(quickMenu.kind, quickMenu.board, quickMenu.uid)} onClose={() => setQuickMenu(null)} />}
      {bgMenu && (
        <ImageBgWindow
          key={bgMenu.uid}
          anchor={opAnchor("imgbg", bgMenu.board, bgMenu.uid)}
          value={bgMenu.bg}
          onChange={(bg) => sendMediaLook({ kind: "item", board: bgMenu.board, uid: bgMenu.uid }, { bg: (bg as ImageBg | undefined) ?? null })}
          onClose={() => setBgMenu(null)}
        />
      )}
      {frameMenu && (
        <FrameWindow
          key={frameMenu.uid}
          what={frameMenu.what}
          testId="frame-menu"
          anchor={opAnchor("frame", frameMenu.board, frameMenu.uid)}
          value={frameMenu.frame}
          onChange={(frame) => sendMediaLook({ kind: "item", board: frameMenu.board, uid: frameMenu.uid }, { frame: frame ?? null })}
          onClose={() => setFrameMenu(null)}
        />
      )}
      {fondMenu && <BoardFondMenu key={fondMenu.uid} board={fondMenu.board} uid={fondMenu.uid} initial={fondMenu.background} anchor={opAnchor("fond", fondMenu.board, fondMenu.uid)} onClose={() => setFondMenu(null)} />}

      {addMenu && (
        <BoardAddMenu
          {...addMenu}
          anchor={`[data-edit-bitem-add="${addMenu.index}"][data-board="${addMenu.board}"]`}
          onClose={() => setAddMenu(null)}
          onPick={(type, source) => {
            post({ kind: "bitem-add", board: addMenu.board, item: type, index: addMenu.index, ...(source ? { source } : {}) });
            announce(`${BOARD_ITEM_LABELS[type]} ajouté.`);
            setAddMenu(null);
          }}
        />
      )}
    </div>,
    host,
  );
}

/**
 * Menu court des composants permis dans une planche (« + Ajouter ») : cinq choix, clavier compris (flèches,
 * Entrée, Échap). La bande d'images se grise quand la planche en a déjà une, tout se grise quand elle est pleine.
 */
function BoardAddMenu({ anchor, hasStrip, count, onPick, onClose }: { board: number; index: number; anchor: string; hasStrip: boolean; count: number; onPick: (type: BoardItemType, source?: "project") => void; onClose: () => void }) {
  const full = count >= MAX_BOARD_ITEMS;
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (!items.length) return;
    e.preventDefault();
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  };
  return (
    <Popover anchor={anchor} className="pe-layouts pe-bitem-menu" role="menu" label="Ajouter un bloc au projet" onClose={onClose} onKeyDown={onKeyDown} focusFirst>
      {BOARD_ITEM_TYPES.map((type) => (
        <button key={type} type="button" role="menuitem" disabled={full} onClick={() => onPick(type)} data-bitem-type={type}>
          <strong>{BOARD_ITEM_LABELS[type]}</strong>
          <small>{full ? `${MAX_BOARD_ITEMS} blocs au plus.` : type === "strip" ? "Des images et des vidéos choisies dans ta médiathèque." : BOARD_ITEM_HINTS[type]}</small>
        </button>
      ))}
      {/* La bande d'origine (les images du projet) : proposée si elle a été retirée. */}
      {!hasStrip && (
        <button type="button" role="menuitem" disabled={full} onClick={() => onPick("strip", "project")} data-bitem-type="strip" data-bitem-source="project">
          <strong>{BOARD_ITEM_LABELS.strip}</strong>
          <small>Reprend les images du projet, avec leurs légendes.</small>
        </button>
      )}
    </Popover>
  );
}

/**
 * Carte du choix de projet d'un conteneur. « Changer de projet » (ouvert à la
 * demande) se ferme d'un clic ailleurs ; la place « Projet mis en avant » d'un
 * conteneur sans projet est permanente.
 */
function PickerCard({ change, onClose, style, children }: { change: boolean; onClose: () => void; style: React.CSSProperties; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose, { enabled: change });
  return (
    <div ref={ref} className="pe-board-new pe-container-picker" style={style}>
      {children}
    </div>
  );
}

/** Contenu d'un fantôme (aperçu, voile, état, barre, actions en cas d'échec, nom). */
function ghostContent(g: Ghost, state: string, pct: number | null): DocumentFragment {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const frag = document.createDocumentFragment();
  const box = el("span", "pe-ghost-box rounded-strip");
  box.style.width = `calc(var(--strip-h) * ${g.aspect.toFixed(4)})`;
  if (g.preview?.startsWith("blob:")) {
    const img = el("img");
    img.src = g.preview;
    img.alt = "";
    box.append(img);
  }
  box.append(el("span", "pe-ghost-veil"), el("span", "pe-ghost-state", state));
  if (pct !== null && g.phase !== "failed") {
    const bar = el("span", "pe-ghost-bar");
    const fill = el("span");
    fill.style.width = `${pct}%`;
    bar.append(fill);
    box.append(bar);
  }
  if (g.phase === "failed") {
    const actions = el("span", "pe-ghost-actions");
    for (const [op, label] of [
      ["retry", "Réessayer"],
      ["remove", "Retirer"],
    ] as const) {
      const button = el("button", undefined, label);
      button.type = "button";
      button.dataset.ghostOp = op;
      button.dataset.ghostId = g.id;
      actions.append(button);
    }
    box.append(actions);
  }
  frag.append(box, el("span", "strip-caption pe-ghost-name", g.label));
  return frag;
}

/**
 * Arrondi de CETTE image de la planche (intégration lots 2 + 3) : réglage
 * `look.slotLook[slug].radius` du bloc planche, par slug d'emplacement ; « Auto » =
 * l'arrondi du bloc, du site ou du thème.
 */
function SlotRadius({ el }: { el: Element | null }) {
  const slug = el?.getAttribute("data-slot-slug") ?? "";
  const uid = el?.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock ?? "";
  if (!slug || !uid || !/^[a-z0-9-]+$/.test(slug)) return null;
  const current = slotOf(lookOf(uid), slug).radius;
  const change = (v: string) => {
    sendSlotLook(uid, slug, { radius: v === "auto" ? null : (v as Radius) });
  };
  return (
    <label className="pe-slot-radius" title="Arrondi de cette image">
      <span>Arrondi</span>
      <select aria-label="Arrondi de cette image" value={current ?? "auto"} onChange={(e) => change(e.target.value)} data-testid="slot-radius">
        <option value="auto">Auto</option>
        {RADII.map((r) => (
          <option key={r} value={r}>
            {RADIUS_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Lecture de CETTE vidéo d'un carrousel (lot 38) : Boucle ou Lecteur, réglage `look.slotLook[slug].video` du bloc planche, par slug d'emplacement.
 * Sans choix, la vidéo suit le réglage ancien de la bande ou sa nature (courte et muette : boucle) : le bouton montre ce que la page fait.
 */
function SlotVideoMode({ el }: { el: Element }) {
  const [, bump] = useState(0);
  const slug = el.getAttribute("data-slot-slug") ?? "";
  const uid = el.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock ?? "";
  if (!slug || !uid || !/^[a-z0-9-]+$/.test(slug)) return null;
  const chosen = slotOf(lookOf(uid), slug).video;
  const shown = el.getAttribute("data-video-mode") ?? el.querySelector("[data-video-mode]")?.getAttribute("data-video-mode");
  const now = chosen ?? (shown === "loop" ? "loop" : "player");
  const change = (m: "loop" | "player") => {
    sendSlotLook(uid, slug, { video: m });
    bump((n) => n + 1);
  };
  return (
    <span className="pe-seg" role="group" aria-label="Lecture de la vidéo" data-testid="slot-video-mode">
      <span className="pe-seg-label" aria-hidden="true">
        Lecture
      </span>
      {VIDEO_MODES.map((m) => (
        <button key={m} type="button" aria-pressed={now === m} title={VIDEO_MODE_HINTS[m]} data-slot-video-set={m} onClick={() => change(m)}>
          {VIDEO_MODE_LABELS[m]}
        </button>
      ))}
    </span>
  );
}

/**
 * Panorama de CETTE image d'un carrousel (lot 45) : réglage `look.slotLook[slug].pano` du bloc planche, par slug d'emplacement.
 * « Entier » (défaut) : l'image ne dépasse pas la largeur visible du carrousel ; « À faire défiler » : sa largeur naturelle, comme avant.
 */
function SlotPano({ el }: { el: Element }) {
  const [, bump] = useState(0);
  const slug = el.getAttribute("data-slot-slug") ?? "";
  const uid = el.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock ?? "";
  if (!slug || !uid || !/^[a-z0-9-]+$/.test(slug)) return null;
  const now = slotOf(lookOf(uid), slug).pano ?? "fit";
  const change = (m: "fit" | "scroll") => {
    sendSlotLook(uid, slug, { pano: m === "fit" ? null : m });
    bump((n) => n + 1);
  };
  return (
    <span className="pe-seg" role="group" aria-label="Panorama" data-testid="slot-pano">
      <span className="pe-seg-label" aria-hidden="true">
        Panorama
      </span>
      <button type="button" aria-pressed={now !== "scroll"} title="L'image se voit en entier, sans dépasser le carrousel" data-slot-pano-set="fit" onClick={() => change("fit")}>
        Entier
      </button>
      <button type="button" aria-pressed={now === "scroll"} title="L'image garde sa taille et se découvre en faisant défiler" data-slot-pano-set="scroll" onClick={() => change("scroll")}>
        À faire défiler
      </button>
    </span>
  );
}

/**
 * Fenêtre « Fond de l'image » (lot 41) ou « Cadre » (lot 34) de CETTE image de la planche : réglage `look.slotLook[slug]` (`bg`, `frame`) du
 * bloc planche, par slug d'emplacement ; mêmes réglages que pour une image seule. La fenêtre est celle de tous les conteneurs
 * (`ImageBgWindow`, `FrameWindow`), ancrée au bouton de la barre de l'image ; ici seulement l'écriture par emplacement.
 */
function SlotLookWindow({ el, kind, onClose }: { el: Element; kind: "frame" | "bg"; onClose: () => void }) {
  const slug = el.getAttribute("data-slot-slug") ?? "";
  const uid = el.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock ?? "";
  if (!slug || !uid || !/^[a-z0-9-]+$/.test(slug)) return null;
  const mine = slotOf(lookOf(uid), slug);
  if (kind === "bg") {
    const change = (next: string | undefined) => {
      sendSlotLook(uid, slug, { bg: (next as ImageBg | undefined) ?? null });
    };
    return <ImageBgWindow anchor='.pe-slot-tools [data-testid="slot-imgbg-button"]' value={mine.bg} onChange={change} onClose={onClose} />;
  }
  const what = el.querySelector("video, .strip-duration") ? "vidéo" : "photo";
  const change = (next: Frame | undefined) => {
    sendSlotLook(uid, slug, { frame: next ?? null });
  };
  const current = mine.frame;
  return <FrameWindow anchor='.pe-slot-tools [data-testid="slot-frame-button"]' value={current} onChange={change} onClose={onClose} what={what} />;
}
