"use client";

/**
 * Réglages d'un composant de la planche d'un projet (lot 31), dans l'onglet Réglages de l'éditeur : les
 * mêmes formulaires que pour la rubrique du même type sur une page (Grille, Image, Vidéo, Texte), branchés
 * sur le contenu de la planche (qui appartient au projet) au lieu de la page. La bande « Images qui
 * défilent » n'a pas de réglage : ses images se gèrent sur la planche.
 */
import type { ReactNode } from "react";

import { MediaPicker } from "@/app/admin/_fields";
import { BlockEditorContext } from "@/blocks/editor-context";
import type { EditorContext } from "@/blocks/editor-types";
import { BOARD_ITEM_LABELS, MAX_GRID_CHILDREN, type BoardItemType } from "@/blocks/board-layout";
import { cleanLook, readLook } from "@/lib/look";

import { BlockLookPanel } from "./LookPanel";

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

export default function BoardItemPanel({
  type,
  props,
  onChange,
  context,
  editor,
  uid,
  head,
}: {
  type: BoardItemType;
  props: Props;
  onChange: (next: Props) => void;
  context: EditorContext;
  /** Formulaire du type (registre), le même que sur une page. */
  editor: ReactNode;
  uid: string;
  /** Barre du haut (monter, descendre, supprimer…). */
  head: ReactNode;
}) {
  return (
    <div className="ve-settings" data-testid="board-item-panel" data-type={type}>
      <header className="ve-settings-head">
        <h2>{BOARD_ITEM_LABELS[type]}</h2>
        {head}
      </header>
      <p className="ve-hint">Ce composant appartient au projet : il s&apos;affiche partout où la planche du projet est montrée.</p>
      {type === "grid" && <GridContent props={props} onChange={onChange} context={context} />}
      <BlockEditorContext.Provider value={{ value: props, onChange, errors: {}, context, idPrefix: `ve-bitem-${uid}` }}>{editor}</BlockEditorContext.Provider>
      <BlockLookPanel
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
      />
    </div>
  );
}
