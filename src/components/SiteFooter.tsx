import { useTranslations } from "next-intl";

import EmailText from "@/components/EmailText";
import Eyebrow from "@/components/Eyebrow";
import SocialIcon from "@/components/SocialIcon";
import { Link } from "@/i18n/navigation";
import type { SiteIdentity, Social } from "@/lib/settings";
import { navKeyOf, socialKeys, uniqueKeys } from "@/lib/site-schema";

/** Repère d'un texte du site modifiable sur la toile (vue brouillon seulement). */
const site$ = (edit: boolean, field: string, placeholder: string) => (edit ? { "data-site-inline": field, "data-placeholder": placeholder } : {});

export default function SiteFooter({
  site,
  nav,
  socials,
  edit = false,
}: {
  site: SiteIdentity;
  nav: { id?: string; href: string; label: string; external?: boolean; pageId?: number }[];
  socials: Social[];
  /** Vue brouillon de l'éditeur : pied de page commun à toutes les pages, repéré. */
  edit?: boolean;
}) {
  const t = useTranslations("footer");
  const tNav = useTranslations("nav");
  const year = 2025;
  // Vue brouillon : clés stables des liens et des réseaux (aperçu instantané, src/components/edit/optimistic.ts).
  const navKeyList = uniqueKeys(nav.map(navKeyOf));
  const socialKeyList = socialKeys(socials);

  return (
    <footer
      className="mt-[var(--section-gap)] border-t border-line bg-surface"
      {...(edit ? { "data-edit-global": "footer", "data-edit-label": "Pied de page · commun à toutes les pages" } : {})}
    >
      <div className="shell py-14 md:py-20">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <a
              href={`mailto:${site.email}`}
              className="email-link email-link-footer mt-3 text-ink hover:text-primary transition-colors"
            >
              <EmailText email={site.email} editable={edit ? site$(edit, "email", "ton@adresse.fr") : undefined} />
            </a>
            <p className="mt-4 max-w-sm text-sm text-ink-soft" {...site$(edit, "role", "Ton métier")}>
              {site.role}
            </p>
          </div>

          <div>
            <Eyebrow>{tNav("label")}</Eyebrow>
            <ul className="mt-4 space-y-2 text-sm">
              {nav.map((item, i) => (
                <li key={item.id ?? item.href} {...(edit ? { "data-nav-key": navKeyList[i] } : {})}>
                  {item.external ? (
                    <a href={item.href} target="_blank" rel="noopener noreferrer" className="text-ink-soft hover:text-primary transition-colors">
                      {item.label}
                    </a>
                  ) : (
                    <Link href={item.href} className="text-ink-soft hover:text-primary transition-colors">
                      {item.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <Eyebrow>{site.name}</Eyebrow>
            <ul className="mt-4 space-y-2 text-sm" {...(edit ? { "data-edit-socials": "" } : {})}>
              {socials.map((s, i) => (
                <li key={`${s.label}-${i}`} {...(edit ? { "data-social-index": i, "data-social-key": socialKeyList[i] } : {})}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer me"
                    className="social-link inline-flex items-center gap-2 text-ink-soft hover:text-primary transition-colors"
                  >
                    <SocialIcon kind={s.kind} label={s.label} href={s.href} />
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
          <p className="text-xs text-ink-soft" {...site$(edit, "credit", "Mention (crédits, droits…)")}>
            {site.credit}
          </p>
        </div>
      </div>
    </footer>
  );
}
