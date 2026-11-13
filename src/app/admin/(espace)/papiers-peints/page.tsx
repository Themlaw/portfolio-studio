import PageHeader from "@/components/admin/PageHeader";
import WallpaperLibrary from "@/components/admin/WallpaperLibrary";
import { getCardWallpaperSetting, wallpaperUseCounts } from "@/lib/admin";
import { listWallpapersForAdmin } from "@/lib/wallpapers";
import { requireAdmin } from "@/lib/auth/guard";
import { getAdminT } from "@/i18n/admin-server";

export async function generateMetadata() {
  return { title: (await getAdminT("themePages"))("wallpapers.title") };
}

export default async function WallpapersPage() {
  await requireAdmin();
  const t = await getAdminT("themePages");
  return (
    <>
      <PageHeader
        title={t("wallpapers.title")}
        intro={t("wallpapers.intro")}
      />
      <WallpaperLibrary initial={listWallpapersForAdmin()} trashed={listWallpapersForAdmin(true)} counts={wallpaperUseCounts()} cards={getCardWallpaperSetting()} />
    </>
  );
}
