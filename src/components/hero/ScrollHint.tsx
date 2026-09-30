import { useTranslations } from "next-intl";

/** Indice de défilement commun aux trois heros.
 *  `ink` : libellé à l'encre plutôt qu'en couleur d'étiquette (posé sur un décor). */
export default function ScrollHint({
  className = "",
  ink = false,
}: {
  className?: string;
  ink?: boolean;
}) {
  const t = useTranslations("home.hero");
  return (
    <div className={`flex items-center gap-3 text-ink-soft ${className}`}>
      <span className={`eyebrow ${ink ? "text-ink" : ""}`}>{t("scroll")}</span>
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
