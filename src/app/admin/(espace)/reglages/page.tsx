import Diagnostic from "@/components/admin/Diagnostic";
import PageHeader from "@/components/admin/PageHeader";
import FontLibraryPanel from "@/components/admin/FontLibraryPanel";
import SeoForm from "@/components/admin/SeoForm";
import SettingsForm from "@/components/admin/SettingsForm";
import { getFaviconForAdmin, getSeoForAdmin, getSettingsForAdmin, listMediaForAdmin, siteDraftHolder } from "@/lib/admin";
import { monoColors } from "@/lib/favicon-plan";
import { siteNameFor } from "@/lib/site-schema";
import { getPublishedTheme } from "@/lib/theme";
import { fontLibraryRows } from "@/lib/fonts/library";

export const metadata = { title: "Réglages" };

export default async function SettingsPage() {
  const fonts = fontLibraryRows();
  const settings = getSettingsForAdmin();
  const images = listMediaForAdmin().filter((m) => m.kind === "image");
  return (
    <>
      <PageHeader
        title="Réglages"
        intro="L'identité de ton site : ton nom, ton métier, l'adresse où l'on peut t'écrire et tes réseaux. Ici, une modification est en ligne dès que tu enregistres ; dans l'éditeur d'une page, les mêmes champs sont publiés avec la page."
      />
      <SettingsForm initial={settings} pending={siteDraftHolder()} />
      <SeoForm initial={getSeoForAdmin()} media={images} siteName={siteNameFor(settings.site.name, "fr")} favicon={getFaviconForAdmin()} colors={monoColors(await getPublishedTheme())} />
      <FontLibraryPanel rows={fonts.rows} total={fonts.total} limits={{ families: fonts.limits.families, totalBytes: fonts.limits.totalBytes }} />
      <details className="a-advanced a-section">
        <summary>Avancé</summary>
        <Diagnostic />
      </details>
    </>
  );
}
