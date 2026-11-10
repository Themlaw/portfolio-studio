import PageHeader from "@/components/admin/PageHeader";
import PagesManager from "@/components/admin/PagesManager";
import TrashViews from "@/components/admin/TrashViews";
import ProjectsManager from "@/components/admin/ProjectsManager";
import { getTrashSummary, legacyFeaturedPages, listPagesForAdmin, listProjectsForAdmin, listTrashedPages, listTrashedProjects } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/guard";
import { getAdminT } from "@/i18n/admin-server";

export async function generateMetadata() {
  return { title: (await getAdminT("pagesMgr"))("title") };
}

export default async function PagesPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  await requireAdmin();
  const t = await getAdminT("pagesMgr");
  const view = (await searchParams).vue === "corbeille" ? "corbeille" : "liste";
  const trashed = listTrashedPages();
  const trashedProjects = listTrashedProjects();
  return (
    <>
      <PageHeader
        title={t("title")}
        intro={t("intro")}
      />
      <TrashViews base="/admin/pages" label={t("title")} view={view} trashCount={trashed.length + trashedProjects.length} />
      <PagesManager pages={listPagesForAdmin()} trashed={trashed} view={view} summary={getTrashSummary()} />
      <section id="projets" className="a-section">
        {view === "liste" && (
          <>
            <h2 id="pg-projets">{t("projectsHeading")}</h2>
            <p className="muted" style={{ maxWidth: "70ch" }}>
            {t("projectsIntro")}
            </p>
          </>
        )}
        <ProjectsManager projects={listProjectsForAdmin()} trashed={trashedProjects} view={view} showFeatured={legacyFeaturedPages().length > 0} summary={getTrashSummary()} />
      </section>
    </>
  );
}
