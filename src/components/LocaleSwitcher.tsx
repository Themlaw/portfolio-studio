"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { rememberLangChoice } from "@/i18n/choice";
import { Link, getPathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { saveRecord, takeSnap } from "@/lib/lang-scroll";

/**
 * Sélecteur de langue. Les slugs étant localisés en base, la page courante
 * fournit son chemin dans chaque langue (`alternates`) : /fr/personnages ↔
 * /en/characters.
 *
 * Lot 126 : UN SEUL contrôle. Il n'y a que deux langues, donc toute la case « FR / EN » est le lien vers l'AUTRE langue (clic n'importe
 * où dans la case, y compris entre les lettres et sur la barre oblique) : « English version » en français, « Version française » en
 * anglais. L'aspect ne change pas (la langue courante reste en avant) ; la zone de clic dépasse la case de quelques pixels (pseudo-élément,
 * sans changer la mise en page) pour atteindre 44 px de haut. Le clic mémorise le choix du visiteur (cookie, src/i18n/choice.ts) : c'est la
 * seule façon d'arriver en anglais sur « / » ; jamais d'après le navigateur.
 *
 * Lot 87 : la page garde sa place au changement de langue (src/lib/lang-scroll.ts). Clic simple seulement : un clic
 * avec Ctrl / Cmd / Maj, ou du milieu, ouvre la page à part comme avant.
 */
export default function LocaleSwitcher({ alternates }: { alternates: Record<AppLocale, string> }) {
  const t = useTranslations("locale");
  const params = useParams();
  const current = (params?.locale as AppLocale) ?? routing.defaultLocale;
  const router = useRouter();
  const other: AppLocale = routing.locales.find((l) => l !== current) ?? routing.defaultLocale;

  const onClick = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    rememberLangChoice(other);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const snap = takeSnap(window);
    // Page sans équivalent (404) : navigation normale, en haut.
    if (!snap) return;
    e.preventDefault();
    const href = alternates[other] ?? "/";
    saveRecord(snap, getPathname({ href, locale: other }));
    router.push(href, { locale: other, scroll: false });
  };

  return (
    <Link
      href={alternates[other] ?? "/"}
      locale={other}
      hrefLang={other}
      lang={other}
      onClick={onClick}
      aria-label={t("switchTo")}
      data-locale-switcher=""
      className="group relative -mx-2 flex items-center gap-1 whitespace-nowrap px-2 text-[0.7rem] after:absolute after:inset-x-0 after:-inset-y-4 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {routing.locales.map((locale, i) => {
        const active = locale === current;
        return (
          <span key={locale} className="flex items-center gap-1" aria-hidden="true">
            {i > 0 && <span className="text-line">/</span>}
            <span
              className={`caption-text font-caption tracking-[0.18em] uppercase transition-colors ${
                active ? "text-ink" : "text-ink-soft group-hover:text-primary"
              }`}
              data-active={active ? "true" : undefined}
            >
              {t(locale)}
            </span>
          </span>
        );
      })}
    </Link>
  );
}
