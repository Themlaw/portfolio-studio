import Link from "next/link";

import PageHeader from "@/components/admin/PageHeader";
import ThemeSwatches from "@/components/admin/ThemeSwatches";
import FirstSteps from "@/components/admin/FirstSteps";
import { getAdminT } from "@/i18n/admin-server";
import { countUnreadMessages, getAdminCounts, getHomePageId, getOnboarding, getThemeOverview } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/guard";

export async function generateMetadata() {
  return { title: (await getAdminT("dashboard"))("title") };
}

export default async function Dashboard() {
  await requireAdmin();
  const t = await getAdminT("dashboard");
  const counts = getAdminCounts();
  const { activeId, themes } = getThemeOverview();
  const active = themes.find((th) => th.id === activeId);
  const home = getHomePageId();
  const unread = countUnreadMessages();
  const onboarding = getOnboarding();

  const stats = [
    { label: t("statPages"), value: counts.pages, href: "/admin/pages", link: t("linkPages") },
    { label: t("statProjects"), value: counts.projects, href: "/admin/pages#projets", link: t("linkProjects") },
    { label: t("statMedia"), value: counts.media, href: "/admin/medias", link: t("linkMedia") },
  ];

  return (
    <>
      <PageHeader
        title={t("title")}
        intro={t("intro")}
        action={
          <div className="a-header-actions">
            {home !== null && (
              <Link className="a-btn a-btn-primary" href={`/admin/pages/${home}/editer`}>
                {t("editHome")}
              </Link>
            )}
            <a className="a-btn" href="/" target="_blank" rel="noopener">
              {t("viewSite")} <span aria-hidden="true">↗</span>
            </a>
          </div>
        }
      />

      <FirstSteps onboarding={onboarding} />

      <div className="a-grid">
        <section className="a-card" aria-labelledby="theme-actif">
          <p className="a-card-label" id="theme-actif">
            {t("liveTheme")}
          </p>
          {active ? (
            <>
              <h2 style={{ marginTop: 4 }}>{active.name}</h2>
              <ThemeSwatches theme={active} />
            </>
          ) : (
            <p style={{ marginTop: 4 }}>{t("noActiveTheme")}</p>
          )}
          <Link href="/admin/themes">{t("changeLook")}</Link>
        </section>

        <section className="a-card" aria-label={t("messagesCard")} data-testid="dash-messages" data-unread={unread}>
          <p className="a-card-label">{t("messagesCard")}</p>
          <span className="a-stat">{unread}</span>
          <p style={{ margin: 0 }}>{t("newMessages", { count: unread })}</p>
          <Link href="/admin/messages">{unread > 0 ? t("readMessages") : t("openMessages")}</Link>
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
