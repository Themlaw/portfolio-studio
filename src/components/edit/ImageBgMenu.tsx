"use client";

/**
 * Fond derrière une image (lot 41) : utile pour un PNG détouré, qui montre sinon la couleur de la page. Quatre choix :
 * « Aucun » (transparent, comme avant : valeur par défaut), « Blanc », « Couleur de la carte » (le fond des cartes du thème),
 * ou « Couleur… » (pastilles de la palette du site + couleur libre, le sélecteur du lot 29 : `ColorPicker`).
 *
 * `ImageBgControls` est le contenu, partagé par le bouton « Fond image » de la barre d'une image seule / d'une case de grille
 * (réglage `look.imageBg` du bloc), la barre d'une image de planche ou de carrousel (BoardLayer : `look.slotLook[slug].bg` du bloc, par
 * emplacement), celle d'un composant Image de la planche et le haut du panneau de l'éditeur ; la fenêtre est `ImageBgWindow`. Chaque choix part aussitôt
 * (intention `look`, annulable). Les pastilles montrent les couleurs du thème par leurs variables, jamais en dur.
 */
import { imageBgCss } from "@/lib/look";

import { ImageBgControls } from "./ImageBgControls";
import { lookOf } from "./LookLayer";
import Popover, { type PopoverAnchor, useLocalValue } from "./Popover";

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
 * Fenêtre « Fond de l'image » (lot 65) : UNE seule, ancrée au bouton `anchor`, pour tous les conteneurs. Chaque appelant donne sa
 * valeur et son écriture : image seule / case de grille (`look.imageBg`), composant Image de la planche (`item-media-look`), image de
 * carrousel (`look.slotLook[slug].bg`), image de Planche libre (`items[].bg`).
 */
export default function ImageBgWindow({ anchor, value, onChange, onClose, testId = "imgbg-menu" }: { anchor: PopoverAnchor; value: string | undefined; onChange: (next: string | undefined) => void; onClose: () => void; testId?: string }) {
  const [cur, setCur] = useLocalValue(value);
  return (
    <Popover anchor={anchor} label="Fond de l'image" testId={testId} onClose={onClose}>
      <ImageBgControls
        value={cur}
        onChange={(next) => {
          setCur(next);
          onChange(next);
        }}
      />
    </Popover>
  );
}
