import Link from "next/link";
import { notFound } from "next/navigation";

import PageEditor from "@/components/admin/PageEditor";
import PageHeader from "@/components/admin/PageHeader";
import { getActiveThemeColors, getEditorContext, getPageForEdit } from "@/lib/admin";
import { readDraft } from "@/lib/edit/drafts";

export const metadata = { title: "Modifier une page" };

export default async function PageEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const published = /^\d+$/.test(id) ? getPageForEdit(Number(id)) : null;
  if (!published) notFound();
  // Le formulaire ne montre et n'enregistre que les infos de la page (lot 51) : le brouillon de contenu de l'éditeur
  // n'y est pas repris et n'est jamais publié d'ici. Les infos du brouillon (titre, adresses…) suivent déjà celles du formulaire.
  const state = readDraft(published.id);
  const page = state?.hasDraft ? { ...published, ...state.draft, blocks: published.blocks } : published;

  const colors = getActiveThemeColors();

  return (
    <>
      <PageHeader
        title={page.title.fr || "Page sans titre"}
        intro={page.isHome ? "La page d'accueil de ton site." : undefined}
        action={
          <div className="a-header-actions">
            <Link className="a-btn" href="/admin/pages">
              ← Toutes les pages
            </Link>
            <Link className="a-btn a-btn-primary" href={`/admin/pages/${page.id}/editer`}>
              Éditeur visuel
            </Link>
            {/* Formulaire natif : l'aperçu (version enregistrée) s'ouvre dans un nouvel onglet. */}
            <form method="post" action="/admin/apercu" target="_blank">
              <input type="hidden" name="page" value={page.id} />
              <input type="hidden" name="retour" value={`/admin/pages/${page.id}`} />
              <button type="submit" className="a-btn">
                Prévisualiser la page <span aria-hidden="true">↗</span>
              </button>
            </form>
          </div>
        }
      />
      {state?.corrupt && (
        <p className="a-notice a-notice-danger" role="alert">
          Le brouillon de cette page ne peut plus être lu (un bloc a changé). Ouvre l&apos;éditeur visuel pour repartir de la
          version en ligne avant d&apos;enregistrer ici.
        </p>
      )}
      {state?.hasDraft && !state.corrupt && (
        <p className="a-notice" role="status">
          Cette page a des modifications non publiées dans l&apos;éditeur visuel. « Enregistrer » ici ne change que les
          informations : tes modifications de contenu restent en attente jusqu&apos;à « Publier ».
        </p>
      )}
      <PageEditor rev={state?.rev ?? 0} page={page} context={getEditorContext()} colors={colors} />
    </>
  );
}
