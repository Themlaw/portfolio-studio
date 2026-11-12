"use client";

import { useTranslations } from "next-intl";

/**
 * Pastille « description manquante » (texte alternatif de l'image) : une icône avec infobulle (et le texte complet pour les lecteurs
 * d'écran), au lieu du sigle « alt » que personne ne comprenait. Le conteneur donne la classe et la place.
 */
export default function AltMissing({ className }: { className: string }) {
  const t = useTranslations("media");
  return (
    <span className={className} title={t("altMissing")}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.5v4.2M8 10.6v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{t("altMissing")}</span>
    </span>
  );
}
