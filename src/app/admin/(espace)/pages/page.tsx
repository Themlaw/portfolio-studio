import PageHeader from "@/components/admin/PageHeader";
import PagesManager from "@/components/admin/PagesManager";
import TrashViews from "@/components/admin/TrashViews";
import { getTrashSummary, listPagesForAdmin, listTrashedPages } from "@/lib/admin";

export const metadata = { title: "Pages" };

export default async function PagesPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const view = (await searchParams).vue === "corbeille" ? "corbeille" : "liste";
  const trashed = listTrashedPages();
  return (
    <>
      <PageHeader
        title="Pages"
        intro="Organise les pages de ton site : leur place dans le menu, leur adresse en français et en anglais, et les rubriques qui les composent."
      />
      <TrashViews base="/admin/pages" label="Pages" view={view} trashCount={trashed.length} />
      <PagesManager pages={listPagesForAdmin()} trashed={trashed} view={view} summary={getTrashSummary()} />
    </>
  );
}
