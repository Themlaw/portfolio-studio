import Link from "next/link";

import Diagnostic from "@/components/admin/Diagnostic";
import PageHeader from "@/components/admin/PageHeader";
import FontLibraryPanel from "@/components/admin/FontLibraryPanel";
import SeoForm from "@/components/admin/SeoForm";
import SettingsForm from "@/components/admin/SettingsForm";
import { getFaviconForAdmin, getSeoForAdmin, getSettingsForAdmin, listMediaForAdmin, siteDraftHolder } from "@/lib/admin";
import { monoColors } from "@/lib/favicon-plan";
import { siteNameFor } from "@/lib/site-schema";
import { getPublishedTheme } from "@/lib/theme";
import { fontLibraryRows } from "@/lib/fonts/library";
import { requireAdmin } from "@/lib/auth/guard";
import { getAdminT } from "@/i18n/admin-server";

export async function generateMetadata() {
  return { title: (await getAdminT("settings"))("title") };
}

export default async function SettingsPage() {
  await requireAdmin();
  const t = await getAdminT("settings");
  const fonts = fontLibraryRows();
  const settings = getSettingsForAdmin(true);
  const images = listMediaForAdmin().filter((m) => m.kind === "image");
  return (
    <>
      <PageHeader
        title={t("title")}
        intro={t("intro")}
      />
      <SettingsForm initial={settings} pending={siteDraftHolder()} />
      <SeoForm initial={getSeoForAdmin()} media={images} siteName={siteNameFor(settings.site.name, "fr")} favicon={getFaviconForAdmin()} colors={monoColors(await getPublishedTheme())} />
      <FontLibraryPanel rows={fonts.rows} total={fonts.total} limits={{ families: fonts.limits.families, totalBytes: fonts.limits.totalBytes }} />
      <p className="a-section" data-testid="journal-link">
        {t("journalAsk")} <Link href="/admin/journal">{t("journalOpen")}</Link>.
      </p>
      <details className="a-advanced a-section">
        <summary>{t("advanced")}</summary>
        <Diagnostic />
      </details>
    </>
  );
}
