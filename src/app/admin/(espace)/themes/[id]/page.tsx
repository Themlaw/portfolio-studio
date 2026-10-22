import { notFound } from "next/navigation";

import PageHeader from "@/components/admin/PageHeader";
import MineBar from "@/components/admin/MineBar";
import ThemeEditor from "@/components/admin/ThemeEditor";
import { getThemeOverview, listPagesForAdmin } from "@/lib/admin";
import { readPublishedSite } from "@/lib/edit/site";
import { getMineState } from "@/lib/themes/versions";
import { FONT_VARIABLE_CLASSES } from "@/themes/fonts";

export const metadata = { title: "Modifier un thème" };

export default async function ThemeEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { activeId, themes } = getThemeOverview();
  const theme = themes.find((t) => t.id === id);
  if (!theme) notFound();
  const mine = getMineState();
  const isMine = mine?.id === theme.id;
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
            ? "Modèle livré avec le site : il ne change jamais. Essaie ses couleurs ici ; pour les garder, « Utiliser ce modèle » (écran Thèmes) crée ou fait évoluer Mon thème."
            : isMine
              ? "Chaque enregistrement crée ou met à jour la version en cours (un brouillon) : tes visiteurs ne voient rien tant que tu ne publies pas."
              : active
                ? "Ce thème est en ligne : chaque enregistrement est visible aussitôt par tes visiteurs."
                : "Ce thème n'est pas en ligne : tes réglages ne sont visibles que dans l'aperçu."
        }
      />
      {isMine && mine && (
        <MineBar id={mine.id} name={mine.name} version={mine.version} publishedVersion={mine.publishedVersion} live={mine.live} draft={mine.theme} published={mine.published} />
      )}
      {/* Couleurs du site choisies depuis l'éditeur visuel (lot 17f) : par-dessus le thème EN LIGNE. */}
      <ThemeEditor
        initial={theme}
        isActive={active && !isMine}
        isMine={isMine}
        sitePalette={active ? (readPublishedSite().styles?.palette ?? {}) : {}}
        pages={pages}
        editorHref={home ? `/admin/pages/${home.id}/editer` : undefined}
      />
    </div>
  );
}
