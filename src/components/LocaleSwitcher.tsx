"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Link, getPathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { saveRecord, takeSnap } from "@/lib/lang-scroll";

/**
 * Sélecteur de langue. Les slugs étant localisés en base, la page courante
 * fournit son chemin dans chaque langue (`alternates`) : /fr/personnages ↔
 * /en/characters.
 *
 * Lot 87 : la page garde sa place au changement de langue (src/lib/lang-scroll.ts). Clic simple seulement : un clic
 * avec Ctrl / Cmd / Maj, ou du milieu, ouvre la page à part comme avant ; la langue déjà active garde le lien normal.
 */
export default function LocaleSwitcher({ alternates }: { alternates: Record<AppLocale, string> }) {
  const t = useTranslations("locale");
  const params = useParams();
  const current = (params?.locale as AppLocale) ?? routing.defaultLocale;
  const router = useRouter();

  const keepPlace = (e: ReactMouseEvent<HTMLAnchorElement>, locale: AppLocale) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const snap = takeSnap(window);
    // Page sans équivalent (404) : navigation normale, en haut.
    if (!snap) return;
    e.preventDefault();
    const href = alternates[locale] ?? "/";
    saveRecord(snap, getPathname({ href, locale }));
    router.push(href, { locale, scroll: false });
  };

  return (
    <div
      className="flex items-center gap-1 whitespace-nowrap text-[0.7rem]"
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
              onClick={active ? undefined : (e) => keepPlace(e, locale)}
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
