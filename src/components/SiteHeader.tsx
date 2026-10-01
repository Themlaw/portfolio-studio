"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import LocaleSwitcher from "@/components/LocaleSwitcher";
import { Link, usePathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

/** Entrée de menu : chemin sans langue et libellé, construits depuis la base. */
export type HeaderNavItem = { href: string; label: string };

export default function SiteHeader({
  siteName,
  nav,
  alternates,
}: {
  siteName: string;
  nav: HeaderNavItem[];
  /** Chemin de la page courante dans chaque langue (sélecteur de langue). */
  alternates: Record<AppLocale, string>;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  // Le menu mobile est « ouvert pour une page donnée » : naviguer le referme
  // sans effet (setState dans un effect = rendus en cascade).
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`site-header sticky top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-500 ease-soft ${
        scrolled
          ? "bg-bg/92 backdrop-blur-xl shadow-[0_1px_0_0_var(--color-line)]"
          : "bg-transparent"
      }`}
    >
      <div className="site-header-bar shell flex items-center justify-between gap-6 py-4 md:py-5">
        <Link
          href="/"
          className="site-brand font-display text-lg md:text-xl leading-none text-ink hover:text-primary transition-colors"
        >
          {siteName}
        </Link>

        <nav
          aria-label={t("label")}
          className="hidden md:flex items-center gap-7"
        >
          {nav.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`caption-text relative font-caption text-[0.7rem] tracking-[0.18em] uppercase transition-colors ${
                  active ? "text-ink" : "text-ink-soft hover:text-primary"
                }`}
              >
                {label}
                <span
                  aria-hidden="true"
                  className={`absolute -bottom-2 left-0 h-px bg-secondary transition-all duration-500 ease-soft ${
                    active ? "w-full" : "w-0"
                  }`}
                />
              </Link>
            );
          })}
          <span aria-hidden="true" className="h-4 w-px bg-line" />
          <LocaleSwitcher alternates={alternates} />
        </nav>

        <div className="flex items-center gap-4 md:hidden">
          <LocaleSwitcher alternates={alternates} />
          <button
            type="button"
            onClick={() => setOpenOn(open ? null : pathname)}
            aria-expanded={open}
            aria-controls="nav-mobile"
            className="caption-text font-caption text-[0.7rem] tracking-[0.18em] uppercase text-ink-soft hover:text-primary transition-colors"
          >
            {open ? t("close") : t("menu")}
          </button>
        </div>
      </div>

      <nav
        id="nav-mobile"
        aria-label={t("label")}
        hidden={!open}
        className="md:hidden bg-bg/95 backdrop-blur-xl border-t border-line"
      >
        <ul className="shell flex flex-col py-3">
          {nav.map(({ href, label }) => (
            <li key={href} className="border-b border-line last:border-0">
              <Link
                href={href}
                className="block py-3 font-display text-2xl text-ink hover:text-primary transition-colors"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
