import { setRequestLocale } from "next-intl/server";

import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import type { AppLocale } from "@/i18n/routing";
import { getDraftPageInfo, isDraftView } from "@/lib/draft-view";
import { resolvePage } from "@/lib/page-preview";
import { alternatesFor, getNav } from "@/lib/pages";
import { logoCss, siteStylesCss } from "@/lib/look";
import { getMedia } from "@/lib/media";
import { getCardWallpaper, getFontFacesCss, getSiteView, getThemeFrameAll } from "@/lib/settings";
import { getWallpapers } from "@/lib/wallpapers";
import { getActiveTheme } from "@/lib/theme";
import { sitePaletteCss } from "@/themes/css";
import { pagePalette } from "@/themes/site-palette";
import type { PaletteColors } from "@/themes/palette";
import { readPagePaper, wallpaperVars } from "@/themes/wallpaper";

/**
 * Cadre du site (en-tête, contenu, pied), construit depuis la base : menu
 * (réglage `nav`), identité et réseaux (réglages) et chemins de la page
 * courante dans chaque langue pour le sélecteur de langue. Vue brouillon de
 * l'éditeur : le brouillon de l'en-tête porté par cette page, et les repères
 * d'édition (en-tête et pied communs à toutes les pages).
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; slug?: string[] }>;
}) {
  const { locale: raw, slug } = await params;
  const locale = raw as AppLocale;
  setRequestLocale(locale);

  const [page, edit] = await Promise.all([resolvePage(locale, slug), isDraftView()]);
  const view = await getSiteView(locale, page?.id);
  const [nav, fontFaces] = await Promise.all([getNav(locale, view.draft ? view.nav : undefined), getFontFacesCss()]);
  // Styles du site (lot 2) : polices téléchargées (servies par /fonts) et
  // styles des textes par rôle ; vue brouillon : ceux du brouillon du site.
  const theme = await getActiveTheme();
  // Fond de texte coloré (lot 21) : la palette effective choisit le texte lisible dessus (lue seulement alors).
  const textPalette = JSON.stringify(view.styles?.roles ?? null).includes('"backdropColor"') ? pagePalette(theme.tokens.color as PaletteColors, theme.tokens.palette, view.styles?.palette) : undefined;
  const siteCss = [fontFaces, siteStylesCss(view.styles, textPalette)].filter(Boolean).join("\n");
  // Palette et logo du site (lot 17f) : feuilles à part, posées AVANT les styles de rôle (un réglage
  // de taille du « Nom du site » passe devant celle du logo). Sans réglage : aucune balise, rendu du thème.
  // Lisibilité (lot 29) : la palette du site est toujours appliquée, lisible ou non ; le panneau « Couleurs » avertit.
  const overrides = view.styles?.palette;
  const paletteCss = sitePaletteCss(theme.tokens, overrides);
  const logoRules = logoCss(view.styles?.logo);
  // Image du logo (lot 26) : seulement une image prête (sans couleur de fond : un logo est souvent transparent) ; sinon (supprimée, vidéo) le logo du thème ou le nom en texte.
  const logoMedia = await getMedia(view.styles?.logo?.mediaId);
  const logoImage = logoMedia && !logoMedia.video && !logoMedia.pdf && logoMedia.width && logoMedia.height ? { src: logoMedia.url, sources: logoMedia.sources ? { ...logoMedia.sources, color: null } : null, width: logoMedia.width, height: logoMedia.height } : undefined;

  // Papier peint (lot 35). Page : le brouillon en vue brouillon, sinon la page publiée ; `none` cache le papier du site, un motif le remplace
  // (calque derrière la page, src/app/look.css `.page-wallpaper`). Cartes : le motif par défaut du site. Bibliothèque lue seulement si
  // l'un des deux existe (une page sans papier peint reste identique au pixel).
  const published = readPagePaper((page?.themeOverrides as { wallpaper?: unknown } | null)?.wallpaper);
  const drafted = edit && page ? getDraftPageInfo(page.id)?.wallpaper : undefined;
  const paper = drafted === undefined ? published : (drafted ?? undefined);
  const cardWp = await getCardWallpaper();
  // Cadre du thème sur toutes les photos (lot 62) : réglage du site, non par défaut ; src/themes/variants.css s'y accroche.
  const frameAll = await getThemeFrameAll();
  const library = (paper && paper.mode === "wallpaper") || cardWp || edit ? await getWallpapers() : null;
  const paperEntry = paper?.mode === "wallpaper" ? library?.get(paper.wallpaper) : undefined;
  const paperVars = paper?.mode === "wallpaper" ? wallpaperVars(paperEntry, { size: paper.size, opacity: paper.opacity }) : {};
  const cardEntry = cardWp ? library?.get(cardWp.wallpaper) : undefined;
  const cardVars = cardWp ? wallpaperVars(cardEntry, { size: cardWp.size, opacity: cardWp.opacity }, "--card-wp") : {};
  const cardsOn = Object.keys(cardVars).length > 0;

  return (
    // Cadre pleine hauteur (v0.13.1) : le contenu s'étire, le pied reste en bas
    // de l'écran même sur une page courte (`.site-frame`, globals.css).
    <div className="site-frame" {...(frameAll ? { "data-frame-all": "" } : {})} {...(cardsOn ? { "data-wp-cards": "", style: cardVars as React.CSSProperties } : {})}>
      {paper && <div className="page-wallpaper" aria-hidden="true" data-mode={paper.mode} {...(Object.keys(paperVars).length ? { style: paperVars as React.CSSProperties } : {})} />}
      {edit && library && <span hidden data-edit-wallpapers={JSON.stringify([...library.values()])} />}
      {(paletteCss || edit) && <style id="site-palette" dangerouslySetInnerHTML={{ __html: paletteCss }} {...(edit ? { "data-edit-theme": JSON.stringify({ color: theme.tokens.color, palette: theme.tokens.palette ?? null }) } : {})} />}
      {(logoRules || edit) && <style id="site-logo" dangerouslySetInnerHTML={{ __html: logoRules }} />}
      {(siteCss || edit) && <style id="site-styles" dangerouslySetInnerHTML={{ __html: siteCss }} {...(edit ? { "data-edit-styles": JSON.stringify(view.styles ?? {}) } : {})} />}
      <SiteHeader siteName={view.site.name} nav={nav} alternates={alternatesFor(page)} socials={view.site.headerSocials ? view.socials : []} edit={edit} logo={logoImage} />
      <main id="contenu">{children}</main>
      <SiteFooter site={view.site} nav={nav} socials={view.socials} edit={edit} />
    </div>
  );
}
