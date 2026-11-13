import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import PageEditor from "@/components/admin/PageEditor";
import PageHeader from "@/components/admin/PageHeader";
import { getActiveThemeColors, getEditorContext, getPageForEdit } from "@/lib/admin";
import { readDraft } from "@/lib/edit/drafts";
import { isSpecialPage } from "@/lib/special-pages";
import { requireAdmin } from "@/lib/auth/guard";
import { getAdminT } from "@/i18n/admin-server";

export async function generateMetadata() {
  return { title: (await getAdminT("pagesMgr"))("editMeta") };
}

export default async function PageEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const t = await getAdminT("pagesMgr");
  const { id } = await params;
  const published = /^\d+$/.test(id) ? getPageForEdit(Number(id)) : null;
  if (!published) notFound();
  // Page spéciale (lot 89, « Page introuvable ») : ni titre, ni adresse, ni menu à régler ici ; tout se passe dans l'éditeur.
  if (isSpecialPage(published)) redirect(`/admin/pages/${published.id}/editer`);
  // Le formulaire ne montre et n'enregistre que les infos de la page (lot 51) : le brouillon de contenu de l'éditeur
  // n'y est pas repris et n'est jamais publié d'ici. Les infos du brouillon (titre, adresses…) suivent déjà celles du formulaire.
  const state = readDraft(published.id);
  const page = state?.hasDraft ? { ...published, ...state.draft, blocks: published.blocks } : published;

  const colors = getActiveThemeColors();

  return (
    <>
      <PageHeader
        title={page.title.fr || t("untitled")}
        intro={page.isHome ? t("homeIntro") : undefined}
        action={
          <div className="a-header-actions">
            <Link className="a-btn" href="/admin/pages">
              {t("allPagesBack")}
            </Link>
            <Link className="a-btn a-btn-primary" href={`/admin/pages/${page.id}/editer`}>
              {t("visualEditor")}
            </Link>
            {/* Formulaire natif : l'aperçu (version enregistrée) s'ouvre dans un nouvel onglet. */}
            <form method="post" action="/admin/apercu" target="_blank">
              <input type="hidden" name="page" value={page.id} />
              <input type="hidden" name="retour" value={`/admin/pages/${page.id}`} />
              <button type="submit" className="a-btn">
                {t("previewPage")} <span aria-hidden="true">↗</span>
              </button>
            </form>
          </div>
        }
      />
      {state?.corrupt && (
        <p className="a-notice a-notice-danger" role="alert">
          {t("draftCorrupt")}
        </p>
      )}
      {state?.hasDraft && !state.corrupt && (
        <p className="a-notice" role="status">
          {t("draftPending")}
        </p>
      )}
      <PageEditor rev={state?.rev ?? 0} page={page} context={getEditorContext()} colors={colors} />
    </>
  );
}
