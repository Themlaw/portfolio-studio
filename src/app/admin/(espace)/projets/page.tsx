import PageHeader from "@/components/admin/PageHeader";
import ProjectsManager from "@/components/admin/ProjectsManager";
import { listProjectsForAdmin } from "@/lib/admin";

export const metadata = { title: "Projets" };

export default function ProjectsPage() {
  return (
    <>
      <PageHeader
        title="Projets"
        intro="Rassemble tes images par projet : chaque projet a sa planche. Fais glisser les cartes pour choisir l'ordre des projets sur le site."
      />
      <ProjectsManager projects={listProjectsForAdmin()} />
    </>
  );
}
