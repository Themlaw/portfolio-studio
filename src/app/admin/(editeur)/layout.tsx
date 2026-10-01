import { Toaster } from "@/components/admin/editing";
import { UploadQueueProvider } from "@/components/admin/UploadQueue";
import { requireAdmin } from "@/lib/auth/guard";

/**
 * Éditeur visuel, en plein écran : hors du cadre de l'admin (pas de barre
 * latérale), même session vérifiée en base que l'espace connecté.
 */
export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <UploadQueueProvider>
      {children}
      <Toaster />
    </UploadQueueProvider>
  );
}
