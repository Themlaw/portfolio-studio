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

export type AddChoice = { kind: "starter"; starter: TextStarter } | { kind: "block"; key: string } | { kind: "carousel" };

export default function AddSectionDialog({
  open,
  catalog,
  where,
  present,
  onPick,
  onClose,
}: {
  open: boolean;
  catalog: BlockCatalogEntry[];
  /** Types déjà sur la page : un composant « une seule fois par page » (l'Ouverture) est grisé, avec l'explication. */
  present: ReadonlySet<string>;
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
                {g.entries.map((c) => {
                  const taken = Boolean(c.single) && present.has(c.type);
                  return (
                    <li key={c.key} className={c.models.length || taken ? "ve-card-wrap" : undefined}>
                      <button type="button" className="ve-card ve-add-card" data-type={c.type} data-key={c.key} disabled={taken} onClick={() => onPick({ kind: "block", key: c.key })}>
                        <BlockThumb type={c.type} preset={c.key} />
                        <span>
                          <strong>{c.label}</strong>
                          <span className="ve-card-desc">{c.description}</span>
                        </span>
                      </button>
                      {taken && <p className="ve-card-note">{c.single}</p>}
                      {c.models.length > 0 && (
                        <div className="ve-models" role="group" aria-label={`Modèles de départ : ${c.label}`}>
                          <span className="ve-models-title">Modèles :</span>
                          {c.models.map((m) => (
                            <button key={m.key} type="button" className="ve-model" data-key={m.key} data-type={m.type} title={m.description} onClick={() => onPick({ kind: "block", key: m.key })}>
                              {m.short ?? m.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
                {g.id === "media" && (
                  // « Images qui défilent » vit dans un bloc « Projet » : même carte que dans le panneau « Ajouter ».
                  <li>
                    <button type="button" className="ve-card ve-add-card" data-type="board-strip" data-key="board-strip" onClick={() => onPick({ kind: "carousel" })}>
                      <BlockThumb type="image" preset="board-strip" />
                      <span>
                        <strong>Images qui défilent</strong>
                        <span className="ve-card-desc">Un carrousel d&apos;images et de vidéos de ta médiathèque, dans un bloc « Projet ».</span>
                      </span>
                    </button>
                  </li>
                )}
              </ul>
            </section>
          ))}
          <div className="a-dialog-actions">
            <button type="button" className="a-btn" onClick={onClose}>
              Fermer
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
