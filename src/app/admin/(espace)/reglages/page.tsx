import Diagnostic from "@/components/admin/Diagnostic";
import PageHeader from "@/components/admin/PageHeader";
import FontLibraryPanel from "@/components/admin/FontLibraryPanel";
import SettingsForm from "@/components/admin/SettingsForm";
import { getSettingsForAdmin, siteDraftHolder } from "@/lib/admin";
import { fontLibraryRows } from "@/lib/fonts/library";

export const metadata = { title: "Réglages" };

export default async function SettingsPage() {
  const fonts = fontLibraryRows();
  return (
    <>
      <PageHeader
        title="Réglages"
        intro="L'identité de ton site : ton nom, ton métier, l'adresse où l'on peut t'écrire et tes réseaux. Ici, une modification est en ligne dès que tu enregistres ; dans l'éditeur d'une page, les mêmes champs sont publiés avec la page."
      />
      <SettingsForm initial={getSettingsForAdmin()} pending={siteDraftHolder()} />
      <FontLibraryPanel rows={fonts.rows} total={fonts.total} limits={{ families: fonts.limits.families, totalBytes: fonts.limits.totalBytes }} />
      <details className="a-advanced a-section">
        <summary>Avancé</summary>
        <Diagnostic />
      </details>
    </>
  );
}
