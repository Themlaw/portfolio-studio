/**
 * GET /admin/api/editeur/session?chemin=/fr/… — pour le bouton « Modifier
 * cette page » du site public (src/components/EditThisPage.tsx) : la session
 * est-elle celle d'un admin, et quelle page de l'admin correspond à ce chemin ?
 * Lecture seule, jamais en cache. Le bouton ne l'appelle que si le cookie
 * indicateur `portfolio-admin` (posé par le proxy sur l'admin) existe : les
 * visiteurs n'interrogent jamais la session.
 */
import { getAdminLang, getAdminT } from "@/i18n/admin-server";
import { getAdminSession } from "@/lib/auth/guard";
import { isNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { adminT } from "@/i18n/admin-msg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) return Response.json({ admin: false }, { headers: NO_STORE });
  const path = new URL(request.url).searchParams.get("chemin") ?? "";
  const match = /^\/(fr|en)(?:\/(.*?))?\/?$/.exec(path);
  let editUrl: string | null = null;
  if (match) {
    const [, locale, raw = ""] = match;
    let slug: string | null;
    try {
      slug = decodeURIComponent(raw);
    } catch {
      slug = null;
    }
    if (slug !== null) {
      const rows = getDb().select({ id: schema.pages.id, slug: schema.pages.slug }).from(schema.pages).where(isNull(schema.pages.deletedAt)).all();
      const page = rows.find((r) => {
        const value = (typeof r.slug === "string" ? parseJson(r.slug) : r.slug) as Record<string, string> | undefined;
        return (value?.[locale] ?? "") === slug;
      });
      if (page) editUrl = `/admin/pages/${page.id}/editer?langue=${locale}`;
    }
  }
  // Lot 130b : le bouton « Modifier cette page » parle la langue d'interface du compte (le site public ne porte pas le catalogue d'admin).
  const label = (await getAdminT("canvasPreview"))("editThisPage");
  return Response.json({ admin: true, editUrl, label, lang: await getAdminLang() }, { headers: NO_STORE });
}
