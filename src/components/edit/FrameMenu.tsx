"use client";

/**
 * Cadre autour d'une photo ou d'une vidéo (lots 34 et 62) : UN seul choix, « Aucun · Cadre du thème · Bordure » (boutons
 * radio : ce qui s'affiche est exactement le choix coché). « Cadre du thème » (le cadre dessiné dans le kit) n'est proposé que si le thème
 * en dessine un. « Bordure » montre l'épaisseur (Fin / Moyen / Épais) et la couleur : « Couleur par défaut » (la couleur du
 * texte du thème : elle suit le thème), une pastille de la palette du site, ou une couleur libre (le sélecteur du lot 29, `ColorPicker`).
 * Sans choix, la photo suit le réglage du site « Cadre du thème sur toutes les photos » (Admin → Thèmes, non par défaut) : c'est ce que
 * le menu coche alors.
 *
 * `FrameControls` est le contenu, partagé par le bouton « Cadre » de la barre d'une image ou d'une vidéo seule / d'une case de grille
 * (réglage `look.frame` du bloc), par la barre d'une image ou d'une vidéo de planche (BoardLayer :
 * `look.slotLook[slug].frame` du bloc planche, par emplacement) et par celle de la Planche libre. La fenêtre est `FrameWindow` (un seul
 * `Popover` ancré au bouton). Chaque choix part aussitôt (intention `look`, annulable). Les pastilles montrent les couleurs du thème par leurs variables, jamais en dur.
 */
import { useMemo, useRef, useState } from "react";

import { parseColor } from "@/lib/color";
import { planFrameSwatches, type Rgb, type SwatchPlan } from "@/lib/frame-swatches";
import { FRAME_DEFAULT_COLOR, FRAME_DEFAULT_WIDTH, FRAME_KIND_LABELS, FRAME_WIDTH_LABELS, FRAME_WIDTHS, frameColorCss, PALETTE_DISPLAY, PALETTE_LABELS, type Frame, type PaletteColor } from "@/lib/look";

import { frameChoiceOf, frameRule, type FrameChoice, type FrameEntry } from "@/themes/frame-library";

import ColorPicker from "./ColorPicker";
import { lookOf } from "./LookLayer";
import Popover, { type PopoverAnchor, useLocalValue } from "./Popover";

import "@/app/admin/typo-controls.css";
import "@/app/admin/surface-menu.css";

/** Couleur d'une pastille = EXACTEMENT celle du cadre (`frameColorCss`, une seule définition : rendu public, toile et menu ne peuvent plus diverger). */
const swatch = (c: PaletteColor) => frameColorCss(c);
const isPalette = (v: string | undefined): v is PaletteColor => (PALETTE_DISPLAY as readonly string[]).includes(v ?? "");

/** Le thème en ligne dessine-t-il un cadre (kit) ? La toile porte `data-kit-frame` sur `<html>` comme le site. */
const themeHasFrame = () => typeof document !== "undefined" && document.documentElement.hasAttribute("data-kit-frame");
/** Réglage du site « Cadre du thème sur toutes les photos » : posé sur `.site-frame` par le cadre du site. */
const siteFramesAll = () => typeof document !== "undefined" && document.querySelector("[data-frame-all]") !== null;

type Choice = "none" | "theme" | "band" | "custom";

/** Couleur calculée d'une valeur CSS (variable du thème comprise) dans le document de la toile. */
function computedRgb(css: string): Rgb | undefined {
  const probe = document.createElement("span");
  probe.style.color = css;
  document.body.appendChild(probe);
  const c = parseColor(getComputedStyle(probe).color);
  probe.remove();
  return c && c.a === 1 ? { r: c.r, g: c.g, b: c.b } : undefined;
}

/**
 * Pastilles à montrer (lot 95) : on lit les couleurs du thème actif et on retire les doublons (même couleur) et les teintes confondues avec le
 * fond de la page (cadre invisible) : src/lib/frame-swatches.ts. Hors navigateur, ou si une couleur est illisible : tout est montré.
 */
function readSwatchTokens(): { colors: Partial<Record<PaletteColor, Rgb>>; def?: Rgb; page?: Rgb } {
  if (typeof document === "undefined" || !document.body) return { colors: {} };
  const colors: Partial<Record<PaletteColor, Rgb>> = {};
  for (const c of PALETTE_DISPLAY) {
    const rgb = computedRgb(swatch(c));
    if (rgb) colors[c] = rgb;
  }
  return { colors, def: computedRgb(frameColorCss(undefined)), page: computedRgb("var(--t-color-bg)") };
}

/** Cadres de la bibliothèque (lot 74), lus dans la page de la toile (`data-edit-frames`, posé par le cadre du site en vue brouillon). */
function frameCatalog(): FrameChoice[] {
  if (typeof document === "undefined") return [];
  try {
    const raw = document.querySelector("[data-edit-frames]")?.getAttribute("data-edit-frames");
    const list = raw ? (JSON.parse(raw) as FrameChoice[]) : [];
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === "string") : [];
  } catch {
    return [];
  }
}

/** Un cadre qui vient d'être importé depuis ce menu s'affiche tout de suite : sa règle est posée dans la page, le serveur la rendra de toute façon au prochain chargement. */
function liveFrameRule(entry: FrameEntry) {
  let el = document.getElementById("site-frames-live") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "site-frames-live";
    document.head.appendChild(el);
  }
  el.textContent = `${el.textContent ?? ""}\n${frameRule(entry)}`;
}

const FRAME_ACCEPT = "image/png,image/webp,image/avif,image/svg+xml,.png,.webp,.avif,.svg";

/** Un seul choix + (bande) épaisseur et couleur. `value` absent = pas de choix (suit le site) ; `onChange(undefined)` y revient. */
export function FrameControls({ value, onChange, what = "photo" }: { value: Frame | undefined; onChange: (next: Frame | undefined) => void; what?: "photo" | "vidéo" }) {
  const kit = themeHasFrame();
  // Sans choix, ce qui s'affiche est le réglage du site : une photo suit « sur toutes les photos », une vidéo n'a jamais de cadre.
  const implicit: Choice = what === "photo" && kit && siteFramesAll() ? "theme" : "none";
  const shown: Choice = value ? value.kind : implicit;
  const [imported, setImported] = useState<FrameChoice[]>([]);
  const [importing, setImporting] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const library = [...frameCatalog(), ...imported.filter((i) => !frameCatalog().some((c) => c.id === i.id))];
  // Réglages de la bande gardés d'un choix à l'autre (Bande → Aucun → Bande retrouve l'épaisseur et la couleur).
  const [kept, setKept] = useState<{ width?: Frame["width"]; color?: string }>({ width: value?.width, color: value?.color });
  const base = value?.kind === "band" ? { width: value.width, color: value.color } : kept;
  const bandOf = (b: { width?: Frame["width"]; color?: string }): Frame => {
    const f: Frame = { kind: "band", width: b.width ?? FRAME_DEFAULT_WIDTH };
    if (b.color !== undefined) f.color = b.color;
    return f;
  };
  const pickFile = async (file: File) => {
    setProblem(null);
    setImporting(file.name);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/admin/api/cadres", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; entry?: FrameEntry } | null;
      if (!json?.ok || !json.entry) return setProblem(json?.message ?? "L'envoi a échoué. Réessaie avec un autre fichier.");
      liveFrameRule(json.entry);
      setImported((cur) => [...cur, frameChoiceOf(json.entry!)]);
      onChange({ kind: "custom", id: json.entry.id });
    } catch {
      setProblem("L'envoi a échoué. Réessaie avec un autre fichier.");
    } finally {
      setImporting(null);
    }
  };
  const choose = (kind: Choice) => {
    if (kind === "band") return onChange(bandOf(base));
    if (kind === "custom") {
      setKept(base);
      return library[0] ? onChange({ kind: "custom", id: library[0].id }) : fileInput.current?.click();
    }
    setKept(base);
    onChange({ kind });
  };
  const patch = (p: Partial<Frame>) => {
    const next = { ...bandOf(base), ...p } as Frame;
    if (next.color === undefined) delete next.color;
    setKept({ width: next.width, color: next.color });
    onChange(next);
  };
  const kinds: Choice[] = kit || value?.kind === "theme" ? ["none", "theme", "band", "custom"] : ["none", "band", "custom"];
  const bandOn = shown === "band" && value?.kind === "band";
  const custom = bandOn && value.color && !isPalette(value.color) ? value.color : undefined;
  const tokens = useMemo(() => readSwatchTokens(), []);
  const plan: SwatchPlan<PaletteColor> = planFrameSwatches(PALETTE_DISPLAY, tokens.colors, tokens.def, tokens.page, value?.color);
  // Un jeton masqué comme doublon est remplacé par sa jumelle, qui s'affiche cochée : la valeur enregistrée n'est jamais touchée.
  const storedColor = value?.color;
  const twinOfStored = isPalette(storedColor) ? plan.twin[storedColor] : undefined;
  const colorName = !bandOn ? "" : value.color === undefined ? "Couleur par défaut" : isPalette(value.color) ? PALETTE_LABELS[value.color] : "Couleur libre";
  return (
    <div className="fr" data-testid="frame-controls">
      <span className="tc-seg fr-kinds" role="radiogroup" aria-label={`Cadre de la ${what}`}>
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={shown === k} data-frame-kind={k} onClick={() => shown !== k && choose(k)}>
            {FRAME_KIND_LABELS[k]}
          </button>
        ))}
      </span>
      {shown === "none" && <p className="sm-hint">{what === "photo" ? "Cette photo n'a pas de cadre." : "Cette vidéo n'a pas de cadre."}</p>}
      {shown === "theme" && (
        <p className="sm-hint">
          {kit ? `Le cadre dessiné dans ton thème entoure ${what === "photo" ? "la photo" : "la vidéo"}. Il ne change ni la taille ni la place.` : "Ton thème actuel ne dessine pas de cadre : rien ne s'affiche."}
          {!value && " (Réglage du site : cadre du thème sur toutes les photos.)"}
        </p>
      )}
      {shown === "custom" && (
        <div className="fr-custom" data-testid="frame-custom">
          {library.length > 0 ? (
            <div className="fr-lib" role="radiogroup" aria-label="Cadres de la bibliothèque">
              {library.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={value?.kind === "custom" && value.id === c.id} className="fr-thumb" data-frame-id={c.id} title={c.name} onClick={() => onChange({ kind: "custom", id: c.id })}>
                  <span className="fr-thumb-img" aria-hidden="true" style={{ backgroundImage: `url("${c.thumb}")` }} />
                  <span className="fr-thumb-name">{c.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="sm-hint">Ta bibliothèque de cadres est vide : importe un premier cadre.</p>
          )}
          {value?.kind === "custom" && !library.some((c) => c.id === value.id) && <p className="sm-hint" data-testid="frame-missing">Ce cadre n&apos;est plus dans la bibliothèque : choisis-en un autre.</p>}
          <button type="button" className="sm-link" data-testid="frame-import" disabled={importing !== null} onClick={() => fileInput.current?.click()}>
            {importing ? `Envoi de « ${importing} »…` : "+ Importer un cadre"}
          </button>
          {problem && (
            <p className="sm-hint" role="alert" data-testid="frame-import-error">
              {problem}
            </p>
          )}
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept={FRAME_ACCEPT}
        hidden
        data-testid="frame-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pickFile(f);
        }}
      />
      {bandOn && (
        <>
          <div className="tc-row">
            <span className="sm-label">Épaisseur</span>
            <span className="tc-seg" role="radiogroup" aria-label="Épaisseur du cadre">
              {FRAME_WIDTHS.map((w) => (
                <button key={w} type="button" role="radio" aria-checked={(value.width ?? FRAME_DEFAULT_WIDTH) === w} data-frame-width={w} onClick={() => patch({ width: w })}>
                  {FRAME_WIDTH_LABELS[w]}
                </button>
              ))}
            </span>
          </div>
          <div className="tc-row">
            <span className="sm-label">Couleur</span>
            <span className="tc-swatches" role="radiogroup" aria-label="Couleur du cadre">
              <button
                type="button"
                role="radio"
                aria-checked={value.color === undefined || twinOfStored === "default"}
                aria-label="Couleur par défaut"
                title="Couleur par défaut : celle du texte du thème (dans une carte ou sur un fond de couleur : celle du texte de la carte)"
                className="tc-swatch"
                data-frame-color="default"
                style={{ background: frameColorCss(undefined) }}
                onClick={() => patch({ color: undefined })}
              />
              {plan.shown.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={value.color === c || twinOfStored === c}
                  aria-label={PALETTE_LABELS[c]}
                  title={PALETTE_LABELS[c]}
                  className="tc-swatch"
                  data-frame-color={c}
                  style={{ background: swatch(c) }}
                  onClick={() => patch({ color: c })}
                />
              ))}
              <ColorPicker value={custom} onChange={(color) => patch({ color })} swatch={swatch} />
            </span>
          </div>
          <p className="sm-hint fr-color-name" data-testid="frame-color-name">
            {colorName}
            {value.color === undefined && ` (${PALETTE_LABELS[FRAME_DEFAULT_COLOR].toLowerCase()} du thème)`}
          </p>
        </>
      )}
      {value && what === "photo" && kit && (
        <button type="button" className="sm-link" data-testid="frame-follow-site" onClick={() => onChange(undefined)}>
          Suivre le réglage du site
        </button>
      )}
    </div>
  );
}

/** Bouton « Cadre » de la barre d'outils d'une image : pastille de la couleur du cadre (vide : pas de cadre). */
export function FrameButton({ uid, open, onToggle, what = "photo" }: { uid: string; open: boolean; onToggle: () => void; what?: "photo" | "vidéo" }) {
  const frame = lookOf(uid).frame;
  // Pastille pleine dès qu'un cadre est choisi (la couleur de la bande, sinon la teinte d'accent du menu).
  const shown = frame && frame.kind !== "none" ? frame : undefined;
  return (
    <button type="button" className="pe-tool-text sm-button" aria-haspopup="dialog" aria-expanded={open} data-testid="frame-button" title={what === "vidéo" ? "Cadre autour de la vidéo" : "Cadre autour de la photo"} onClick={onToggle}>
      <span className="sm-dot" data-on={shown ? "" : undefined} style={shown?.kind === "band" ? { background: frameColorCss(shown.color) } : undefined} aria-hidden="true" />
      Cadre
    </button>
  );
}

/**
 * Fenêtre « Cadre » (lot 65) : UNE seule, ancrée au bouton `anchor`, pour tous les conteneurs. Chaque appelant donne sa valeur et son
 * écriture : page (`look.frame` du bloc, `sendLook`), case de grille (même chose), composant de planche (`props.look.frame` du projet,
 * écriture `item-media-look`), image de carrousel (`look.slotLook[slug].frame`) et image de Planche libre (`items[].frame`).
 */
export default function FrameWindow({ anchor, value, onChange, onClose, what = "photo", testId }: { anchor: PopoverAnchor; value: Frame | undefined; onChange: (next: Frame | undefined) => void; onClose: () => void; what?: "photo" | "vidéo"; testId?: string }) {
  const [cur, setCur] = useLocalValue(value);
  return (
    <Popover anchor={anchor} label={`Cadre de la ${what}`} testId={testId} onClose={onClose}>
      <FrameControls
        value={cur}
        onChange={(next) => {
          setCur(next);
          onChange(next);
        }}
        what={what}
      />
    </Popover>
  );
}
