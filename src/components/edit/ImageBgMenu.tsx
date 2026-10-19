"use client";

/**
 * Fond derrière une image (lot 41) : utile pour un PNG détouré, qui montre sinon la couleur de la page. Quatre choix :
 * « Aucun » (transparent, comme avant : valeur par défaut), « Blanc », « Couleur de la carte » (le fond des cartes du thème),
 * ou « Couleur… » (pastilles de la palette du site + couleur libre, le sélecteur du lot 29 : `ColorPicker`).
 *
 * `ImageBgControls` est le contenu, partagé par le bouton « Fond image » de la barre d'une image seule / d'une case de grille
 * (`ImageBgPopup` : réglage `look.imageBg` du bloc), la barre d'une image de planche ou de carrousel (BoardLayer :
 * `look.slotBg` du bloc, par emplacement), celle d'un composant Image de la planche (`BoardImageBgMenu`) et le haut du panneau
 * de l'éditeur. Chaque choix part aussitôt (intention `look`, annulable). Les pastilles montrent les couleurs du thème par
 * leurs variables, jamais en dur.
 */
import { useRef, useState, type CSSProperties } from "react";

import { imageBgCss } from "@/lib/look";

import { ImageBgControls } from "./ImageBgControls";
import { lookOf, sendLook } from "./LookLayer";
import { postIntent } from "./optimistic";
import { useDismiss } from "./useDismiss";

import "@/app/admin/typo-controls.css";
import "@/app/admin/surface-menu.css";

export { ImageBgControls, imageBgName } from "./ImageBgControls";

/** Bouton « Fond image » de la barre d'outils d'une image : pastille de la couleur du fond (vide : aucun fond). */
export function ImageBgButton({ uid, open, onToggle }: { uid: string; open: boolean; onToggle: () => void }) {
  const bg = imageBgCss(lookOf(uid).imageBg);
  return (
    <button type="button" className="pe-tool-text sm-button" aria-haspopup="dialog" aria-expanded={open} data-testid="imgbg-button" title="Fond derrière l'image (utile pour un PNG détouré)" onClick={onToggle}>
      <span className="sm-dot" data-on={bg ? "" : undefined} style={bg ? { background: bg } : undefined} aria-hidden="true" />
      Fond image
    </button>
  );
}

/**
 * Fenêtre « Fond de l'image » d'une image seule ou d'une case de grille (réglage `look.imageBg` du bloc `uid`). `style` : position
 * (sous la barre de la rubrique, ou sous le bouton de la case).
 */
export function ImageBgPopup({ uid, style, onClose, onChanged }: { uid: string; style: CSSProperties; onClose: () => void; onChanged?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const [value, setValue] = useState<string | undefined>(() => lookOf(uid).imageBg);
  const change = (next: string | undefined) => {
    setValue(next);
    sendLook(uid, { ...lookOf(uid), imageBg: next });
    onChanged?.();
  };
  return (
    <div ref={ref} className="sm tc" role="dialog" aria-label="Fond de l'image" data-testid="imgbg-menu" style={style}>
      <ImageBgControls value={value} onChange={change} />
    </div>
  );
}

/**
 * Fond d'un composant Image de la PLANCHE d'un projet (barre du composant, BoardLayer) : même fenêtre, mais le réglage est celui du
 * composant (`props.look.imageBg`), qui appartient au projet : écriture de planche `item-imgbg` (Annuler / Rétablir, version de page).
 */
export function BoardImageBgMenu({ board, uid, initial, top, left, onClose }: { board: number; uid: string; initial: string | undefined; top: number; left: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const [cur, setCur] = useState<string | undefined>(initial);
  const change = (next: string | undefined) => {
    setCur(next);
    postIntent({ kind: "bitem-imgbg", board, uid, bg: next ?? null });
  };
  return (
    <div ref={ref} className="sm tc" role="dialog" aria-label="Fond de l'image" data-testid="imgbg-menu" style={{ top, left, right: "auto" }}>
      <ImageBgControls value={cur} onChange={change} />
    </div>
  );
}
