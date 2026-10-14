"use client";

/**
 * « Ajouter une rubrique » (lot 17c) : le choix illustré ouvert par « + Ajouter une rubrique » (bas de page),
 * le « + » entre deux rubriques, ou une case vide d'une grille. Les composants sont rangés en groupes à en-tête
 * (src/blocks/groups.ts, la même source que le panneau « Ajouter ») : « Texte » (Texte, Titre et Titre + texte,
 * c'est ce qu'on cherche le plus souvent) en premier. Un choix ferme
 * la fenêtre ; l'ajout et l'édition en place du texte d'aide sont faits par l'éditeur (VisualEditor).
 */
import { useEffect, useMemo, useRef } from "react";

import { pickerGroups } from "@/blocks/groups";
import { STARTER_LIST, type TextStarter } from "@/blocks/help-text";
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
  const groups = useMemo(() => pickerGroups(catalog, STARTER_LIST), [catalog]);
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
          {groups.map((g) => (
            <section key={g.id} className="ve-group" data-group={g.id} aria-label={g.label}>
              <h3 className="ve-group-title">{g.label}</h3>
              <ul className="ve-add-grid" aria-label={g.label}>
                {g.starters.map((st) => (
                  <li key={st.key}>
                    <button type="button" className="ve-card ve-add-card" data-starter={st.key} onClick={() => onPick({ kind: "starter", starter: st.key as TextStarter })}>
                      <BlockThumb type="rich-text" preset={st.key} />
                      <span>
                        <strong>{st.label}</strong>
                        <span className="ve-card-desc">{st.description}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {g.entries.map((c) => (
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
            </section>
          ))}
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
