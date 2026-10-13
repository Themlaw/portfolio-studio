"use client";

/**
 * « Ajouter une rubrique » (lot 17c) : le choix illustré ouvert par « + Ajouter une rubrique » (bas de page),
 * le « + » entre deux rubriques, ou une case vide d'une grille. « Texte » et « Titre + texte » viennent en
 * premier (c'est ce qu'on cherche le plus souvent), suivis des autres composants du catalogue. Un choix ferme
 * la fenêtre ; l'ajout et l'édition en place du texte d'aide sont faits par l'éditeur (VisualEditor).
 */
import { useEffect, useRef } from "react";

import { TEXT_STARTERS, type TextStarter } from "@/blocks/help-text";
import type { BlockCatalogEntry } from "@/blocks/editor-types";

import BlockThumb from "./thumbs";

export type AddChoice = { kind: "starter"; starter: TextStarter } | { kind: "block"; key: string };

export default function AddSectionDialog({
  open,
  catalog,
  where,
  onPick,
  onClose,
}: {
  open: boolean;
  catalog: BlockCatalogEntry[];
  /** Où la rubrique ira (« dans la grille », « entre deux rubriques »…), pour le sous-titre. */
  where: string;
  onPick: (choice: AddChoice) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const others = catalog.filter((c) => !c.hidden && c.key !== "rich-text");
  return (
    <dialog
      ref={ref}
      className="a-dialog ve-add"
      aria-labelledby="ve-add-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <>
          <h2 id="ve-add-title">Ajouter une rubrique</h2>
          <p className="ve-add-where">{where}</p>
          <ul className="ve-add-grid" aria-label="Types de rubrique">
            {(Object.keys(TEXT_STARTERS) as TextStarter[]).map((k) => (
              <li key={k}>
                <button type="button" className="ve-card ve-add-card" data-starter={k} onClick={() => onPick({ kind: "starter", starter: k })}>
                  <BlockThumb type="rich-text" preset={k} />
                  <span>
                    <strong>{TEXT_STARTERS[k].label}</strong>
                    <span className="ve-card-desc">{TEXT_STARTERS[k].description}</span>
                  </span>
                </button>
              </li>
            ))}
            {others.map((c) => (
              <li key={c.key}>
                <button type="button" className="ve-card ve-add-card" data-type={c.type} data-key={c.key} onClick={() => onPick({ kind: "block", key: c.key })}>
                  <BlockThumb type={c.type} preset={c.key} />
                  <span>
                    <strong>{c.label}</strong>
                    <span className="ve-card-desc">{c.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="a-dialog-actions">
            <button type="button" className="a-btn" onClick={onClose}>
              Annuler
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
