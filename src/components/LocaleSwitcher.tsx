"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";

/**
 * Sélecteur de langue. Les slugs étant localisés en base, la page courante
 * fournit son chemin dans chaque langue (`alternates`) : /fr/personnages ↔
 * /en/characters.
 */
export default function LocaleSwitcher({ alternates }: { alternates: Record<AppLocale, string> }) {
  const t = useTranslations("locale");
  const params = useParams();
  const current = (params?.locale as AppLocale) ?? routing.defaultLocale;

  return (
    <div
      className="flex items-center gap-1 text-[0.7rem]"
      aria-label={t("label")}
    >
      {routing.locales.map((locale, i) => {
        const active = locale === current;
        return (
          <span key={locale} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden="true" className="text-line">
                /
              </span>
            )}
            <Link
              href={alternates[locale] ?? "/"}
              locale={locale}
              hrefLang={locale}
              aria-current={active ? "true" : undefined}
              className={`caption-text font-caption tracking-[0.18em] uppercase transition-colors ${
                active
                  ? "text-ink"
                  : "text-ink-soft hover:text-primary"
              }`}
            >
              {t(locale)}
            </Link>
          </span>
        );
      })}
    </div>
  );
}
