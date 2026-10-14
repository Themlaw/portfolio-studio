import PageHeader from "@/components/admin/PageHeader";
import ProjectsManager from "@/components/admin/ProjectsManager";
import TrashViews from "@/components/admin/TrashViews";
import { legacyFeaturedPages, listProjectsForAdmin, listTrashedProjects } from "@/lib/admin";

export const metadata = { title: "Projets" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const view = (await searchParams).vue === "corbeille" ? "corbeille" : "liste";
  const trashed = listTrashedProjects();
  return (
    <>
      <PageHeader
        title="Projets"
        intro="Rassemble tes images par projet : chaque projet a sa planche. Fais glisser les cartes pour choisir l'ordre des projets sur le site."
      />
      <TrashViews base="/admin/projets" label="Projets" view={view} trashCount={trashed.length} />
      <ProjectsManager projects={listProjectsForAdmin()} trashed={trashed} view={view} showFeatured={legacyFeaturedPages().length > 0} />
    </>
  );
}
