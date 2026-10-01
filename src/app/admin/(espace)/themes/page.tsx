import PageHeader from "@/components/admin/PageHeader";
import ThemeList from "@/components/admin/ThemeList";
import { getThemeOverview, listPageAccents } from "@/lib/admin";

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
        intro="Choisis l'apparence de ton site : couleurs, typographies et mise en page. Prévisualise un thème sur tes vraies pages avant de le mettre en ligne."
        action={
          // Formulaire natif (pas de server action) : l'admin reste sur cet écran.
          <form method="post" action="/admin/apercu/quitter">
            <input type="hidden" name="retour" value="/admin/themes" />
            <button type="submit" className="a-btn">
              Quitter l&apos;aperçu
            </button>
          </form>
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
        <ThemeList themes={sorted} activeId={activeId} accents={listPageAccents()} />
      )}
      <p className="a-help a-section">
        L&apos;aperçu n&apos;est visible que par toi, tant que tu es connecté : tes visiteurs voient le thème en ligne. Pour
        créer ton propre thème, duplique un thème livré puis modifie la copie.
      </p>
    </>
  );
}
