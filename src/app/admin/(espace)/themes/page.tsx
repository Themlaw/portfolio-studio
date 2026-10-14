import KitTutorial from "@/components/admin/KitTutorial";
import PageHeader from "@/components/admin/PageHeader";
import ThemeImportButton from "@/components/admin/ThemeImportButton";
import ThemeList from "@/components/admin/ThemeList";
import { getThemeOverview, listPageAccents } from "@/lib/admin";
import { presetThumb } from "@/themes/presets";

export const metadata = { title: "Thèmes" };

export default function ThemesPage() {
  const { activeId, themes } = getThemeOverview();
  // Le thème en ligne d'abord, puis les tiens, puis les thèmes livrés.
  const sorted = [...themes].sort(
    (a, b) => Number(b.id === activeId) - Number(a.id === activeId) || Number(a.preset) - Number(b.preset) || a.name.localeCompare(b.name, "fr"),
  );
  return (
    <>
      <PageHeader
        title="Thèmes"
        intro="Seul le thème en ligne est vu par tes visiteurs : prévisualise les autres sur tes vraies pages, duplique un thème livré pour le modifier, et retrouve dans « … » l'archive .zip du thème (à réimporter) et le kit Photoshop (à redessiner)."
        action={
          <div className="a-header-actions">
            {/* Tuto du kit : le bouton « Télécharger le kit » de la slide 2 vise le thème en ligne. */}
            <ThemeImportButton />
            <KitTutorial themeId={activeId || sorted[0]?.id || "galerie-lumineuse"} />
            {/* Formulaire natif (pas de server action) : l'admin reste sur cet écran. */}
            <form method="post" action="/admin/apercu/quitter">
              <input type="hidden" name="retour" value="/admin/themes" />
              <button type="submit" className="a-btn">
                Quitter l&apos;aperçu
              </button>
            </form>
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
          thumbs={Object.fromEntries(sorted.map((t) => [t.id, presetThumb(t.id)]))}
        />
      )}
    </>
  );
}
