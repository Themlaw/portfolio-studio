import PageHeader from "@/components/admin/PageHeader";
import ThemeSwatches from "@/components/admin/ThemeSwatches";
import { getThemeOverview } from "@/lib/admin";

export const metadata = { title: "Thèmes" };

export default function ThemesPage() {
  const { activeId, themes } = getThemeOverview();
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
        <div className="a-grid">
          {themes.map((theme) => (
            <section key={theme.id} className="a-card" aria-labelledby={`theme-${theme.id}`}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <h2 id={`theme-${theme.id}`}>{theme.name}</h2>
                {theme.id === activeId && <span className="a-badge">En ligne</span>}
              </div>
              <p className="mono muted" style={{ marginTop: 4 }}>
                {theme.id}
              </p>
              <ThemeSwatches theme={theme} />
              {/* Formulaire natif : l'aperçu s'ouvre dans un nouvel onglet. */}
              <form method="post" action="/admin/apercu" target="_blank">
                <input type="hidden" name="id" value={theme.id} />
                <button type="submit" className="a-btn">
                  Prévisualiser sur le site <span aria-hidden="true">↗</span>
                </button>
              </form>
            </section>
          ))}
        </div>
      )}
      <div className="a-empty a-section">
        <h2>Mettre un thème en ligne</h2>
        <p>
          L&apos;aperçu n&apos;est visible que par toi, et seulement tant que tu es connecté : tes visiteurs continuent de
          voir le thème en ligne. C&apos;est ici que tu choisiras le thème actif et que tu retoucheras ses couleurs.
        </p>
      </div>
    </>
  );
}
