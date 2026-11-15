import { getAdminT } from "@/i18n/admin-server";
import { requireAdmin } from "@/lib/auth/guard";
import { listMediaForAdmin } from "@/lib/admin";
import { listShareLinks } from "@/lib/edit/share-links";
import LinksLibrary from "@/components/admin/LinksLibrary";

export async function generateMetadata() {
  return { title: (await getAdminT("links"))("title") };
}

export const dynamic = "force-dynamic";

export default async function LinksPage() {
  await requireAdmin();
  const links = listShareLinks();
  const media = listMediaForAdmin().filter((m) => m.status !== "failed");
  return <LinksLibrary initial={links} media={media} />;
}