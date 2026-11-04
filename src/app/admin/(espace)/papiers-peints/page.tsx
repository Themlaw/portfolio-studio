import PageHeader from "@/components/admin/PageHeader";
import WallpaperLibrary from "@/components/admin/WallpaperLibrary";
import { getCardWallpaperSetting, wallpaperUseCounts } from "@/lib/admin";
import { listWallpapersForAdmin } from "@/lib/wallpapers";
import { requireAdmin } from "@/lib/auth/guard";

export const metadata = { title: "Papiers peints" };

export default async function WallpapersPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader
        title="Papiers peints"
        intro="Tes motifs dessinés, à répéter en fond : sur une page entière, derrière un grand composant, ou sur les cartes. Importe-en autant que tu veux (PNG ou WebP sur fond transparent)."
      />
      <WallpaperLibrary initial={listWallpapersForAdmin()} trashed={listWallpapersForAdmin(true)} counts={wallpaperUseCounts()} cards={getCardWallpaperSetting()} />
    </>
  );
}
