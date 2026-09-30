import { getPreviewTheme } from "@/lib/theme";

import "@/app/admin/preview-banner.css";

/**
 * Bandeau « Aperçu : <thème> · Quitter l'aperçu », fixé en bas du site.
 * Rendu seulement en draft mode avec un aperçu valide (session admin) : ces
 * requêtes sont dynamiques ; le HTML en cache public n'en contient jamais.
 */
export default async function PreviewBanner() {
  const theme = await getPreviewTheme();
  if (!theme) return null;
  return (
    <>
      <div className="preview-banner-spacer" aria-hidden="true" />
      <div className="preview-banner" role="status" lang="fr">
        <span>
          Aperçu : <strong>{theme.name}</strong>
        </span>
        <form method="post" action="/admin/apercu/quitter">
          <button type="submit">Quitter l&apos;aperçu</button>
        </form>
      </div>
    </>
  );
}
