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
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { acceptToCanvas, EDIT_MSG, type DropTargetInfo, type FromCanvas, type Ghost } from "@/lib/edit/protocol";
import { postIntent, previewBoardText } from "./edit/optimistic";

import { RADII, RADIUS_LABELS, type Radius } from "@/lib/look";

import { lookOf, sendLook } from "./edit/LookLayer";
import ProjectCombobox, { type ComboProject } from "./edit/ProjectCombobox";
import { useDismiss } from "./edit/useDismiss";

type Rect = { top: number; left: number; width: number; height: number };
type SlotRef = { board: number; key: string; empty: boolean };
type Marker = { kind: "cursor"; rect: Rect } | { kind: "slot"; rect: Rect } | { kind: "new"; rect: Rect } | { kind: "media"; rect: Rect };
type MediaRef = { uid: string; field: "mediaId" | "backgroundMediaId" | "portraitMediaId"; kind: string; empty: boolean };
const MEDIA_FIELDS = ["mediaId", "backgroundMediaId", "portraitMediaId"] as const;
const COLLECTIONS = ["characters", "backgrounds", "animation"] as const;

const EDGE = 64;

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

const slotEls = (rail: Element) => [...rail.querySelectorAll<HTMLElement>(":scope > [data-edit-slot]")];
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
  const uid = host?.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock;
  if (!host || !uid || !field || !MEDIA_FIELDS.includes(field)) return null;
  // L'ouverture : seulement quand on vise son décor, pas un texte ou un bouton posé dessus.
  return { ref: { uid, field, kind: host.dataset.editMediaKind ?? "image", empty: host.classList.contains("pe-media-empty") || Boolean(host.querySelector(".pe-media-empty")) }, el: host };
}

/** Cible de dépôt sous le point (fenêtre). */
function dropTargetAt(x: number, y: number): { target: DropTargetInfo; marker: Marker } | null {
  // Sous le point : la page (le calque d'édition est ignoré, sauf le panneau d'une planche neuve).
  const el = document.elementsFromPoint(x, y).find((e) => !e.closest(".pe-layer") || e.closest("[data-new-board-uid]"));
  if (!el) return null;
  const newPanel = el.closest<HTMLElement>("[data-new-board-uid]");
  if (newPanel?.dataset.newBoardUid) {
    const box = boxOf(newPanel);
    return box ? { target: { kind: "new", uid: newPanel.dataset.newBoardUid }, marker: { kind: "new", rect: box } } : null;
  }
  // Place libre d'une grille : un composant y est créé avec le média.
  const cell = el.closest<HTMLElement>("[data-edit-cell-free]");
  const gridUid = cell?.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock;
  if (cell && gridUid) {
    const box = boxOf(cell);
    return box ? { target: { kind: "cell", uid: gridUid }, marker: { kind: "media", rect: box } } : null;
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
  const rail = board?.querySelector("[data-edit-rail]");
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
  const rail = el?.closest("[data-edit-board]")?.querySelector<HTMLElement>("[data-edit-rail]");
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

type TextEdit = { el: HTMLElement; kind: "slot" | "project"; board: number; key?: string; field: string; original: string; value: string; rect: Rect; style: React.CSSProperties };

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
  const [focusSlot, setFocusSlot] = useState<SlotRef | null>(null);
  const [marker, setMarker] = useState<Marker | null>(null);
  // Un glisser est en cours (média, fichiers, image) : pas de barre d'image.
  const [dragActive, setDragActive] = useState(false);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [projects, setProjects] = useState<ComboProject[]>([]);
  const [text, setText] = useState<TextEdit | null>(null);
  // Texte (ou image) d'un projet survolé : indicateur « modifié aussi sur sa planche et sa page ».
  const [projectHint, setProjectHint] = useState<{ el: HTMLElement; board: number; label: string; draft: boolean; textHeld: string | null; slotHeld?: boolean } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hoverMedia, setHoverMedia] = useState<MediaRef | null>(null);
  const ghostsRef = useRef<Ghost[]>([]);
  const pendingFocus = useRef<string | null>(null);
  const textRef = useRef<TextEdit | null>(null);
  // « Ajouter des images » : champ fichier de la couche, et planche visée.
  const addInput = useRef<HTMLInputElement>(null);
  const addBoard = useRef<number | null>(null);
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
        const hit = dropTargetAt(msg.x, msg.y);
        setMarker(hit?.marker ?? null);
        post({ kind: "drop-target", target: hit?.target ?? null });
        autoScroll(msg.x, msg.y);
      } else if (msg.kind === "drag-end") {
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
      const rail = document.querySelector(`[data-edit-board="${g.board}"] [data-edit-rail]`);
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
      const siblings = items.filter((x) => x.board === g.board && x.index === g.index && !x.slot && x.phase !== "done");
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
    // Textes du projet en cours de modification sur une autre page : un seul brouillon à la fois.
    const heldBy = el.dataset.projectInline ? boardOf(el)?.dataset.editBoardTextHeld : undefined;
    if (heldBy) {
      announce(`Les textes de ce projet sont en cours de modification sur la page « ${heldBy} » : publie-la ou abandonne-la d'abord.`);
      return;
    }
    // Légendes d'une planche dont les images sont tenues par une autre page : l'écriture serait refusée.
    const imagesHeldBy = el.dataset.slotInline ? boardOf(el)?.dataset.editBoardHeld : undefined;
    if (imagesHeldBy) {
      announce(`Cette planche est en cours de modification sur la page « ${imagesHeldBy} » : publie-la ou abandonne-la d'abord.`);
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
      color: cs.color,
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
    if (t.kind === "slot" && t.key) {
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
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || inLayer(e.target) || isTyping(e.target)) return;
      const slot = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-edit-slot]") : null;
      const ref = slot && slotRefOf(slot);
      if (!slot || !ref || e.pointerType === "touch") return;
      pressed = { el: slot, ref, x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    const onUp = () => {
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
          input.value = "";
          input.click();
        }
        return;
      }
      const slot = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-edit-slot]") : null;
      setSelectedSlot(slot ? slotRefOf(slot) : null);
    };
    const onDblClick = (e: MouseEvent) => {
      const field = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-slot-inline], [data-project-inline]") : null;
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
          pendingFocus.current = ref.key;
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
        const nextKey = els[i + 1]?.dataset.editSlot ?? els[i - 1]?.dataset.editSlot;
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
      const hit = dropTargetAt(e.clientX, e.clientY);
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
      const hit = dropTargetAt(e.clientX, e.clientY);
      const target = hit?.target ?? lastTarget;
      setMarker(null);
      lastTarget = null;
      const files = [...(e.dataTransfer?.files ?? [])].slice(0, 30);
      if (target && files.length) post({ kind: "files", target, files });
      else if (files.length) announce("Dépose les fichiers sur une planche, entre deux images ou sur une place vide.");
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
      document.removeEventListener("dragstart", onDragStart, true);
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("dragleave", onDragLeave, true);
      document.removeEventListener("drop", onDrop, true);
    };
  }, [edit, startText, announce]);

  if (!edit || !host) return null;
  void tick;

  // Barre : survol, sinon focus clavier, sinon dernière image touchée.
  const active = hover ?? focusSlot ?? selectedSlot;
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
          const rail = el?.querySelector("[data-edit-rail]");
          const c = el?.dataset.editBoardCollection as (typeof COLLECTIONS)[number] | undefined;
          const index = rail ? fullIndex(slotEls(rail), slotEls(rail).length) : 0;
          post({ kind: "files", target: { kind: "board", board, index, ...(c && COLLECTIONS.includes(c) ? { collection: c } : {}) }, files });
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
          <p className="pe-board-new-title">Nouvelle planche</p>
          <ProjectCombobox
            prefix="pe"
            label="Projet de la planche"
            projects={projects}
            onPick={(slug) => post({ kind: "board-pick", uid, slug })}
            onCreate={(name) => post({ kind: "board-create", uid, name })}
          />
          <small className="pe-board-help">Tape un nom : choisis un projet existant, ou « Créer » le nouveau. Contexte et année se règlent ensuite sur la planche.</small>
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
            Choisis le projet de cette rubrique : son titre, sa présentation et ses images viennent de lui (textes et images se modifient ensuite sur la page). Un projet créé ici devient public avec la page.
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
          aria-label={active.empty ? "Place gardée" : "Image de la planche"}
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
        </div>
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

      {marker && (
        <div
          className={`pe-drop pe-drop-${marker.kind}`}
          aria-hidden="true"
          style={{ top: marker.rect.top, left: marker.rect.left, width: marker.rect.width, height: marker.rect.height }}
        />
      )}

      {projectHint && !text && projectHint.el.isConnected && (() => {
        const box = boxOf(projectHint.el);
        if (!box) return null;
        const name = projectHint.label ? `« ${projectHint.label} »` : "";
        return (
          <div className="pe-project-hint" role="status" style={{ top: box.top + box.height + 6, left: Math.max(window.scrollX + 8, box.left) }}>
            {projectHint.textHeld ? (
              <span>
                {projectHint.slotHeld ? "Planche" : "Textes du projet"} {name} en cours de modification sur la page « {projectHint.textHeld} » : lecture seule ici.
              </span>
            ) : projectHint.draft ? (
              <span>Texte du projet {name}, créé sur cette page : visible sur sa planche et partout où il apparaît.</span>
            ) : (
              <>
                <span>Texte du projet {name} — modifié aussi sur sa planche et sa page.</span>
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
          className="pe-text-editor"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Modifier le texte"
          style={{ ...text.style, top: text.rect.top - 4, left: text.rect.left - 6, minWidth: text.rect.width + 12, minHeight: text.rect.height + 8 }}
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
              finishText(false);
            }
          }}
          onBlur={(e) => finishText(true, e.currentTarget.textContent ?? "")}
        />
      )}
    </div>,
    host,
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
 * `look.slotRadius` du bloc planche, par slug d'emplacement ; « Auto » =
 * l'arrondi du bloc, du site ou du thème.
 */
function SlotRadius({ el }: { el: Element | null }) {
  const slug = el?.getAttribute("data-slot-slug") ?? "";
  const uid = el?.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock ?? "";
  if (!slug || !uid || !/^[a-z0-9-]+$/.test(slug)) return null;
  const look = lookOf(uid);
  const current = look.slotRadius && Object.hasOwn(look.slotRadius, slug) ? look.slotRadius[slug] : undefined;
  const change = (v: string) => {
    const next = { ...(look.slotRadius ?? {}) };
    if (v === "auto") delete next[slug];
    else next[slug] = v as Radius;
    sendLook(uid, { ...look, slotRadius: next });
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
