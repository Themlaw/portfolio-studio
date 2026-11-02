import { notFound } from "next/navigation";

import { blockCatalog, blockEditors } from "@/blocks/registry";
import VisualEditor from "@/components/admin/editor/VisualEditor";
import { getEditorContext, listPagesForAdmin, overlayProjectSlugs } from "@/lib/admin";
import { readDraft } from "@/lib/edit/drafts";
import { readThemeUsage, sortThemeChoices } from "@/lib/edit/theme-usage";
import { lookContextForEditor } from "@/lib/edit/look-context";
import { siteForEditor } from "@/lib/edit/site";
import { siteNameFor } from "@/lib/site-schema";
import { getPreparingTheme, getTheme } from "@/lib/theme";
import { getThemeLibrary } from "@/lib/themes/versions";

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
  const site = siteForEditor();
  if (!state) notFound();
  const pages = listPagesForAdmin()
    .filter((p) => !p.slug.fr.startsWith("_"))
    .map((p) => ({ id: p.id, title: p.title || "Page sans titre", slug: p.slug }));
  // Thème en préparation (aperçu depuis Admin → Thèmes) : la toile le montre, le panneau Couleurs aussi.
  const preparingRef = await getPreparingTheme();
  // Lot 60 : l'aperçu d'une VERSION de Mon thème (`<thème>@<n>`) n'est pas un thème « en préparation » (« Mettre en ligne » publierait la version en cours).
  const preparing = preparingRef && !preparingRef.id.includes("@") ? ((await getTheme(preparingRef.id)) ?? null) : null;
  const library = getThemeLibrary();
  const themeChoices = sortThemeChoices(library, library.activeId, readThemeUsage());
  const self = pages.find((p) => p.id === Number(id));
  return (
    <VisualEditor
      key={id}
      pageId={Number(id)}
      initial={state.draft}
      hasDraft={state.hasDraft}
      rev={state.rev}
      corrupt={state.corrupt}
      overlaySlugs={overlayProjectSlugs(Number(id))}
      paths={{ fr: self ? pathOf("fr", self.slug.fr) : "/fr", en: self ? pathOf("en", self.slug.en) : "/en" }}
      pages={pages.map(({ id, title }) => ({ id, title }))}
      catalog={blockCatalog()}
      editors={blockEditors()}
      context={getEditorContext(Number(id))}
      siteName={siteNameFor(site.snap.identity.name, "fr") || "Portfolio"}
      initialLocale={langue === "en" ? "en" : "fr"}
      site={site}
      look={lookContextForEditor(preparing)}
      themeChoices={themeChoices}
    />
  );
}

function pathOf(locale: "fr" | "en", slug: string): string {
  return slug ? `/${locale}/${slug}` : `/${locale}`;
}
