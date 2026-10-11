import Diagnostic from "@/components/admin/Diagnostic";
import PageHeader from "@/components/admin/PageHeader";
import FontLibraryPanel from "@/components/admin/FontLibraryPanel";
import SettingsForm from "@/components/admin/SettingsForm";
import { getSettingsForAdmin } from "@/lib/admin";
import { fontLibraryRows } from "@/lib/fonts/library";

export const metadata = { title: "Réglages" };

export default async function SettingsPage() {
  const fonts = fontLibraryRows();
  return (
    <>
      <PageHeader
        title="Réglages"
        intro="L'identité de ton site : ton nom, ton métier, l'adresse où l'on peut t'écrire et tes réseaux. Une modification est visible partout à la fois dès que tu enregistres."
      />
      <SettingsForm initial={getSettingsForAdmin()} />
      <FontLibraryPanel rows={fonts.rows} total={fonts.total} limits={{ families: fonts.limits.families, totalBytes: fonts.limits.totalBytes }} />
      <Diagnostic />
    </>
  );
}
