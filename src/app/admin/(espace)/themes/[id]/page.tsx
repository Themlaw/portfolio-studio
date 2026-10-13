import { notFound } from "next/navigation";

import PageHeader from "@/components/admin/PageHeader";
import ThemeEditor from "@/components/admin/ThemeEditor";
import { getThemeOverview, listPagesForAdmin } from "@/lib/admin";
import { readPublishedSite } from "@/lib/edit/site";
import { FONT_VARIABLE_CLASSES } from "@/themes/fonts";

export const metadata = { title: "Modifier un thème" };

export default async function ThemeEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { activeId, themes } = getThemeOverview();
  const theme = themes.find((t) => t.id === id);
  if (!theme) notFound();
  // Pages montrables dans l'aperçu (l'accueil est toujours proposé) ; l'éditeur de page où le site peut remplacer des couleurs.
  const rows = listPagesForAdmin();
  const home = rows.find((p) => !p.slug.fr) ?? rows[0];
  const pages = rows.filter((p) => p.slug.fr).map((p) => ({ id: p.id, title: p.title }));
  const active = theme.id === activeId;
  return (
    // Classes next/font : les échantillons de typographies s'affichent dans leur police.
    <div className={FONT_VARIABLE_CLASSES}>
      <PageHeader
        title={theme.name}
        intro={
          theme.preset
            ? "Thème livré avec le site : essaie ses couleurs ici, puis crée une copie modifiable pour les garder."
            : active
              ? "Ce thème est en ligne : chaque enregistrement est visible aussitôt par tes visiteurs."
              : "Ce thème n'est pas en ligne : tes réglages ne sont visibles que dans l'aperçu."
        }
      />
      {/* Couleurs du site choisies depuis l'éditeur visuel (lot 17f) : par-dessus le thème EN LIGNE. */}
      <ThemeEditor
        initial={theme}
        isActive={active}
        sitePalette={active ? (readPublishedSite().styles?.palette ?? {}) : {}}
        pages={pages}
        editorHref={home ? `/admin/pages/${home.id}/editer` : undefined}
      />
    </div>
  );
}
