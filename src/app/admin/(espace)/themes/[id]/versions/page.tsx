import Link from "next/link";
import { notFound } from "next/navigation";

import PageHeader from "@/components/admin/PageHeader";
import ThemeVersions from "@/components/admin/ThemeVersions";
import { assertAdmin } from "@/lib/auth/guard";
import { getMineState, listVersions, RETAIN_UNPINNED } from "@/lib/themes/versions";

export const metadata = { title: "Historique de Mon thème" };
export const dynamic = "force-dynamic";

export default async function ThemeVersionsPage({ params }: { params: Promise<{ id: string }> }) {
  await assertAdmin();
  const { id } = await params;
  const mine = getMineState();
  if (!mine || mine.id !== id) notFound();
  return (
    <>
      <PageHeader
        title={`Historique de ${mine.name}`}
        intro={`Chaque kit, import, changement de modèle ou séance d'édition ajoute une version. Revenir à une version en crée une nouvelle, identique : rien n'est perdu. Les ${RETAIN_UNPINNED} dernières versions sont gardées, avec celles que tu marques et celles qui ont été en ligne.`}
      />
      <ThemeVersions
        mine={{ id: mine.id, name: mine.name, version: mine.version, publishedVersion: mine.publishedVersion, live: mine.live }}
        versions={listVersions(mine.id)}
      />
      <p className="a-help" style={{ marginTop: 24 }}>
        <Link href="/admin/themes">← Tous les thèmes</Link>
      </p>
    </>
  );
}
