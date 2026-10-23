import { draftMode } from "next/headers";

import KitTutorial from "@/components/admin/KitTutorial";
import PageHeader from "@/components/admin/PageHeader";
import PhotoFrameSetting from "@/components/admin/PhotoFrameSetting";
import ThemeImportButton from "@/components/admin/ThemeImportButton";
import ThemeList from "@/components/admin/ThemeList";
import { getLiveTheme, listPageAccents } from "@/lib/admin";
import { getThemeFrameAllSetting } from "@/lib/edit/frame-all";
import { lastEditedPageId } from "@/lib/edit/theme-usage";
import { previousThemeId } from "@/lib/edit/themes";
import { publishedSitePalette } from "@/lib/edit/site";
import { getPreparingTheme } from "@/lib/theme";
import { getThemeLibrary } from "@/lib/themes/versions";
import { presetThumb } from "@/themes/presets";

export const metadata = { title: "Thèmes" };

export default async function ThemesPage({ searchParams }: { searchParams: Promise<{ nouvelle?: string; via?: string }> }) {
  const library = getThemeLibrary();
  const preparing = await getPreparingTheme();
  const previewOn = (await draftMode()).isEnabled;
  const q = await searchParams;
  const nouvelle = Number(q.nouvelle);
  const notice = Number.isInteger(nouvelle) && nouvelle > 0 && library.mine ? { version: nouvelle, via: /^[a-z]{1,12}$/.test(q.via ?? "") ? (q.via as string) : "" } : null;
  const total = library.models.length + library.olds.length + (library.mine ? 1 : 0);
  return (
    <>
      <PageHeader
        title="Thèmes"
        intro="Les modèles ne changent jamais : tu as un seul thème à toi, « Mon thème », que tu fais évoluer version après version (couleurs, kit Photoshop, import). Seul ce qui est en ligne est vu par tes visiteurs : prévisualise, puis publie."
        action={
          <div className="a-header-actions">
            {/* Tuto du kit : le bouton « Télécharger le kit » de la slide 2 vise Mon thème (sinon le thème en ligne). */}
            <ThemeImportButton hasMine={Boolean(library.mine)} />
            <KitTutorial themeId={library.mine?.id || library.activeId || library.models[0]?.id || "galerie-lumineuse"} />
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
      {/* Lot 62 : seulement si le thème en ligne dessine un cadre (kit). */}
      {getLiveTheme()?.assets?.kit?.frame && <PhotoFrameSetting initial={getThemeFrameAllSetting()} />}
      {total === 0 ? (
        <div className="a-empty">
          <h2>Aucun thème enregistré</h2>
          <p>
            Le site s&apos;affiche avec l&apos;apparence par défaut. Les thèmes livrés sont installés au premier démarrage
            d&apos;une base neuve.
          </p>
        </div>
      ) : (
        <ThemeList
          library={library}
          accents={listPageAccents()}
          preparing={preparing}
          previousId={previousThemeId()}
          editorPageId={lastEditedPageId()}
          customColors={publishedSitePalette()}
          notice={notice}
          thumbs={Object.fromEntries(library.models.map((t) => [t.id, presetThumb(t.id)]))}
        />
      )}
    </>
  );
}
