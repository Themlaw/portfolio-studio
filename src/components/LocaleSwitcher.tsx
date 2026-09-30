"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { usePathname, Link } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";

export default function LocaleSwitcher() {
  const t = useTranslations("locale");
  const pathname = usePathname();
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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              href={pathname as any}
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
