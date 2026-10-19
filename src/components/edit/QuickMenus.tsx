"use client";

/**
 * Réglages rapides de la barre d'un composant (lot 40), deux fenêtres blanches au style de « Cadre » :
 * - « Taille » d'une image seule (page ou planche) : Normale (le plafond de hauteur d'avant, valeur par défaut) ou Grande
 *   (plafond levé, toute la largeur du cadre), et Gauche / Centre / Droite. La légende suit l'image. `look.imageSize` / `look.imageAlign`.
 * - « Espace » au-dessus d'un bloc ou d'un composant de planche : Aucun / S / M / Auto. C'est `look.spaceTop` (le même
 *   réglage que « Espace en haut » du panneau et que la poignée de la page), sans nouveau champ.
 * Chaque choix part aussitôt (`sendLook` : page, composant de planche ou case, annulable).
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { cleanLook, IMAGE_ALIGN_LABELS, IMAGE_ALIGNS, readLook, SPACE_LABELS, type ImageAlign, type Look, type Space } from "@/lib/look";

import { lookOf, sendLook } from "./LookLayer";
import { postIntent } from "./optimistic";
import { useDismiss } from "./useDismiss";

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
      <p className="sm-hint">{large ? "Grande : l'image prend toute la largeur du cadre. " : "Normale : l'image ne dépasse pas la hauteur de l'écran. "}La légende suit l&apos;image.</p>
    </div>
  );
}

export function SpaceControls({ look, onChange }: { look: Look; onChange: (patch: Partial<Look>) => void }) {
  const current = look.spaceTop;
  return (
    <div data-testid="space-controls" className="tc" style={{ gap: 8 }}>
      <div className="tc-row">
        <span className="sm-label">Au-dessus</span>
        <span className="tc-seg" role="radiogroup" aria-label="Espace au-dessus">
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
      <p className="sm-hint">Espace entre ce composant et celui du dessus. Auto : l&apos;espace du thème.</p>
    </div>
  );
}

/**
 * Page : abscisse (dans le bloc positionné qui contient la fenêtre) qui pose la fenêtre sous le bouton `data-testid="<testId>"`, centrée
 * dessus sans sortir du cadre. Sans bouton trouvé (ou `enabled` faux) : undefined, la fenêtre garde sa place par défaut.
 */
export function useAnchoredLeft(ref: RefObject<HTMLElement | null>, testId: string, enabled: boolean, dep?: string): number | undefined {
  const [x, setX] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!enabled) return;
    const menu = ref.current;
    const parent = menu?.offsetParent;
    const btn = parent?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (!menu || !parent || !btn) return;
    const p = parent.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const v = b.left - p.left + b.width / 2 - menu.offsetWidth / 2;
    setX(Math.max(6, Math.min(v, p.width - menu.offsetWidth - 6)));
  }, [ref, testId, enabled, dep]);
  return x;
}

export type QuickKind = "size" | "space";

/** Fenêtre « Taille » ou « Espace » d'un bloc de la page ou d'un composant de la planche (`uid`). `left` : positionnement libre (planche). */
export default function QuickMenu({ uid, kind, top, left, onClose, onChanged }: { uid: string; kind: QuickKind; top: number; left?: number; onClose: () => void; onChanged?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const pageLeft = useAnchoredLeft(ref, `${kind}-button`, left === undefined, uid);
  const [look, setLook] = useState<Look>(() => currentLook(uid));
  const change = (patch: Partial<Look>) => {
    const next = { ...look, ...patch };
    for (const k of Object.keys(patch) as (keyof Look)[]) if (patch[k] === undefined) delete next[k];
    setLook(next);
    writeLook(uid, next);
    onChanged?.();
  };
  const body: ReactNode = kind === "size" ? <SizeControls look={look} onChange={change} /> : <SpaceControls look={look} onChange={change} />;
  return (
    <div ref={ref} className="sm tc" role="dialog" aria-label={kind === "size" ? "Taille de l'image" : "Espace au-dessus"} data-testid={`${kind}-menu`} style={left !== undefined ? { top, left, right: "auto" } : pageLeft !== undefined ? { top, left: pageLeft, right: "auto" } : { top }}>
      {body}
    </div>
  );
}

/** Bouton « Taille » / « Espace » de la barre d'un bloc de la page. */
export function QuickButton({ uid, kind, open, onToggle }: { uid: string; kind: QuickKind; open: boolean; onToggle: () => void }) {
  const look = lookOf(uid);
  const set = kind === "size" ? Boolean(look.imageSize || look.imageAlign) : look.spaceTop !== undefined;
  return (
    <button type="button" className="pe-tool-text sm-button" aria-haspopup="dialog" aria-expanded={open} data-testid={`${kind}-button`} title={kind === "size" ? "Taille et place de l'image" : "Espace au-dessus de ce composant"} onClick={onToggle}>
      <span className="sm-dot" data-on={set ? "" : undefined} style={set ? { background: "var(--pe-surface)" } : undefined} aria-hidden="true" />
      {kind === "size" ? "Taille" : "Espace"}
    </button>
  );
}
