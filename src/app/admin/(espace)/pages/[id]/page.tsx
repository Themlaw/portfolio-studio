import Link from "next/link";
import { notFound } from "next/navigation";
import { createElement } from "react";

import { BLOCKS } from "@/blocks/registry";
import type { BlockCatalogEntry } from "@/blocks/editor-types";
import PageEditor from "@/components/admin/PageEditor";
import PageHeader from "@/components/admin/PageHeader";
import { getActiveThemeColors, getEditorContext, getPageForEdit } from "@/lib/admin";

export const metadata = { title: "Modifier une page" };

export default async function PageEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = /^\d+$/.test(id) ? getPageForEdit(Number(id)) : null;
  if (!page) notFound();

  // Tout vient du registre : ajouter un type de bloc n'exige rien ici.
  const catalog: BlockCatalogEntry[] = Object.values(BLOCKS).map((b) => ({
    type: b.type,
    label: b.label,
    description: b.description,
    defaults: b.defaults,
    summary: b.summary,
  }));
  // Éléments sans props (sérialisables vers le composant client) ; le bloc
  // édité leur parvient par contexte (src/blocks/editor-context.tsx).
  const editors = Object.fromEntries(Object.values(BLOCKS).map((b) => [b.type, createElement(b.Editor)]));
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
            {/* Formulaire natif : l'aperçu (version enregistrée) s'ouvre dans un nouvel onglet. */}
            <form method="post" action="/admin/apercu" target="_blank">
              <input type="hidden" name="page" value={page.id} />
              <button type="submit" className="a-btn">
                Prévisualiser la page <span aria-hidden="true">↗</span>
              </button>
            </form>
          </div>
        }
      />
      <PageEditor page={page} catalog={catalog} editors={editors} context={getEditorContext()} colors={colors} />
    </>
  );
}
