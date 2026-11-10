import { intlLocale } from "@/i18n/admin-lang";
import { getAdminLang, getAdminMessages } from "@/i18n/admin-server";
import { isDraftView } from "@/lib/draft-view";
import { isAdminPreview } from "@/lib/page-preview";
import { getPreviewTheme, isPreviewBannerHidden } from "@/lib/theme";

import { AdminIntlProvider } from "./AdminIntl";
import EditLayerLoader from "./EditLayerLoader";
import PreviewBridgeLoader from "./PreviewBridgeLoader";
import PreviewExit from "./PreviewExit";

import "@/app/admin/preview-banner.css";

/**
 * Bandeau « Aperçu : <thème> · Quitter l'aperçu », fixé en bas du site.
 * Rendu seulement en draft mode avec un aperçu valide (session admin) : ces
 * requêtes sont dynamiques ; le HTML en cache public n'en contient jamais.
 * Sans thème prévisualisé, l'aperçu montre les pages telles qu'enregistrées
 * (pages non publiées comprises). Dans le cadre de l'éditeur de thème, le
 * bandeau est masqué et PreviewBridge (chargé à part par PreviewBridgeLoader) applique les réglages en direct.
 *
 * Vue brouillon (toile de l'éditeur visuel, src/lib/draft-view.ts) : la
 * couche d'édition est ajoutée ; hors cadre, le bandeau signale que les
 * brouillons sont visibles.
 */
export default async function PreviewBanner() {
  const theme = await getPreviewTheme();
  const admin = await isAdminPreview();
  if (!theme && !admin) return null;
  const drafts = admin && (await isDraftView());
  // Lot 130b : les commandes d'édition de la toile parlent la langue de l'interface d'admin (réglage du compte), pas celle du site.
  const intl = admin ? { locale: intlLocale(await getAdminLang()), messages: (await getAdminMessages()) as never } : null;
  if (await isPreviewBannerHidden()) return admin && intl ? <AdminIntlProvider {...intl}><PreviewBridgeLoader /></AdminIntlProvider> : null;
  return (
    <>
      {admin && intl && (
        <AdminIntlProvider {...intl}>
          <PreviewBridgeLoader />
          {drafts && <EditLayerLoader />}
        </AdminIntlProvider>
      )}
      <div className="preview-banner-spacer" aria-hidden="true" />
      <div className="preview-banner" role="status" lang="fr">
        <span>
          {theme ? (
            <>
              Aperçu du thème : <strong>{theme.name}</strong>
            </>
          ) : drafts ? (
            <>
              <strong>Aperçu du site</strong> : brouillons et pages non publiées visibles
            </>
          ) : (
            <>
              <strong>Aperçu du site</strong> : pages non publiées visibles
            </>
          )}
        </span>
        <PreviewExit />
      </div>
    </>
  );
}
