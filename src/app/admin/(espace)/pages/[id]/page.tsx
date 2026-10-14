import Link from "next/link";
import { notFound } from "next/navigation";

import PageEditor from "@/components/admin/PageEditor";
import PageHeader from "@/components/admin/PageHeader";
import { getActiveThemeColors, getPageForEdit } from "@/lib/admin";
import { readDraft } from "@/lib/edit/drafts";

export const metadata = { title: "Modifier une page" };

export default async function PageEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const published = /^\d+$/.test(id) ? getPageForEdit(Number(id)) : null;
  if (!published) notFound();
  // Brouillon de l'éditeur visuel : le formulaire le reprend (un seul état).
  const state = readDraft(published.id);
  const page = state?.hasDraft ? { ...published, ...state.draft, blocks: state.draft.blocks.map(({ type, props }) => ({ type, props })) } : published;

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
          Le brouillon de cette page ne peut plus être lu (un composant a changé). Ouvre l&apos;éditeur visuel pour repartir de la
          version publiée avant d&apos;enregistrer ici.
        </p>
      )}
      {state?.hasDraft && !state.corrupt && (
        <p className="a-notice" role="status">
          Cette page a un brouillon non publié dans l&apos;éditeur visuel : le formulaire le reprend. « Enregistrer » ici le
          publie, comme « Publier » dans l&apos;éditeur.
        </p>
      )}
      <PageEditor rev={state?.rev ?? 0} page={page} colors={colors} />
    </>
  );
}
