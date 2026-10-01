import { isAdminPreview } from "@/lib/page-preview";
import { getPreviewTheme } from "@/lib/theme";

import PreviewBridge from "./PreviewBridge";

import "@/app/admin/preview-banner.css";

/**
 * Bandeau « Aperçu : <thème> · Quitter l'aperçu », fixé en bas du site.
 * Rendu seulement en draft mode avec un aperçu valide (session admin) : ces
 * requêtes sont dynamiques ; le HTML en cache public n'en contient jamais.
 * Sans thème prévisualisé, l'aperçu montre les pages telles qu'enregistrées
 * (pages non publiées comprises). Dans le cadre de l'éditeur de thème, le
 * bandeau est masqué et PreviewBridge applique les réglages en direct.
 */
export default async function PreviewBanner() {
  const theme = await getPreviewTheme();
  const admin = await isAdminPreview();
  if (!theme && !admin) return null;
  return (
    <>
      {admin && <PreviewBridge />}
      <div className="preview-banner-spacer" aria-hidden="true" />
      <div className="preview-banner" role="status" lang="fr">
        <span>
          {theme ? (
            <>
              Aperçu : <strong>{theme.name}</strong>
            </>
          ) : (
            <>
              <strong>Aperçu</strong> : pages non publiées visibles
            </>
          )}
        </span>
        <form method="post" action="/admin/apercu/quitter">
          <button type="submit">Quitter l&apos;aperçu</button>
        </form>
      </div>
    </>
  );
}
