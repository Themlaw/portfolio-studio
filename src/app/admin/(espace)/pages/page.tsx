import PageHeader from "@/components/admin/PageHeader";
import PagesManager from "@/components/admin/PagesManager";
import { listPagesForAdmin } from "@/lib/admin";

export const metadata = { title: "Pages" };

export default function PagesPage() {
  return (
    <>
      <PageHeader
        title="Pages"
        intro="Organise les pages de ton site : leur place dans le menu, leur adresse en français et en anglais, et les blocs qui les composent."
      />
      <PagesManager pages={listPagesForAdmin()} />
    </>
  );
}
