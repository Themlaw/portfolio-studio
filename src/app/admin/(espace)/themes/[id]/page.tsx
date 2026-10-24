import { notFound } from "next/navigation";

import FaviconSetting from "@/components/admin/FaviconSetting";
import ThemeEditor from "@/components/admin/ThemeEditor";
import WallpaperLibrary from "@/components/admin/WallpaperLibrary";
import { getCardWallpaperSetting, getFaviconForAdmin, getThemeOverview, listMediaForAdmin, listPagesForAdmin, wallpaperUseCounts } from "@/lib/admin";
import { monoColors } from "@/lib/favicon-plan";
import { getSite } from "@/lib/settings";
import { getPublishedTheme } from "@/lib/theme";
import { readPublishedSite } from "@/lib/edit/site";
import { listWallpapersForAdmin } from "@/lib/wallpapers";
import { withFrameRing } from "@/lib/kit/frame-ring";
import { getMineState } from "@/lib/themes/versions";
import { FONT_VARIABLE_CLASSES } from "@/themes/fonts";

export const metadata = { title: "Modifier un thème" };

export default async function ThemeEditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ etape?: string; onglet?: string }> }) {
  const { id } = await params;
  const { etape, onglet } = await searchParams;
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
      {/* Couleurs du site choisies depuis l'éditeur visuel (lot 17f) : par-dessus le thème EN LIGNE. */}
      <ThemeEditor
        initial={await withFrameRing(theme)}
        isActive={active && !isMine}
        mine={isMine && mine ? { version: mine.version, publishedVersion: mine.publishedVersion, live: mine.live, published: mine.published } : null}
        activeName={themes.find((t) => t.id === activeId)?.name}
        sitePalette={active ? (readPublishedSite().styles?.palette ?? {}) : {}}
        pages={pages}
        editorHref={home ? `/admin/pages/${home.id}/editer` : undefined}
        initialStep={etape}
        initialTab={onglet}
        // Icône de l'onglet (lot 83) : un réglage de SITE (pas du thème en cours d'édition), montré avec le thème en ligne.
        favicon={
          <FaviconSetting
            initial={getFaviconForAdmin()}
            media={listMediaForAdmin().filter((m) => m.kind === "image")}
            siteName={(await getSite("fr")).name}
            colors={monoColors(await getPublishedTheme())}
            scope="guide"
            kitHref={`/admin/themes/${encodeURIComponent(theme.id)}/kit`}
          />
        }
        // L'ancienne page « Papiers peints » : un onglet de l'étape « Papier et motifs » (ne dépend pas du thème édité).
        wallpapers={
          <>
            <p className="a-help a-step-intro">
              Tes motifs dessinés, à répéter en fond : sur une page entière, derrière un grand composant, ou sur les cartes. Importe-en autant que tu veux (PNG ou WebP sur fond transparent).
            </p>
            <WallpaperLibrary initial={listWallpapersForAdmin()} trashed={listWallpapersForAdmin(true)} counts={wallpaperUseCounts()} cards={getCardWallpaperSetting()} />
          </>
        }
      />
    </div>
  );
}
