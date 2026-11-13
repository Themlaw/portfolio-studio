import Link from "next/link";
import { notFound } from "next/navigation";

import PageHeader from "@/components/admin/PageHeader";
import ProjectEditor from "@/components/admin/ProjectEditor";
import { getProjectForEdit, legacyFeaturedPages, listMediaForAdmin } from "@/lib/admin";
import { findProjectReferences } from "@/lib/references";
import { requireAdmin } from "@/lib/auth/guard";
import { getAdminT } from "@/i18n/admin-server";

export async function generateMetadata() {
  return { title: (await getAdminT("projects"))("editMeta") };
}

export default async function ProjectEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const t = await getAdminT("projects");
  const { id } = await params;
  const project = /^\d+$/.test(id) ? getProjectForEdit(Number(id)) : null;
  if (!project) notFound();
  // Un projet n'est visible que si une page l'affiche (bloc « Projet ») : on le dit tant que ce n'est pas le cas.
  const shown = findProjectReferences(project.slug).some((u) => u.kind === "block");
  return (
    <>
      <PageHeader
        title={project.title.fr}
        intro={[project.context.fr, project.year].filter(Boolean).join(" · ") || undefined}
        action={
          <Link className="a-btn" href="/admin/pages#projets">
            {t("backToPages")}
          </Link>
        }
      />
      {!shown && (
        <p className="a-notice" role="status" data-testid="project-not-shown">
          {t("notShown")}{" "}
          <Link href="/admin/pages">{t("notShownLink")}</Link>
        </p>
      )}
      {project.pendingDrafts > 0 && (
        // Cet écran montre (et modifie) la planche publiée ; l'éditeur visuel
        // garde ses changements en brouillon jusqu'à « Publier ».
        <p className="a-notice" role="status">
          {t("pendingDrafts", { count: project.pendingDrafts })}
        </p>
      )}
      {project.textHeldBy && (
        <p className="a-notice" role="status">
          {t("textHeld", { page: project.textHeldBy })}
        </p>
      )}
      {/* Un PDF (bloc CV) ne se place pas dans une planche. */}
      <ProjectEditor project={project} library={listMediaForAdmin().filter((m) => m.kind !== "pdf")} legacyFeatured={legacyFeaturedPages()} />
    </>
  );
}
