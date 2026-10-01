import Diagnostic from "@/components/admin/Diagnostic";
import PageHeader from "@/components/admin/PageHeader";
import SettingsForm from "@/components/admin/SettingsForm";
import { getSettingsForAdmin } from "@/lib/admin";

export const metadata = { title: "Réglages" };

export default async function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Réglages"
        intro="L'identité de ton site : ton nom, ton métier, l'adresse où l'on peut t'écrire et tes réseaux. Une modification est visible partout à la fois dès que tu enregistres."
      />
      <SettingsForm initial={getSettingsForAdmin()} />
      <Diagnostic />
    </>
  );
}
