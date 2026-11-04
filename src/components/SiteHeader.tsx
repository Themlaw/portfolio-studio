"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import LocaleSwitcher from "@/components/LocaleSwitcher";
import Picture from "@/components/Picture";
import SocialIcon from "@/components/SocialIcon";
import { Link, usePathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import type { PictureSources } from "@/lib/images/variants";
import type { Social } from "@/lib/settings";
import { navKeyOf, uniqueKeys } from "@/lib/site-schema";

/** Entrée de menu : chemin sans langue (ou adresse externe) et libellé, construits depuis la base. */
export type HeaderNavItem = { id?: string; href: string; label: string; external?: boolean; pageId?: number };

/** Image du logo choisie dans l'éditeur (lot 26) : remplace la signature du thème et le nom en texte. */
export type HeaderLogo = { src: string; sources: PictureSources | null; width: number; height: number };

export default function SiteHeader({
  siteName,
  nav,
  alternates,
  socials = [],
  edit = false,
  logo,
}: {
  siteName: string;
  nav: HeaderNavItem[];
  /** Chemin de la page courante dans chaque langue (sélecteur de langue). */
  alternates: Record<AppLocale, string>;
  /** Réseaux montrés dans l'en-tête (option « icônes dans l'en-tête » des réglages), sinon vide. */
  socials?: Social[];
  /** Vue brouillon de l'éditeur : repères de l'en-tête (commun à toutes les pages). Jamais en public. */
  edit?: boolean;
  /** Image du logo (réglage du site) ; absente : signature du thème ou nom du site en texte. */
  logo?: HeaderLogo;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  // Le menu mobile est « ouvert pour une page donnée » : naviguer le referme
  // sans effet (setState dans un effect = rendus en cascade).
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  // Vue brouillon : clé stable de chaque lien (aperçu instantané des ajouts, retraits et déplacements).
  const keys = uniqueKeys(nav.map(navKeyOf));
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Position horizontale du logo (lot 84) : le logo ne passe jamais sous le menu ni hors de l'écran. Les marges de manoeuvre sont mesurées ici
  // (mise en page SANS le décalage : offsetLeft ignore les transformations) et posées en variables que la feuille du logo lit (logoCss).
  // Sans réglage de position (`--lx` absent), rien n'est mesuré ni écrit : le rendu reste celui d'avant.
  useEffect(() => {
    const header = headerRef.current;
    const brand = header?.querySelector<HTMLElement>(".site-brand");
    if (!header || !brand) return;
    const measure = () => {
      // Éditeur : toujours mesuré (les poignées de position ont besoin des bornes même quand rien n'est encore décalé).
      if (!edit && !getComputedStyle(brand).getPropertyValue("--lx").trim()) {
        if (header.hasAttribute("style")) for (const k of ["--lx-lo", "--lx-mid", "--lx-hi"]) header.style.removeProperty(k);
        return;
      }
      const base = header.getBoundingClientRect();
      const left = base.left + brand.offsetLeft;
      const width = brand.offsetWidth;
      // Voisin de droite affiché : le menu (grand écran) ou le bouton « Menu » (téléphone).
      const next = Array.from(brand.parentElement?.children ?? []).find((el) => el !== brand && (el as HTMLElement).offsetParent !== null) as HTMLElement | undefined;
      const stop = next ? next.getBoundingClientRect().left : base.right;
      const lo = -Math.max(0, left - 8);
      const hi = Math.max(0, stop - 16 - (left + width));
      const mid = base.left + base.width / 2 - (left + width / 2);
      header.style.setProperty("--lx-lo", `${Math.round(lo)}px`);
      header.style.setProperty("--lx-hi", `${Math.round(hi)}px`);
      header.style.setProperty("--lx-mid", `${Math.round(Math.min(hi, Math.max(lo, mid)))}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    ro.observe(brand);
    brand.parentElement?.childNodes.forEach((n) => n instanceof HTMLElement && ro.observe(n));
    // L'aperçu du logo dans l'éditeur (SiteLookLayer) change la feuille du logo : il prévient, on remesure.
    window.addEventListener("pe:logo-style", measure);
    void document.fonts?.ready.then(measure);
    // Éditeur : la feuille du logo est remplacée par le serveur (Défaire, Rétablir, rechargement des réglages) : on remesure alors aussi.
    let frame = 0;
    const mo = edit
      ? new MutationObserver((list) => {
          if (!list.some((m) => m.target.nodeName === "STYLE" || m.target.parentElement?.nodeName === "STYLE" || [...m.addedNodes].some((n) => n.nodeName === "STYLE"))) return;
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(measure);
        })
      : null;
    mo?.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    return () => {
      ro.disconnect();
      mo?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("pe:logo-style", measure);
    };
  }, [edit]);

  return (
    <header
      ref={headerRef}
      {...(edit ? { "data-edit-global": "header", "data-edit-label": "En-tête · commun à toutes les pages" } : {})}
      data-scrolled={scrolled || undefined}
      className={`site-header sticky top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-500 ease-soft ${
        scrolled
          ? "bg-bg/92 backdrop-blur-xl shadow-[0_1px_0_0_var(--color-line)]"
          : "bg-transparent"
      }`}
    >
      <div className="site-header-bar shell flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4 lg:py-5">
        <Link
          href="/"
          className="site-brand font-display text-lg lg:text-xl leading-none text-ink hover:text-primary transition-colors"
          {...(logo ? { "data-logo-image": "" } : {})}
        >
          {/* Signature dessinée (kit) : affichée par variants.css quand le thème
              en a une ; le nom reste alors lisible des lecteurs d'écran. */}
          <span className="site-brand-text" {...(edit ? { "data-site-inline": "name", "data-placeholder": "Nom du site" } : {})}>
            {siteName}
          </span>
          <span className="site-signature" aria-hidden="true" />
          {logo && <Picture src={logo.src} sources={logo.sources} alt="" width={logo.width} height={logo.height} sizes="18rem" className="site-logo-img" priority />}
        </Link>

        <nav
          aria-label={t("label")}
          // Édition (lot 109) : le menu en ligne reste visible à toute largeur de toile (le panneau de l'éditeur la rétrécit sous 1024 px) :
          // sans lui, ni le renommage ni le déplacement des liens ne seraient atteignables.
          className={`${edit ? "flex" : "hidden lg:flex"} flex-wrap items-center justify-end gap-x-7 gap-y-2`}
        >
          {nav.map(({ id, href, label, external }, i) => {
            const mark = edit ? { "data-nav-item": i, "data-nav-key": keys[i] } : {};
            const active = pathname === href;
            const className = `caption-text relative whitespace-nowrap font-caption text-[0.7rem] tracking-[0.18em] uppercase transition-colors ${
              active ? "text-ink" : "text-ink-soft hover:text-primary"
            }`;
            // Édition : libellé repéré (double-clic), lien repéré (glisser, retirer).
            const text = edit ? (
              <span data-site-inline="nav" data-nav-index={i} data-placeholder="Lien">
                {label}
              </span>
            ) : (
              label
            );
            if (external) {
              return (
                <a key={id ?? href} href={href} target="_blank" rel="noopener noreferrer" className={className} {...mark}>
                  {text}
                </a>
              );
            }
            return (
              <Link
                key={id ?? href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={className}
                {...mark}
              >
                {text}
                <span
                  aria-hidden="true"
                  className={`nav-underline absolute -bottom-2 left-0 h-px bg-secondary transition-all duration-500 ease-soft ${
                    active ? "w-full" : "w-0"
                  }`}
                />
              </Link>
            );
          })}
          <span aria-hidden="true" className="h-4 w-px bg-line" />
          {socials.length > 0 && <HeaderSocials socials={socials} />}
          <LocaleSwitcher alternates={alternates} />
        </nav>

        <div className={`items-center gap-4 lg:hidden ${edit ? "hidden" : "flex"}`}>
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
        hidden={!open || edit}
        className="lg:hidden bg-bg/95 backdrop-blur-xl border-t border-line"
      >
        <ul className="shell flex flex-col py-3">
          {nav.map(({ id, href, label, external }) => (
            <li key={id ?? href} className="border-b border-line last:border-0">
              {external ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="block py-3 font-display text-2xl text-ink hover:text-primary transition-colors">
                  {label}
                </a>
              ) : (
                <Link href={href} className="block py-3 font-display text-2xl text-ink hover:text-primary transition-colors">
                  {label}
                </Link>
              )}
            </li>
          ))}
          {socials.length > 0 && (
            <li className="pt-4 pb-2">
              <HeaderSocials socials={socials} large />
            </li>
          )}
        </ul>
      </nav>
    </header>
  );
}

/** Icônes seules (nom du réseau en aria-label), mêmes données que le profil et le pied de page. */
function HeaderSocials({ socials, large = false }: { socials: Social[]; large?: boolean }) {
  return (
    <ul className={`site-header-socials flex items-center ${large ? "gap-5 text-xl" : "gap-3 text-[0.95rem]"}`}>
      {socials.map((s, i) => (
        <li key={`${s.label}-${i}`}>
          <a
            href={s.href}
            target="_blank"
            rel="noopener noreferrer me"
            aria-label={s.label}
            title={s.label}
            className="social-link inline-flex items-center justify-center p-1 text-ink-soft transition-colors hover:text-primary"
          >
            <SocialIcon kind={s.kind} label={s.label} href={s.href} />
          </a>
        </li>
      ))}
    </ul>
  );
}
