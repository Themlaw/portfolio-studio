import { OPTIONAL_FIELDS, hasOptionalField, type FieldOpName } from "./optional-fields";
import type { BlockContext } from "./types";

/**
 * Boutons « + Ajouter … » / « Retirer … » d'un bloc, sur la toile seulement (jamais dans le HTML public) : le même
 * geste que « + Ajouter un titre » d'un bloc Texte (lot 19a). Visibles au survol du bloc (`.pe-field-host`), dans la
 * marge haute. `skip` : champs sans objet dans l'état courant du bloc (ex. le bouton e-mail d'un Contact à formulaire).
 */
export function FieldOps({ ctx, type, props, skip = [] }: { ctx: BlockContext; type: string; props: Record<string, unknown>; skip?: FieldOpName[] }) {
  if (!ctx.edit) return null;
  const defs = Object.entries(OPTIONAL_FIELDS[type] ?? {}).filter(([name]) => !skip.includes(name as FieldOpName));
  if (!defs.length) return null;
  return (
    <div className="pe-field-ops" {...(defs.length > 3 ? { "data-many": "" } : {})} {...(ctx.cell ? { "data-cell": "" } : {})}>
      {defs.map(([name, def]) => {
        const has = hasOptionalField(def!, props);
        return (
          <button key={name} type="button" className="pe-field-op" data-edit-field-op={`${has ? "remove" : "add"}-${name}`}>
            {has ? def!.remove : def!.add}
          </button>
        );
      })}
    </div>
  );
}

/**
 * État vide d'un bloc, sur la toile seulement : dit quoi faire et propose l'action (un bouton « + Ajouter … » par
 * champ possible), au lieu d'un cadre muet. Rien côté public : un bloc vide n'y rend rien.
 */
export function EmptyHint({ text, actions }: { text: string; actions: [FieldOpName, string][] }) {
  return (
    <div className="pe-empty-block" lang="fr">
      <p>{text}</p>
      <div className="pe-empty-actions">
        {actions.map(([name, label]) => (
          <button key={name} type="button" className="pe-empty-action" data-edit-field-op={`add-${name}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
