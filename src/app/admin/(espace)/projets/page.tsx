import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";

/**
 * L'ancien onglet « Projets » (lot 76) n'existe plus : les projets se créent sur la toile, et la liste (ordre, suppression,
 * corbeille) est dans Pages, section « Projets ». L'écran d'UN projet (/admin/projets/<id>) reste.
 */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  await requireAdmin();
  redirect((await searchParams).vue === "corbeille" ? "/admin/pages?vue=corbeille" : "/admin/pages#projets");
}
