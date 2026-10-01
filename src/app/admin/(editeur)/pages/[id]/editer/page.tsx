import { notFound } from "next/navigation";

import { blockCatalog, blockEditors } from "@/blocks/registry";
import VisualEditor from "@/components/admin/editor/VisualEditor";
import { getEditorContext, getSettingsForAdmin, listPagesForAdmin } from "@/lib/admin";
import { readDraft } from "@/lib/edit/drafts";

export const metadata = { title: "Éditeur de page" };

/**
 * Éditeur visuel d'une page (entrée principale de l'édition) : brouillon
 * enregistré automatiquement, toile = le site en vue brouillon, « Publier »
 * pour mettre en ligne. Le formulaire /admin/pages/<id> reste disponible.
 */
export default async function VisualEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ langue?: string }> }) {
  const { id } = await params;
  const { langue } = await searchParams;
  const state = /^\d+$/.test(id) ? readDraft(Number(id)) : null;
  if (!state) notFound();
  const pages = listPagesForAdmin()
    .filter((p) => !p.slug.fr.startsWith("_"))
    .map((p) => ({ id: p.id, title: p.title || "Page sans titre", slug: p.slug }));
  const self = pages.find((p) => p.id === Number(id));
  return (
    <VisualEditor
      key={id}
      pageId={Number(id)}
      initial={state.draft}
      hasDraft={state.hasDraft}
      rev={state.rev}
      corrupt={state.corrupt}
      paths={{ fr: self ? pathOf("fr", self.slug.fr) : "/fr", en: self ? pathOf("en", self.slug.en) : "/en" }}
      pages={pages.map(({ id, title }) => ({ id, title }))}
      catalog={blockCatalog()}
      editors={blockEditors()}
      context={getEditorContext()}
      siteName={getSettingsForAdmin().site.name || "Portfolio"}
      initialLocale={langue === "en" ? "en" : "fr"}
    />
  );
}

function pathOf(locale: "fr" | "en", slug: string): string {
  return slug ? `/${locale}/${slug}` : `/${locale}`;
}
