import { useTranslations } from "next-intl";

import Eyebrow from "@/components/Eyebrow";
import { Link } from "@/i18n/navigation";

export const SOCIALS = [
  { label: "Instagram", href: "#" },
  { label: "Tumblr", href: "#" },
  { label: "LinkedIn", href: "#" },
];

export default function SiteFooter() {
  const t = useTranslations("footer");
  const tSite = useTranslations("site");
  const tNav = useTranslations("nav");
  const year = 2025;

  return (
    <footer className="mt-[var(--section-gap)] border-t border-line bg-surface">
      <div className="shell py-14 md:py-20">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <a
              href={`mailto:${tSite("email")}`}
              className="mt-3 block font-display text-2xl sm:text-3xl md:text-4xl text-ink hover:text-primary transition-colors break-words"
            >
              {tSite("email")}
            </a>
            <p className="mt-4 max-w-sm text-sm text-ink-soft">
              {tSite("role")}
            </p>
          </div>

          <div>
            <Eyebrow>{tNav("label")}</Eyebrow>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link href="/characters" className="text-ink-soft hover:text-primary transition-colors">
                  {tNav("characters")}
                </Link>
              </li>
              <li>
                <Link href="/backgrounds" className="text-ink-soft hover:text-primary transition-colors">
                  {tNav("backgrounds")}
                </Link>
              </li>
              <li>
                <Link href="/animation" className="text-ink-soft hover:text-primary transition-colors">
                  {tNav("animation")}
                </Link>
              </li>
              <li>
                <Link href="/about" className="text-ink-soft hover:text-primary transition-colors">
                  {tNav("about")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <Eyebrow>{tSite("name")}</Eyebrow>
            <ul className="mt-4 space-y-2 text-sm">
              {SOCIALS.map((s) => (
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
            © {year} {tSite("name")} — {t("rights")}
          </p>
          <p className="text-xs text-ink-soft">{t("credit")}</p>
        </div>
      </div>
    </footer>
  );
}
