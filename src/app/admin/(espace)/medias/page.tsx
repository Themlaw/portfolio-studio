import MediaLibrary from "@/components/admin/MediaLibrary";
import PageHeader from "@/components/admin/PageHeader";
import { listMediaForAdmin, listTrashedMedia } from "@/lib/admin";
import { formatGb, storageUsage } from "@/lib/upload/quota";

export const metadata = { title: "Médiathèque" };

export default function MediaPage() {
  return (
    <>
      <PageHeader
        title="Médiathèque"
        intro="Toutes tes images et vidéos. Envoie-en de nouvelles, complète leur texte alternatif et vois où chacune est utilisée."
      />
      <MediaLibrary
        initial={listMediaForAdmin()}
        trashed={listTrashedMedia()}
        usage={(() => {
          const u = storageUsage();
          return { used: formatGb(u.usedBytes), quota: u.quotaBytes ? formatGb(u.quotaBytes) : null, ratio: u.quotaBytes ? u.usedBytes / u.quotaBytes : null };
        })()}
      />
    </>
  );
}
