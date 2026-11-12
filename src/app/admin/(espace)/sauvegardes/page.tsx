import BackupPanel from "@/components/admin/BackupPanel";
import PageHeader from "@/components/admin/PageHeader";
import { getBackupStatus } from "@/lib/backup/service";
import { getAdminT } from "@/i18n/admin-server";
import { requireAdmin } from "@/lib/auth/guard";

export async function generateMetadata() {
  return { title: (await getAdminT("backups"))("title") };
}
export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  await requireAdmin();
  const t = await getAdminT("backups");
  return (
    <>
      <PageHeader title={t("title")} intro={t("intro")} />
      <BackupPanel initial={await getBackupStatus()} />
    </>
  );
}
