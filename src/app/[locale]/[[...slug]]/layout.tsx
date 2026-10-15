import { setRequestLocale } from "next-intl/server";

import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import type { AppLocale } from "@/i18n/routing";
import { isDraftView } from "@/lib/draft-view";
import { resolvePage } from "@/lib/page-preview";
import { alternatesFor, getNav } from "@/lib/pages";
import { logoCss, siteStylesCss } from "@/lib/look";
import { getMedia } from "@/lib/media";
import { getFontFacesCss, getSiteView } from "@/lib/settings";
import { getActiveTheme } from "@/lib/theme";
import { sitePaletteCss } from "@/themes/css";
import { pagePalette } from "@/themes/site-palette";
import type { PaletteColors } from "@/themes/palette";

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
  const textPalette = JSON.stringify(view.styles?.roles ?? null).includes('"backdropColor"') ? pagePalette(theme.tokens.color as PaletteColors, theme.tokens.palette, view.styles?.palette, edit) : undefined;
  const siteCss = [fontFaces, siteStylesCss(view.styles, textPalette)].filter(Boolean).join("\n");
  // Palette et logo du site (lot 17f) : feuilles à part, posées AVANT les styles de rôle (un réglage
  // de taille du « Nom du site » passe devant celle du logo). Sans réglage : aucune balise, rendu du thème.
  // Palette du site : toujours appliquée, même peu contrastée (simple avertissement dans l'éditeur, v0.21.1).
  const overrides = view.styles?.palette;
  const paletteCss = sitePaletteCss(theme.tokens, overrides);
  const logoRules = logoCss(view.styles?.logo);
  // Image du logo (lot 26) : seulement une image prête (sans couleur de fond : un logo est souvent transparent) ; sinon (supprimée, vidéo) le logo du thème ou le nom en texte.
  const logoMedia = await getMedia(view.styles?.logo?.mediaId);
  const logoImage = logoMedia && !logoMedia.video && !logoMedia.pdf && logoMedia.width && logoMedia.height ? { src: logoMedia.url, sources: logoMedia.sources ? { ...logoMedia.sources, color: null } : null, width: logoMedia.width, height: logoMedia.height } : undefined;

  return (
    // Cadre pleine hauteur (v0.13.1) : le contenu s'étire, le pied reste en bas
    // de l'écran même sur une page courte (`.site-frame`, globals.css).
    <div className="site-frame">
      {(paletteCss || edit) && <style id="site-palette" dangerouslySetInnerHTML={{ __html: paletteCss }} {...(edit ? { "data-edit-theme": JSON.stringify({ color: theme.tokens.color, palette: theme.tokens.palette ?? null }) } : {})} />}
      {(logoRules || edit) && <style id="site-logo" dangerouslySetInnerHTML={{ __html: logoRules }} />}
      {(siteCss || edit) && <style id="site-styles" dangerouslySetInnerHTML={{ __html: siteCss }} {...(edit ? { "data-edit-styles": JSON.stringify(view.styles ?? {}) } : {})} />}
      <SiteHeader siteName={view.site.name} nav={nav} alternates={alternatesFor(page)} socials={view.site.headerSocials ? view.socials : []} edit={edit} logo={logoImage} />
      <main id="contenu">{children}</main>
      <SiteFooter site={view.site} nav={nav} socials={view.socials} edit={edit} />
    </div>
  );
}
