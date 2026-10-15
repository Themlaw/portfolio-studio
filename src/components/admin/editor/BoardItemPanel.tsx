"use client";

/**
 * Réglages d'un composant de la planche d'un projet (lot 31), dans l'onglet Réglages de l'éditeur : les
 * mêmes formulaires que pour la rubrique du même type sur une page (Grille, Image, Vidéo, Texte), branchés
 * sur le contenu de la planche (qui appartient au projet) au lieu de la page. La bande « Images qui
 * défilent » n'a pas de réglage : ses images se gèrent sur la planche.
 */
import { useState, type ReactNode } from "react";

import { MediaPicker } from "@/app/admin/_fields";
import { BlockEditorContext } from "@/blocks/editor-context";
import type { EditorContext } from "@/blocks/editor-types";
import { BOARD_ITEM_LABELS, BOX_ALIGNS, BOX_MIN, BOX_PRESETS, MAX_GRID_CHILDREN, MAX_RAIL_MEDIA, type BoardBox, type BoardItemType } from "@/blocks/board-layout";
import { cleanLook, readLook } from "@/lib/look";

import { BlockLookPanel } from "./LookPanel";
import { MediaPickerDialog } from "@/components/admin/MediaLibrary";

type Props = Record<string, unknown>;
type Kid = { uid: string; type: "image" | "video-single"; props: Props };

let n = 0;
const kidUid = () => `g${Date.now().toString(36)}${(++n).toString(36)}`;

/** Images et vidéos d'une grille : choisies dans la médiathèque, dans l'ordre. */
function GridContent({ props, onChange, context }: { props: Props; onChange: (next: Props) => void; context: EditorContext }) {
  const kids = (Array.isArray(props.children) ? props.children : []) as Kid[];
  const set = (next: Kid[]) => onChange({ ...props, children: next });
  const move = (i: number, d: -1 | 1) => {
    const next = kids.slice();
    const [k] = next.splice(i, 1);
    next.splice(i + d, 0, k);
    set(next);
  };
  return (
    <section className="ve-board-kids" aria-label="Contenu de la grille">
      <h3 className="a-subhead">Images et vidéos de la grille</h3>
      {kids.length === 0 && <p className="ve-hint">Rien pour le moment : ajoute une image ou une vidéo de ta médiathèque.</p>}
      <ol className="ve-board-kid-list">
        {kids.map((k, i) => (
          <li key={k.uid}>
            <MediaPicker
              label={k.type === "video-single" ? `Vidéo ${i + 1}` : `Image ${i + 1}`}
              kind={k.type === "video-single" ? "video" : undefined}
              value={k.props.mediaId as number | undefined}
              onChange={(v) => set(kids.map((x, j) => (j === i ? { ...x, props: { ...x.props, mediaId: v } } : x)))}
              context={context}
            />
            <div className="ve-board-kid-tools" role="group" aria-label={`Élément ${i + 1}`}>
              <button type="button" className="a-icon-btn" aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="a-icon-btn" aria-label="Descendre" disabled={i === kids.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button type="button" className="a-icon-btn a-danger-text" aria-label="Retirer" onClick={() => set(kids.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="ve-board-kid-add">
        <button type="button" className="a-btn" disabled={kids.length >= MAX_GRID_CHILDREN} data-testid="board-grid-add-image" onClick={() => set([...kids, { uid: kidUid(), type: "image", props: { width: "wide" } }])}>
          + Ajouter une image
        </button>
        <button type="button" className="a-btn" disabled={kids.length >= MAX_GRID_CHILDREN} data-testid="board-grid-add-video" onClick={() => set([...kids, { uid: kidUid(), type: "video-single", props: { variant: "card", mode: "player" } }])}>
          + Ajouter une vidéo
        </button>
      </div>
    </section>
  );
}

const ALIGN_LABELS = { left: "Aligner à gauche", center: "Centrer", right: "Aligner à droite" } as const;

/** Pictogramme d'alignement : une colonne claire posée à gauche, au centre ou à droite d'un cadre. */
function AlignIcon({ align }: { align: "left" | "center" | "right" }) {
  const x = align === "left" ? 3 : align === "center" ? 9 : 15;
  return (
    <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden="true">
      <rect x="1" y="1" width="22" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x={x} y="4" width="6" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

/**
 * Largeur et alignement : UN seul bloc pour tous les composants de la planche (lot 31b). Préréglages (Petite,
 * Moyenne, Grande, Pleine largeur), curseur fin de 20 à 100 %, et Gauche / Centre / Droite (utile quand le composant
 * ne prend pas toute la largeur). Sans réglage : le rendu d'avant. Sur téléphone, le composant reprend toute la largeur.
 */
function BoxField({ box, onChange }: { box: BoardBox | undefined; onChange: (next: BoardBox | null) => void }) {
  const width = box?.width ?? 100;
  const align = box?.align ?? "center";
  const apply = (w: number, a = box?.align) => onChange(w >= 100 && !a ? null : { width: w, ...(a ? { align: a } : {}) });
  return (
    <section className="ve-box-field" aria-label="Largeur et alignement" data-testid="box-field">
      <h3 className="a-subhead">Largeur et alignement</h3>
      <div className="ve-box-presets" role="radiogroup" aria-label="Largeur">
        {BOX_PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={width === p.width} data-preset={p.id} className="a-btn a-btn-small" onClick={() => apply(p.width)}>
            {p.label}
          </button>
        ))}
      </div>
      <label className="ve-box-range">
        <span>Réglage fin : {width} %</span>
        <input type="range" min={BOX_MIN} max={100} step={1} value={width} data-testid="box-width" onChange={(e) => apply(Number(e.target.value))} />
      </label>
      <div className="ve-box-aligns" role="radiogroup" aria-label="Alignement">
        {BOX_ALIGNS.map((a) => (
          <button key={a} type="button" role="radio" aria-checked={align === a} aria-label={ALIGN_LABELS[a]} title={ALIGN_LABELS[a]} data-align={a} className="a-icon-btn" onClick={() => apply(width, a)}>
            <AlignIcon align={a} />
          </button>
        ))}
      </div>
      <p className="a-help">{width >= 100 ? "Pleine largeur : l'alignement ne se voit que si tu réduis la largeur." : "Sur téléphone, le composant reprend toute la largeur."}</p>
    </section>
  );
}

/** Carrousel à liste propre : ses images et vidéos, choisies dans la médiathèque, dans l'ordre. */
function RailContent({ props, onChange, context }: { props: Props; onChange: (next: Props) => void; context: EditorContext }) {
  const ids = (Array.isArray(props.media) ? props.media : []) as number[];
  const [adding, setAdding] = useState<"image" | "video" | null>(null);
  const set = (next: number[]) => onChange({ ...props, media: next });
  const move = (i: number, d: -1 | 1) => {
    const next = ids.slice();
    const [k] = next.splice(i, 1);
    next.splice(i + d, 0, k);
    set(next);
  };
  return (
    <section className="ve-board-kids" aria-label="Contenu du carrousel">
      <h3 className="a-subhead">Images et vidéos du carrousel</h3>
      {ids.length === 0 && <p className="ve-hint">Rien pour le moment : ajoute des images ou des vidéos de ta médiathèque (ou glisse-les depuis l&apos;onglet Médias).</p>}
      <ol className="ve-board-kid-list">
        {ids.map((id, i) => {
          const m = context.media.find((x) => x.id === id);
          return (
            <li key={`${id}-${i}`} data-media-id={id}>
              <span className="a-media-field-thumb">{m?.thumb ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={m.thumb} alt="" /> : <span className="muted">n° {id}</span>}</span>
              <span className="a-media-field-name">{m?.name ?? `Média n° ${id}`}</span>
              <div className="ve-board-kid-tools" role="group" aria-label={`Élément ${i + 1}`}>
                <button type="button" className="a-icon-btn" aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="a-icon-btn" aria-label="Descendre" disabled={i === ids.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="a-icon-btn a-danger-text" aria-label="Retirer" onClick={() => set(ids.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="ve-board-kid-add">
        <button type="button" className="a-btn" disabled={ids.length >= MAX_RAIL_MEDIA} data-testid="board-rail-add-image" onClick={() => setAdding("image")}>
          + Ajouter une image
        </button>
        <button type="button" className="a-btn" disabled={ids.length >= MAX_RAIL_MEDIA} data-testid="board-rail-add-video" onClick={() => setAdding("video")}>
          + Ajouter une vidéo
        </button>
      </div>
      <MediaPickerDialog
        open={adding !== null}
        media={context.media.filter((m) => m.kind === (adding ?? "image"))}
        title={adding === "video" ? "Ajouter une vidéo" : "Ajouter une image"}
        confirmLabel={adding === "video" ? "Utiliser cette vidéo" : "Utiliser cette image"}
        onClose={() => setAdding(null)}
        onPick={(m) => {
          set([...ids, m.id]);
          setAdding(null);
        }}
      />
    </section>
  );
}

export default function BoardItemPanel({
  type,
  props,
  box,
  onChange,
  onBox,
  context,
  editor,
  uid,
  head,
}: {
  type: BoardItemType;
  props: Props;
  box: BoardBox | undefined;
  onChange: (next: Props) => void;
  onBox: (next: BoardBox | null) => void;
  context: EditorContext;
  /** Formulaire du type (registre), le même que sur une page. */
  editor: ReactNode;
  uid: string;
  /** Barre du haut (monter, descendre, supprimer…). */
  head: ReactNode;
}) {
  const projectStrip = type === "strip" && props.source !== "own";
  return (
    <div className="ve-settings" data-testid="board-item-panel" data-type={type}>
      <header className="ve-settings-head">
        <h2>{projectStrip ? "Images du projet" : BOARD_ITEM_LABELS[type]}</h2>
        {head}
      </header>
      <p className="ve-hint">Ce composant appartient au projet : il s&apos;affiche partout où la planche du projet est montrée.</p>
      {projectStrip && <p className="ve-hint">Ce sont les images du projet : ajoute-les, déplace-les et légende-les directement sur la planche.</p>}
      {type === "grid" && <GridContent props={props} onChange={onChange} context={context} />}
      {type === "strip" && !projectStrip && <RailContent props={props} onChange={onChange} context={context} />}
      {type !== "strip" && <BlockEditorContext.Provider value={{ value: props, onChange, errors: {}, context, idPrefix: `ve-bitem-${uid}` }}>{editor}</BlockEditorContext.Provider>}
      <BoxField box={box} onChange={onBox} />
      {type !== "strip" && <BlockLookPanel
        key={uid}
        type={type}
        look={readLook(props.look) ?? {}}
        inCell={false}
        onChange={(next) => {
          const clean = cleanLook(next);
          const { look: _old, ...rest } = props;
          void _old;
          onChange(clean ? { ...rest, look: clean } : rest);
        }}
      />}
    </div>
  );
}
