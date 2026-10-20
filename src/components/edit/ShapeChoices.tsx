/**
 * Étendue et coins d'un aplat (lots 43 et 47b) : les MÊMES boutons, avec leurs pictogrammes, dans la fenêtre « Fond » d'un composant
 * (FondMenu.tsx) et dans la fenêtre « Carte » d'une rubrique (SurfaceMenu.tsx). Présentation seule : l'appelant dit ce qui est coché et
 * ce qu'un clic enregistre. `attr` ajoute des attributs de repère (`data-width`, `data-corners`…) à chaque bouton.
 */
import type { FondStep } from "@/themes/fond";

type Attr = Record<string, string>;

export const SHAPE_STEPS: { step: FondStep; label: string; radius: number }[] = [
  { step: "s", label: "Petit", radius: 4 },
  { step: "m", label: "Moyen", radius: 6 },
  { step: "l", label: "Grand", radius: 8 },
];

/** Mini-schéma : le cadre de la carte, l'aplat en couleur, avec ou sans marge, coins droits ou arrondis. */
export function Mini({ inset, round }: { inset: boolean; round: number }) {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true" focusable="false" className="fond-mini">
      <rect x="0.5" y="0.5" width="21" height="15" rx="2" fill="none" stroke="currentColor" opacity="0.45" />
      <rect x={inset ? 4 : 0.5} y={inset ? 4 : 0.5} width={inset ? 14 : 21} height={inset ? 8 : 15} rx={round} fill="currentColor" />
    </svg>
  );
}

/** « Étendue » : Bord à bord / Avec marge. */
export function ExtentRow({ inset, onPick, label, testid, attr }: { inset: boolean; onPick: (inset: boolean) => void; label: string; testid: string; attr?: (inset: boolean) => Attr }) {
  return (
    <div className="tc-row">
      <span className="sm-label">Étendue</span>
      <span className="tc-seg" role="radiogroup" aria-label={label} data-testid={testid}>
        <button type="button" role="radio" aria-checked={!inset} data-extent="full" {...attr?.(false)} onClick={() => onPick(false)}>
          <Mini inset={false} round={0} /> Bord à bord
        </button>
        <button type="button" role="radio" aria-checked={inset} data-extent="margin" {...attr?.(true)} onClick={() => onPick(true)}>
          <Mini inset round={0} /> Avec marge
        </button>
      </span>
    </div>
  );
}

/** « Coins » : Droits / Petit / Moyen / Grand (`value` « none » = droits). */
export function CornersRow({ value, onPick, label, testid, attr }: { value: "none" | FondStep; onPick: (v: "none" | FondStep) => void; label: string; testid: string; attr?: (v: "none" | FondStep) => Attr }) {
  return (
    <div className="tc-row">
      <span className="sm-label">Coins</span>
      <span className="tc-seg" role="radiogroup" aria-label={label} data-testid={testid}>
        <button type="button" role="radio" aria-checked={value === "none"} data-step="none" {...attr?.("none")} onClick={() => onPick("none")}>
          <Mini inset round={0} /> Droits
        </button>
        {SHAPE_STEPS.map((st) => (
          <button key={st.step} type="button" role="radio" aria-checked={value === st.step} data-step={st.step} {...attr?.(st.step)} onClick={() => onPick(st.step)}>
            <Mini inset round={st.radius} /> {st.label}
          </button>
        ))}
      </span>
    </div>
  );
}
