import Link from "next/link";
import { notFound } from "next/navigation";

import PageHeader from "@/components/admin/PageHeader";
import ProjectEditor from "@/components/admin/ProjectEditor";
import { getProjectForEdit, listMediaForAdmin } from "@/lib/admin";

export const metadata = { title: "Modifier un projet" };

export default async function ProjectEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = /^\d+$/.test(id) ? getProjectForEdit(Number(id)) : null;
  if (!project) notFound();
  return (
    <>
      <PageHeader
        title={project.title.fr}
        intro={[project.context.fr, project.year].filter(Boolean).join(" · ") || undefined}
        action={
          <Link className="a-btn" href="/admin/projets">
            ← Tous les projets
          </Link>
        }
      />
      {project.pendingDrafts > 0 && (
        // Cet écran montre (et modifie) la planche publiée ; l'éditeur visuel
        // garde ses changements en brouillon jusqu'à « Publier ».
        <p className="a-notice" role="status">
          {project.pendingDrafts > 1 ? `${project.pendingDrafts} emplacements ont` : "Un emplacement a"} des modifications en brouillon dans
          l&apos;éditeur visuel d&apos;une page : elles n&apos;apparaissent ici qu&apos;après « Publier » sur cette page.
        </p>
      )}
      {project.textHeldBy && (
        <p className="a-notice" role="status">
          Les textes de ce projet (nom, contexte, présentation, année) sont en cours de modification dans l&apos;éditeur de la page «&nbsp;{project.textHeldBy}&nbsp;» :
          publie cette page ou abandonne ses modifications avant de les changer ici.
        </p>
      )}
      {/* Un PDF (bloc CV) ne se place pas dans une planche. */}
      <ProjectEditor project={project} library={listMediaForAdmin().filter((m) => m.kind !== "pdf")} />
    </>
  );
}
