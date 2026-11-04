import BackupPanel from "@/components/admin/BackupPanel";
import PageHeader from "@/components/admin/PageHeader";
import { getBackupStatus } from "@/lib/backup/service";
import { requireAdmin } from "@/lib/auth/guard";

export const metadata = { title: "Sauvegardes" };
export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Sauvegardes" intro="Le site garde tout seul des copies de ton travail. Ici, tu vois les copies faites, tu en fais une quand tu veux, et tu en télécharges une sur ton ordinateur." />
      <BackupPanel initial={await getBackupStatus()} />
    </>
  );
}
