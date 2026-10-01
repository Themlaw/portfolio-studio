import AdminShell from "@/components/admin/AdminShell";
import { requireAdmin } from "@/lib/auth/guard";
import { getSettingsForAdmin } from "@/lib/admin";

/** Espace connecté : session vérifiée en base, puis barre latérale + contenu. */
export default async function AdminSpaceLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  const settings = getSettingsForAdmin();
  return (
    <AdminShell siteName={settings.site.name || "Portfolio"} userEmail={session.user.email}>
      {children}
    </AdminShell>
  );
}
