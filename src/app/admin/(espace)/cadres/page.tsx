import FrameLibrary from "@/components/admin/FrameLibrary";
import PageHeader from "@/components/admin/PageHeader";
import { listFramesForAdmin, themeFrameInfo } from "@/lib/frames";
import { requireAdmin } from "@/lib/auth/guard";
import { getAdminT } from "@/i18n/admin-server";

export async function generateMetadata() {
  return { title: (await getAdminT("themePages"))("frames.title") };
}

/** Bibliothèque de cadres (lot 74), sœur de « Papiers peints » : mêmes composants, mêmes gestes. */
export default async function FramesPage() {
  await requireAdmin();
  const t = await getAdminT("themePages");
  return (
    <>
      <PageHeader
        title={t("frames.title")}
        intro={t("frames.intro")}
      />
      <FrameLibrary initial={listFramesForAdmin()} theme={themeFrameInfo()} />
    </>
  );
}
