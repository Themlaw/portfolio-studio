import MediaLibrary from "@/components/admin/MediaLibrary";
import PageHeader from "@/components/admin/PageHeader";
import { getTrashSummary, listMediaForAdmin, listTrashedMedia } from "@/lib/admin";
import { formatGb, storageUsage } from "@/lib/upload/quota";
import { requireAdmin } from "@/lib/auth/guard";

export const metadata = { title: "Médiathèque" };

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ filtre?: string; media?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const media = /^\d{1,9}$/.test(q.media ?? "") ? Number(q.media) : undefined;
  return (
    <>
      <PageHeader
        title="Médiathèque"
        intro="Toutes tes images et vidéos. Envoie-en de nouvelles, décris-les (pour les personnes malvoyantes et Google) et vois où chacune est utilisée."
      />
      <MediaLibrary
        focus={{ noalt: q.filtre === "sans-description", media }}
        initial={listMediaForAdmin()}
        trashed={listTrashedMedia()}
        summary={getTrashSummary()}
        usage={(() => {
          const u = storageUsage();
          return { used: formatGb(u.usedBytes), quota: u.quotaBytes ? formatGb(u.quotaBytes) : null, ratio: u.quotaBytes ? u.usedBytes / u.quotaBytes : null };
        })()}
      />
    </>
  );
}
