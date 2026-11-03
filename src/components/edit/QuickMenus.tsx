"use client";

/**
 * Réglages rapides de la barre d'un composant (lot 40), deux fenêtres blanches au style de « Cadre » :
 * - « Taille » d'une image seule (page ou planche) : Normale (le plafond de hauteur d'avant, valeur par défaut) ou Grande
 *   (plafond levé, toute la largeur du cadre), et Gauche / Centre / Droite. La légende suit l'image. `look.imageSize` / `look.imageAlign`.
 * - « Espacement » au-dessus d'un bloc ou d'un composant de planche : Aucun / S / M / Auto. C'est `look.spaceTop` (le même
 *   réglage que « Espace en haut » du panneau et que la poignée de la page), sans nouveau champ.
 * Chaque choix part aussitôt (`sendLook` : page, composant de planche ou case, annulable).
 */
import { useState, type ReactNode } from "react";

import { BLOCK_WIDTH_LABELS, BLOCK_WIDTHS, cleanLook, IMAGE_ALIGN_LABELS, IMAGE_ALIGNS, readLook, SIDE_SPACES, SPACE_LABELS, SPACES, type ImageAlign, type Look, type Space } from "@/lib/look";

import { lookOf, sendLook } from "./LookLayer";
import { postIntent } from "./optimistic";
import Popover, { type PopoverAnchor } from "./Popover";

import "@/app/admin/typo-controls.css";
import "@/app/admin/surface-menu.css";

/** Crans proposés sur la barre : Aucun, S, M (les autres restent dans le panneau et sur la poignée). */
export const QUICK_SPACES = ["none", "s", "m"] as const satisfies readonly Space[];

/**
 * La bande « Images qui défilent » d'une planche (`data-edit-bitem-rail`) n'a pas de mise en forme de texte : LookLayer ne la voit pas.
 * Son seul réglage de mise en forme est l'espace au-dessus ; il passe directement par l'écriture de planche `item-look`.
 */
const stripFrame = (uid: string) => document.querySelector<HTMLElement>(`[data-edit-bitem="${CSS.escape(uid)}"][data-edit-bitem-rail]`);
function currentLook(uid: string): Look {
  const strip = stripFrame(uid);
  if (!strip) return lookOf(uid);
  try {
    return readLook(JSON.parse(strip.dataset.editLook ?? "null")) ?? {};
  } catch {
    return {};
  }
}
function writeLook(uid: string, look: Look) {
  const strip = stripFrame(uid);
  if (strip) postIntent({ kind: "bitem-look", board: Number(strip.dataset.board), uid, look: cleanLook(look) ?? null });
  else sendLook(uid, look);
}

/** Valeur courte affichée à côté du libellé de la barre (lot 90), seulement quand le bloc a son propre réglage ; sinon rien (le thème décide). */
export function spaceValue(look: Look): string | undefined {
  return look.spaceTop === undefined ? undefined : look.spaceTop === "none" ? "aucun" : SPACE_LABELS[look.spaceTop];
}
export function sizeValue(look: Look): string | undefined {
  const parts = [look.imageSize === "large" ? "grande" : undefined, look.imageAlign && look.imageAlign !== "center" ? IMAGE_ALIGN_LABELS[look.imageAlign].toLowerCase() : undefined].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

export function SizeControls({ look, onChange }: { look: Look; onChange: (patch: Partial<Look>) => void }) {
  const large = look.imageSize === "large";
  const align: ImageAlign = look.imageAlign ?? "center";
  return (
    <div data-testid="size-controls" className="tc" style={{ gap: 8 }}>
      <div className="tc-row">
        <span className="sm-label">Taille</span>
        <span className="tc-seg" role="radiogroup" aria-label="Taille de l'image">
          <button type="button" role="radio" aria-checked={!large} data-image-size="normal" onClick={() => onChange({ imageSize: undefined })}>
            Normale
          </button>
          <button type="button" role="radio" aria-checked={large} data-image-size="large" onClick={() => onChange({ imageSize: "large" })}>
            Grande
          </button>
        </span>
      </div>
      <div className="tc-row">
        <span className="sm-label">Alignement</span>
        <span className="tc-seg" role="radiogroup" aria-label="Alignement de l'image">
          {IMAGE_ALIGNS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={align === a} data-image-align={a} onClick={() => onChange({ imageAlign: a })}>
              {IMAGE_ALIGN_LABELS[a]}
            </button>
          ))}
        </span>
      </div>
      <p className="sm-hint">{large ? "Grande : l'image prend toute la largeur disponible. " : "Normale : l'image ne dépasse pas la hauteur de l'écran. "}La légende suit l&apos;image.</p>
    </div>
  );
}

export function SpaceControls({ look, onChange }: { look: Look; onChange: (patch: Partial<Look>) => void }) {
  const current = look.spaceTop;
  return (
    <div data-testid="space-controls" className="tc" style={{ gap: 8 }}>
      <div className="tc-row">
        <span className="sm-label">Espacement</span>
        <span className="tc-seg" role="radiogroup" aria-label="Espacement au-dessus">
          {QUICK_SPACES.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={current === k} data-space-top={k} onClick={() => onChange({ spaceTop: k })}>
              {SPACE_LABELS[k]}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={current === undefined || !(QUICK_SPACES as readonly string[]).includes(current)} data-space-top="auto" onClick={() => onChange({ spaceTop: undefined })} title="Espace du thème">
            Auto
          </button>
        </span>
      </div>
      <div className="tc-row">
        <span className="sm-label">Côtés</span>
        <span className="tc-seg" role="radiogroup" aria-label="Espacement intérieur sur les côtés">
          {SIDE_SPACES.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={look.spaceSides === k} data-space-sides={k} onClick={() => onChange({ spaceSides: k })}>
              {SPACE_LABELS[k]}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={look.spaceSides === undefined} data-space-sides="auto" onClick={() => onChange({ spaceSides: undefined })}>
            Auto
          </button>
        </span>
      </div>
      <p className="sm-hint">Espacement intérieur : la distance DANS le fond et la carte, que leur couleur et leur papier peint couvrent. Auto : l&apos;espace du thème. La distance à l&apos;extérieur est dans « Marge ».</p>
    </div>
  );
}

/** Largeur du bloc (lot 107) : Pleine (rien d'écrit) / Large / Moyenne / Étroite. Le fond et la carte du bloc suivent ; ils ne se règlent pas ici. */
export function widthValue(look: Look): string | undefined {
  const parts = [look.width ? BLOCK_WIDTH_LABELS[look.width].toLowerCase() : undefined, look.marginTop ? `haut ${SPACE_LABELS[look.marginTop]}` : undefined, look.marginBottom ? `bas ${SPACE_LABELS[look.marginBottom]}` : undefined].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}
export function WidthControls({ look, onChange }: { look: Look; onChange: (patch: Partial<Look>) => void }) {
  return (
    <div data-testid="width-controls" className="tc" style={{ gap: 8 }}>
      <div className="tc-row">
        <span className="sm-label">Largeur</span>
        <span className="tc-seg" role="radiogroup" aria-label="Largeur du bloc">
          <button type="button" role="radio" aria-checked={look.width === undefined} data-block-width="full" onClick={() => onChange({ width: undefined })}>
            {BLOCK_WIDTH_LABELS.full}
          </button>
          {BLOCK_WIDTHS.map((w) => (
            <button key={w} type="button" role="radio" aria-checked={look.width === w} data-block-width={w} onClick={() => onChange({ width: w })}>
              {BLOCK_WIDTH_LABELS[w]}
            </button>
          ))}
        </span>
      </div>
      {(["marginTop", "marginBottom"] as const).map((k) => (
        <div className="tc-row" key={k}>
          <span className="sm-label">{k === "marginTop" ? "Haut" : "Bas"}</span>
          <span className="tc-seg" role="radiogroup" aria-label={k === "marginTop" ? "Marge extérieure en haut" : "Marge extérieure en bas"}>
            {SPACES.map((sp) => (
              <button key={sp} type="button" role="radio" aria-checked={look[k] === sp} data-margin={`${k === "marginTop" ? "top" : "bottom"}-${sp}`} onClick={() => onChange({ [k]: sp })}>
                {SPACE_LABELS[sp]}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={look[k] === undefined} data-margin={`${k === "marginTop" ? "top" : "bottom"}-auto`} onClick={() => onChange({ [k]: undefined })}>
              Auto
            </button>
          </span>
        </div>
      ))}
      <p className="sm-hint">Marge extérieure : la distance HORS du fond et de la carte, on y voit la page (jamais le papier peint). Largeur pleine : le bloc prend toute la largeur ; sinon il est centré, décollé des bords, avec son fond et sa carte. L&apos;espace à l&apos;intérieur se règle dans « Espacement ».</p>
    </div>
  );
}

export type QuickKind = "size" | "space" | "width";

/** Fenêtre « Taille » ou « Espacement » d'un bloc de la page ou d'un composant de la planche (`uid`), ancrée au bouton `anchor`. */
export default function QuickMenu({ uid, kind, anchor, onClose, onChanged }: { uid: string; kind: QuickKind; anchor: PopoverAnchor; onClose: () => void; onChanged?: () => void }) {
  const [look, setLook] = useState<Look>(() => currentLook(uid));
  const change = (patch: Partial<Look>) => {
    const next = { ...look, ...patch };
    for (const k of Object.keys(patch) as (keyof Look)[]) if (patch[k] === undefined) delete next[k];
    setLook(next);
    writeLook(uid, next);
    onChanged?.();
  };
  const body: ReactNode = kind === "size" ? <SizeControls look={look} onChange={change} /> : kind === "width" ? <WidthControls look={look} onChange={change} /> : <SpaceControls look={look} onChange={change} />;
  return (
    <Popover anchor={anchor} align="center" label={kind === "size" ? "Taille de l'image" : kind === "width" ? "Marge extérieure du bloc" : "Espacement intérieur"} testId={`${kind}-menu`} onClose={onClose}>
      {body}
    </Popover>
  );
}

/** Bouton « Taille » / « Espacement » de la barre : le libellé, puis la valeur posée (texte gris court, rien si le thème décide) d'un bloc de la page. */
export function QuickButton({ uid, kind, open, onToggle }: { uid: string; kind: QuickKind; open: boolean; onToggle: () => void }) {
  const look = lookOf(uid);
  const value = kind === "size" ? sizeValue(look) : kind === "width" ? widthValue(look) : spaceValue(look);
  const label = kind === "size" ? "Taille" : kind === "width" ? "Marge" : "Espacement";
  return (
    <button type="button" className="pe-tool-text sm-button" aria-haspopup="dialog" aria-expanded={open} data-testid={`${kind}-button`} title={kind === "size" ? "Taille et place de l'image" : kind === "width" ? "Marge extérieure : largeur du bloc et distance hors du fond et de la carte" : "Espacement intérieur : distance dans le fond et la carte"} onClick={onToggle}>
      {label}{" "}
      {value && (
        <span className="sm-value" data-testid={`${kind}-value`} title={`${label} : ${value}`}>
          · {value}
        </span>
      )}
    </button>
  );
}
