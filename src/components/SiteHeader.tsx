"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import LocaleSwitcher from "@/components/LocaleSwitcher";
import { Link, usePathname } from "@/i18n/navigation";
import type { AppPathname } from "@/i18n/routing";

const NAV: { href: AppPathname; key: "characters" | "backgrounds" | "animation" | "about" }[] = [
  { href: "/characters", key: "characters" },
  { href: "/backgrounds", key: "backgrounds" },
  { href: "/animation", key: "animation" },
  { href: "/about", key: "about" },
];

export default function SiteHeader() {
  const t = useTranslations("nav");
  const tSite = useTranslations("site");
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
          ? "bg-bg/75 backdrop-blur-xl shadow-[0_1px_0_0_var(--color-line)]"
          : "bg-transparent"
      }`}
    >
      <div className="site-header-bar shell flex items-center justify-between gap-6 py-4 md:py-5">
        <Link
          href="/"
          className="site-brand font-display text-lg md:text-xl leading-none text-ink hover:text-primary transition-colors"
        >
          {tSite("name")}
        </Link>

        <nav
          aria-label={t("label")}
          className="hidden md:flex items-center gap-7"
        >
          {NAV.map(({ href, key }) => {
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
                {t(key)}
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
          <LocaleSwitcher />
        </nav>

        <div className="flex items-center gap-4 md:hidden">
          <LocaleSwitcher />
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
          {NAV.map(({ href, key }) => (
            <li key={href} className="border-b border-line last:border-0">
              <Link
                href={href}
                className="block py-3 font-display text-2xl text-ink hover:text-primary transition-colors"
              >
                {t(key)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
