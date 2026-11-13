import Link from "next/link";
import { notFound } from "next/navigation";

import PageHeader from "@/components/admin/PageHeader";
import ThemeVersions from "@/components/admin/ThemeVersions";
import { assertAdmin } from "@/lib/auth/guard";
import { getMineState, getVersionTheme, listVersions, RETAIN_UNPINNED } from "@/lib/themes/versions";
import { getAdminT } from "@/i18n/admin-server";

export async function generateMetadata() {
  return { title: (await getAdminT("themePages"))("versions.metaTitle") };
}
export const dynamic = "force-dynamic";

export default async function ThemeVersionsPage({ params }: { params: Promise<{ id: string }> }) {
  await assertAdmin();
  const t = await getAdminT("themePages");
  const { id } = await params;
  const mine = getMineState();
  if (!mine || mine.id !== id) notFound();
  const versions = listVersions(mine.id);
  // Maquette de chaque version : fond provisoire de sa vignette, le temps que la vraie page se charge.
  const themes = Object.fromEntries(versions.flatMap((v) => { const th = getVersionTheme(mine.id, v.n); return th ? [[v.n, th]] : []; }));
  return (
    <>
      <PageHeader
        title={t("versions.title", { name: mine.name })}
        intro={t("versions.intro", { count: RETAIN_UNPINNED })}
      />
      <ThemeVersions
        mine={{ id: mine.id, name: mine.name, version: mine.version, publishedVersion: mine.publishedVersion, live: mine.live }}
        versions={versions}
        themes={themes}
      />
      <p className="a-help" style={{ marginTop: 24 }}>
        <Link href="/admin/themes">{t("versions.allThemes")}</Link>
      </p>
    </>
  );
}
