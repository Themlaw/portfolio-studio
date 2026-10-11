/** Indice de défilement commun aux trois heros.
 *  `label` : texte de l'indicateur (modifiable sur la toile, bloc « hero »).
 *  `mark` : repères d'édition en place et style local du libellé.
 *  `ink` : libellé à l'encre plutôt qu'en couleur d'étiquette (posé sur un décor). */
export default function ScrollHint({
  label,
  mark = {},
  className = "",
  ink = false,
}: {
  label: string;
  mark?: Record<string, unknown>;
  className?: string;
  ink?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 text-ink-soft ${className}`}>
      <span className={`eyebrow ${ink ? "text-ink" : ""}`} {...mark}>
        {label}
      </span>
      <span aria-hidden="true" className="scroll-hint inline-block">
        <svg width="14" height="22" viewBox="0 0 14 22" fill="none">
          <path
            d="M7 1v19m0 0 5-5m-5 5-5-5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}
