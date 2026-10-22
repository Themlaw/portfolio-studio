import { draftMode } from "next/headers";

import KitTutorial from "@/components/admin/KitTutorial";
import PageHeader from "@/components/admin/PageHeader";
import ThemeImportButton from "@/components/admin/ThemeImportButton";
import ThemeList from "@/components/admin/ThemeList";
import { getThemeOverview, listPageAccents } from "@/lib/admin";
import { lastEditedPageId } from "@/lib/edit/theme-usage";
import { previousThemeId } from "@/lib/edit/themes";
import { publishedSitePalette } from "@/lib/edit/site";
import { getPreparingTheme } from "@/lib/theme";
import { presetThumb } from "@/themes/presets";

export const metadata = { title: "Thèmes" };

export default async function ThemesPage() {
  const { activeId, themes } = getThemeOverview();
  const preparing = await getPreparingTheme();
  const previewOn = (await draftMode()).isEnabled;
  // Ordre stable (lot 55) : les tiens d'abord, puis les thèmes fournis, par nom. Mettre en ligne ou prévisualiser ne déplace aucune carte.
  const sorted = [...themes].sort((a, b) => Number(a.preset) - Number(b.preset) || a.name.localeCompare(b.name, "fr"));
  return (
    <>
      <PageHeader
        title="Thèmes"
        intro="Seul le thème en ligne est vu par tes visiteurs : prévisualise les autres sur tes vraies pages, duplique un thème fourni pour le modifier, et retrouve dans « … » l'archive .zip du thème (à réimporter) et le kit Photoshop (à redessiner)."
        action={
          <div className="a-header-actions">
            {/* Tuto du kit : le bouton « Télécharger le kit » de la slide 2 vise le thème en ligne. */}
            <ThemeImportButton />
            <KitTutorial themeId={activeId || sorted[0]?.id || "galerie-lumineuse"} />
            {/* Formulaire natif (pas de server action) : l'admin reste sur cet écran. Seulement s'il y a un aperçu à quitter. */}
            {previewOn && (
              <form method="post" action="/admin/apercu/quitter">
                <input type="hidden" name="retour" value="/admin/themes" />
                <button type="submit" className="a-btn" data-testid="quit-preview">
                  Quitter l&apos;aperçu
                </button>
              </form>
            )}
          </div>
        }
      />
      {themes.length === 0 ? (
        <div className="a-empty">
          <h2>Aucun thème enregistré</h2>
          <p>
            Le site s&apos;affiche avec l&apos;apparence par défaut. Les thèmes livrés sont installés au premier démarrage
            d&apos;une base neuve.
          </p>
        </div>
      ) : (
        <ThemeList
          themes={sorted}
          activeId={activeId}
          accents={listPageAccents()}
          preparingId={preparing?.id ?? null}
          previewOn={previewOn}
          previousId={previousThemeId()}
          editorPageId={lastEditedPageId()}
          customColors={publishedSitePalette()}
          thumbs={Object.fromEntries(sorted.map((t) => [t.id, presetThumb(t.id)]))}
        />
      )}
    </>
  );
}
