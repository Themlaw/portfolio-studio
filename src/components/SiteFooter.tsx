import { useTranslations } from "next-intl";

import Eyebrow from "@/components/Eyebrow";
import { Link } from "@/i18n/navigation";
import type { SiteIdentity, Social } from "@/lib/settings";

export default function SiteFooter({
  site,
  nav,
  socials,
}: {
  site: SiteIdentity;
  nav: { href: string; label: string }[];
  socials: Social[];
}) {
  const t = useTranslations("footer");
  const tNav = useTranslations("nav");
  const year = 2025;

  return (
    <footer className="mt-[var(--section-gap)] border-t border-line bg-surface">
      <div className="shell py-14 md:py-20">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <a
              href={`mailto:${site.email}`}
              className="mt-3 block font-display text-2xl sm:text-3xl md:text-4xl text-ink hover:text-primary transition-colors break-words"
            >
              {site.email}
            </a>
            <p className="mt-4 max-w-sm text-sm text-ink-soft">{site.role}</p>
          </div>

          <div>
            <Eyebrow>{tNav("label")}</Eyebrow>
            <ul className="mt-4 space-y-2 text-sm">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-ink-soft hover:text-primary transition-colors">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <Eyebrow>{site.name}</Eyebrow>
            <ul className="mt-4 space-y-2 text-sm">
              {socials.map((s) => (
                <li key={s.label}>
                  <a
                    href={s.href}
                    className="text-ink-soft hover:text-primary transition-colors"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <hr className="rule my-10" />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="eyebrow">
            © {year} {site.name} — {t("rights")}
          </p>
          <p className="text-xs text-ink-soft">{site.credit}</p>
        </div>
      </div>
    </footer>
  );
}
