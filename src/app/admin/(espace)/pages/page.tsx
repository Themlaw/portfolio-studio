import PageHeader from "@/components/admin/PageHeader";
import PagesManager from "@/components/admin/PagesManager";
import TrashViews from "@/components/admin/TrashViews";
import ProjectsManager from "@/components/admin/ProjectsManager";
import { getTrashSummary, legacyFeaturedPages, listPagesForAdmin, listProjectsForAdmin, listTrashedPages, listTrashedProjects } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/guard";

export const metadata = { title: "Pages" };

export default async function PagesPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  await requireAdmin();
  const view = (await searchParams).vue === "corbeille" ? "corbeille" : "liste";
  const trashed = listTrashedPages();
  const trashedProjects = listTrashedProjects();
  return (
    <>
      <PageHeader
        title="Pages"
        intro="Organise les pages de ton site : leur place dans le menu, leur adresse en français et en anglais, et les blocs qui les composent."
      />
      <TrashViews base="/admin/pages" label="Pages" view={view} trashCount={trashed.length + trashedProjects.length} />
      <PagesManager pages={listPagesForAdmin()} trashed={trashed} view={view} summary={getTrashSummary()} />
      <section id="projets" className="a-section">
        {view === "liste" && (
          <>
            <h2 id="pg-projets">Projets</h2>
            <p className="muted" style={{ maxWidth: "70ch" }}>
            Un projet rassemble tes images sur une planche. Il est visible sur le site seulement si une page l&apos;affiche. Tu le crées aussi directement sur la toile d&apos;une page. Fais glisser les cartes pour choisir leur ordre sur le site.
            </p>
          </>
        )}
        <ProjectsManager projects={listProjectsForAdmin()} trashed={trashedProjects} view={view} showFeatured={legacyFeaturedPages().length > 0} summary={getTrashSummary()} />
      </section>
    </>
  );
}
