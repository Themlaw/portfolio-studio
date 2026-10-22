import Link from "next/link";

import PageHeader from "@/components/admin/PageHeader";
import ThemeSwatches from "@/components/admin/ThemeSwatches";
import FirstSteps from "@/components/admin/FirstSteps";
import { getAdminCounts, getHomePageId, getOnboarding, getThemeOverview } from "@/lib/admin";

export const metadata = { title: "Tableau de bord" };

export default function Dashboard() {
  const counts = getAdminCounts();
  const { activeId, themes } = getThemeOverview();
  const active = themes.find((t) => t.id === activeId);
  const home = getHomePageId();
  const onboarding = getOnboarding();

  const stats = [
    { label: "Pages", value: counts.pages, href: "/admin/pages", link: "Organiser les pages" },
    { label: "Projets", value: counts.projects, href: "/admin/projets", link: "Voir les projets" },
    { label: "Médias", value: counts.media, href: "/admin/medias", link: "Ouvrir la médiathèque" },
  ];

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        intro="Ton site en un coup d'œil : l'apparence en ligne et ce qu'il contient."
        action={
          <div className="a-header-actions">
            {home !== null && (
              <Link className="a-btn a-btn-primary" href={`/admin/pages/${home}/editer`}>
                Modifier la page d&apos;accueil
              </Link>
            )}
            <a className="a-btn" href="/" target="_blank" rel="noopener">
              Voir le site <span aria-hidden="true">↗</span>
            </a>
          </div>
        }
      />

      <FirstSteps onboarding={onboarding} />

      <div className="a-grid">
        <section className="a-card" aria-labelledby="theme-actif">
          <p className="a-card-label" id="theme-actif">
            Thème en ligne
          </p>
          {active ? (
            <>
              <h2 style={{ marginTop: 4 }}>{active.name}</h2>
              <ThemeSwatches theme={active} />
            </>
          ) : (
            <p style={{ marginTop: 4 }}>Aucun thème actif valide : le site utilise l&apos;apparence par défaut.</p>
          )}
          <Link href="/admin/themes">Changer d&apos;apparence</Link>
        </section>

        {stats.map((s) => (
          <section key={s.label} className="a-card" aria-label={s.label}>
            <p className="a-card-label">{s.label}</p>
            <span className="a-stat">{s.value}</span>
            <Link href={s.href}>{s.link}</Link>
          </section>
        ))}
      </div>
    </>
  );
}
