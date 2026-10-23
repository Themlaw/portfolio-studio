"use client";

/**
 * UN SEUL composant de fenêtre / menu ancré de la toile (lot 65, R3 de l'audit A5) : généralisation du `Panel` de SiteLayer.
 * Cadre, Fond image, Fond, Carte, Taille, Espace, Réglages de la grille, « + Ajouter », menu et réseaux… : toutes les fenêtres
 * qui s'ouvrent depuis un bouton de barre passent par lui ; plus aucune enveloppe ne calcule sa propre position (plus de −300,
 * −165, −120, +46, de `right: 6px` du bloc ni de calage sur l'image).
 *
 * L'ANCRE est le BOUTON cliqué : un élément, un sélecteur CSS (retrouvé à chaque calcul : la barre, ou toute la toile, peut être
 * redessinée) ou une fonction. La fenêtre se pose sous lui (à `GAP` px), se retourne au-dessus s'il n'y a pas la place dessous, reste
 * entièrement dans la fenêtre du navigateur (largeur comprise : elle tient sur 390 px) et, si ni dessous ni dessus ne suffit, prend la
 * plus grande des deux places en défilant. Elle se RECALCULE au défilement, au redimensionnement, quand l'ancre, la fenêtre ou la
 * page changent de taille, et quand la toile est redessinée (rechargement d'une planche, barre déplacée). Si le bouton a disparu,
 * elle garde la dernière place connue. Fermeture : Échap et clic dehors (`useDismiss`, comme tous les menus flottants).
 *
 * Rendue dans l'hôte de la couche d'édition (`.pe-host`, coordonnées du document) : hors du contenu du site, donc hors des
 * `overflow: clip`, `clip-path` et `z-index` des rubriques.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { topDismiss, useDismiss } from "./useDismiss";

/** Le bouton qui ouvre la fenêtre : l'élément, un sélecteur CSS (retrouvé à chaque calcul) ou une fonction. */
export type PopoverAnchor = Element | string | (() => Element | null);

/** Écart entre le bouton et la fenêtre, et marge minimale avec le bord de la fenêtre du navigateur. */
export const POPOVER_GAP = 6;
export const POPOVER_EDGE = 8;

function resolveAnchor(a: PopoverAnchor, doc: Document): Element | null {
  if (typeof a === "string") return doc.querySelector(a);
  if (typeof a === "function") return a();
  return a.isConnected ? a : null;
}

/**
 * Place la fenêtre `el` près du rectangle `r` (coordonnées de la fenêtre du navigateur). Pur calcul sur le DOM : rend la position
 * en coordonnées du document, ou undefined si rien n'a changé depuis `last`.
 */
export function placePopover(el: HTMLElement, r: { left: number; top: number; right: number; bottom: number }, align: "start" | "center" | "end", prefer: "below" | "above" = "below", clearBottom?: number, obstacles: { left: number; top: number; right: number; bottom: number }[] = []) {
  const doc = el.ownerDocument;
  const win = doc.defaultView ?? window;
  const vw = doc.documentElement.clientWidth;
  const vh = win.innerHeight;
  // Taille naturelle (sans la contrainte posée au calcul précédent).
  el.style.maxHeight = "";
  el.style.overflowY = "";
  const w = Math.min(el.offsetWidth, vw - 2 * POPOVER_EDGE);
  let h = el.offsetHeight;
  let left = align === "center" ? (r.left + r.right) / 2 - w / 2 : align === "end" ? r.right - w : r.left;
  left = Math.max(POPOVER_EDGE, Math.min(left, vw - POPOVER_EDGE - w));
  // Dessous : sous le bouton, et sous ce qu'il ne faut pas recouvrir (`clearBottom`, ex. le texte qu'il règle).
  const belowFrom = Math.max(r.bottom, clearBottom ?? r.bottom);
  const below = vh - POPOVER_EDGE - (belowFrom + POPOVER_GAP);
  const above = r.top - POPOVER_GAP - POPOVER_EDGE;
  let top: number;
  const hits = (t: number) => obstacles.some((o) => left < o.right + POPOVER_GAP && left + w > o.left - POPOVER_GAP && t < o.bottom + POPOVER_GAP && t + h > o.top - POPOVER_GAP);
  // Les côtés qui tiennent, le préféré d'abord ; le premier qui ne recouvre aucun obstacle (barre d'outils du bloc…) gagne.
  const A: [boolean, number] = [h <= above, r.top - POPOVER_GAP - h];
  const B: [boolean, number] = [h <= below, belowFrom + POPOVER_GAP];
  const fits = (prefer === "above" ? [A, B] : [B, A]).filter((x) => x[0]);
  if (fits.length) top = (fits.find((x) => !hits(x[1])) ?? fits[0])[1];
  else {
    // Ni dessous ni dessus : la plus grande place (au moins un tiers de la fenêtre), le contenu défile.
    const room = Math.max(below, above, Math.min(vh - 2 * POPOVER_EDGE, 160));
    h = Math.min(h, room);
    el.style.maxHeight = `${h}px`;
    el.style.overflowY = "auto";
    top = below >= above ? belowFrom + POPOVER_GAP : r.top - POPOVER_GAP - h;
  }
  // Bouton hors de l'écran (défilé) : la fenêtre reste lisible, à la limite de la vue.
  top = Math.max(POPOVER_EDGE, Math.min(top, vh - POPOVER_EDGE - h));
  return { left: left + win.scrollX, top: top + win.scrollY };
}

/** Fenêtres ouvertes, la plus récente en dernier : Échap ferme la dernière, et elle seule. */
const openStack: symbol[] = [];

export type PopoverProps = {
  anchor: PopoverAnchor;
  /** Nom accessible de la fenêtre. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Classes de contenu (`sm tc` : fenêtre blanche à réglages ; `pe-layouts` : menu de choix). */
  className?: string;
  role?: "dialog" | "menu" | "radiogroup" | "toolbar";
  /** Côté préféré : « above » met la fenêtre au-dessus du bouton quand la place y est (ne cache pas ce qui est dessous). */
  prefer?: "below" | "above";
  /** Sélecteur des éléments (barres) que la fenêtre ne doit pas recouvrir : l'autre côté du bouton est choisi s'il le faut. */
  obstacles?: string;
  /** Élément que la fenêtre ne doit pas recouvrir quand elle se pose dessous (le texte réglé par « Aa »). */
  avoid?: PopoverAnchor;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  testId?: string;
  /** Côté du bouton sur lequel la fenêtre s'aligne (début par défaut). */
  align?: "start" | "center" | "end";
  /** Clics qui ne ferment pas la fenêtre en plus du bouton qui l'ouvre et d'elle-même. */
  ignoreDismiss?: (target: Element) => boolean;
  style?: CSSProperties;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** Entrée en premier : le premier champ ou choix prend le focus à l'ouverture. */
  focusFirst?: boolean;
};

export default function Popover({ anchor, label, onClose, children, className = "sm tc", role = "dialog", testId, align = "start", prefer = "below", avoid, obstacles, ignoreDismiss, style, onKeyDown, onPointerDown, focusFirst }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorRef = useRef(anchor);
  const alignRef = useRef(align);
  const preferRef = useRef(prefer);
  const avoidRef = useRef(avoid);
  const obstaclesRef = useRef(obstacles);
  useLayoutEffect(() => {
    anchorRef.current = anchor;
    alignRef.current = align;
    preferRef.current = prefer;
    avoidRef.current = avoid;
    obstaclesRef.current = obstacles;
  });
  useDismiss(ref, onClose, { ...(ignoreDismiss ? { ignore: ignoreDismiss } : {}), escape: false });
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  // Échap ferme la fenêtre ET RIEN D'AUTRE (le bloc reste choisi, sa barre reste là) : écouté en capture sur la fenêtre du navigateur,
  // avant les couches de sélection ; seule la plus récente se ferme.
  useLayoutEffect(() => {
    const id = Symbol("popover");
    openStack.push(id);
    const win = (ref.current?.ownerDocument ?? document).defaultView ?? window;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || openStack[openStack.length - 1] !== id) return;
      // Un menu plus récent ouvert DANS la fenêtre (liste de tailles, de polices…) se ferme d'abord : ce n'est pas à nous.
      if (topDismiss() !== ref.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeRef.current();
    };
    win.addEventListener("keydown", onKey, true);
    return () => {
      win.removeEventListener("keydown", onKey, true);
      const at = openStack.indexOf(id);
      if (at >= 0) openStack.splice(at, 1);
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const doc = el.ownerDocument;
    const win = doc.defaultView ?? window;
    // Dernière place connue du bouton (coordonnées du document) : s'il disparaît un instant (toile redessinée), la fenêtre reste là.
    let last: { left: number; top: number; right: number; bottom: number } | null = null;
    let seen = "";
    let raf = 0;
    const update = () => {
      raf = 0;
      const a = resolveAnchor(anchorRef.current, doc);
      if (a) {
        const b = a.getBoundingClientRect();
        last = { left: b.left + win.scrollX, top: b.top + win.scrollY, right: b.right + win.scrollX, bottom: b.bottom + win.scrollY };
        if (a !== watched) {
          if (watched) ro.unobserve(watched);
          ro.observe(a);
          watched = a;
        }
      }
      if (!last) return;
      const r = { left: last.left - win.scrollX, top: last.top - win.scrollY, right: last.right - win.scrollX, bottom: last.bottom - win.scrollY };
      const key = `${obstaclesRef.current ? [...doc.querySelectorAll(obstaclesRef.current)].map((o) => { const b = o.getBoundingClientRect(); return `${Math.round(b.left)},${Math.round(b.top)}`; }).join(";") : ""}|${Math.round(avoidRef.current ? (resolveAnchor(avoidRef.current, doc)?.getBoundingClientRect().bottom ?? 0) : 0)}|${Math.round(r.left)}|${Math.round(r.top)}|${Math.round(r.right)}|${Math.round(r.bottom)}|${doc.documentElement.clientWidth}|${win.innerHeight}|${el.offsetWidth}|${el.scrollHeight}`;
      if (key === seen) return;
      seen = key;
      const av = avoidRef.current ? resolveAnchor(avoidRef.current, doc)?.getBoundingClientRect().bottom : undefined;
      const obs = obstaclesRef.current ? [...doc.querySelectorAll(obstaclesRef.current)].filter((o) => !el.contains(o)).map((o) => o.getBoundingClientRect()).filter((b) => b.width > 0) : [];
      const p = placePopover(el, r, alignRef.current, preferRef.current, av, obs);
      el.style.left = `${Math.round(p.left)}px`;
      el.style.top = `${Math.round(p.top)}px`;
    };
    const schedule = () => {
      if (!raf) raf = win.requestAnimationFrame(update);
    };
    let watched: Element | null = null;
    const ro = new win.ResizeObserver(schedule);
    ro.observe(el);
    ro.observe(doc.documentElement);
    // La toile est redessinée (planche rechargée, barre déplacée) : l'ancre a pu changer de place ou être remplacée.
    const mo = new win.MutationObserver((records) => {
      if (records.some((m) => !el.contains(m.target))) schedule();
    });
    mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "data-selected", "hidden"] });
    win.addEventListener("scroll", schedule, true);
    win.addEventListener("resize", schedule);
    update();
    if (focusFirst && !el.contains(doc.activeElement)) el.querySelector<HTMLElement>("input, button:not([disabled]), select, textarea")?.focus({ preventScroll: true });
    return () => {
      if (raf) win.cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      win.removeEventListener("scroll", schedule, true);
      win.removeEventListener("resize", schedule);
    };
  }, [focusFirst]);

  const host = (typeof document !== "undefined" && (document.querySelector(".pe-host") ?? document.body)) || null;
  if (!host) return null;
  // Dans une couche `.pe-layer` (sans taille) comme toutes les barres : les couches voisines (survol d'une case, sélection) voient
  // la fenêtre comme faisant partie de l'éditeur, jamais comme du contenu du site.
  return createPortal(
    <div className="pe-layer pe-pop-layer">
      <div ref={ref} className={`pe-pop ${className}`} role={role} aria-label={label} data-testid={testId} data-pe-pop="" style={{ right: "auto", ...style }} onKeyDown={onKeyDown} onPointerDown={onPointerDown}>
        {children}
      </div>
    </div>,
    host,
  );
}

/**
 * Valeur d'un réglage montrée par la fenêtre : celle de l'appelant au départ, puis ce qui vient d'être choisi (sans attendre la
 * réécriture de la toile), et de nouveau celle de l'appelant dès qu'elle change (Annuler, rechargement).
 */
export function useLocalValue<T>(value: T): [T, (next: T) => void] {
  const [cur, setCur] = useState(value);
  const sig = JSON.stringify(value ?? null);
  const [seen, setSeen] = useState(sig);
  if (seen !== sig) {
    setSeen(sig);
    setCur(value);
  }
  return [cur, setCur];
}
