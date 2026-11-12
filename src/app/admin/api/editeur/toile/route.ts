/**
 * GET /admin/api/editeur/toile?page=<id>&langue=fr|en — source de l'iframe de
 * l'éditeur visuel : active la vue brouillon (draft mode + cookie
 * `page-draft`, src/lib/draft-view.ts) puis redirige vers la page dans la
 * langue voulue (pages non publiées comprises). Admin connecté et requête de
 * la même origine (en-tête Sec-Fetch-Site, envoyé par le navigateur pour une
 * iframe) obligatoires. Sec-Fetch-Site n'est envoyé qu'en contexte sécurisé
 * (HTTPS ou localhost) : en HTTP sur une autre adresse, la toile répond 403
 * (voir README). GET : c'est la source d'une iframe ; l'effet (voir
 * les brouillons dans SON navigateur) ne modifie aucune donnée.
 */
import { eq } from "drizzle-orm";
import { cookies, draftMode } from "next/headers";

import { assertAdmin } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";
import { DRAFT_VIEW_COOKIE } from "@/lib/draft-view";
import { isSameOrigin } from "@/lib/preview";
import { adminT } from "@/i18n/admin-msg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  if (!isSameOrigin(request)) return new Response(t("Origine refusée"), { status: 403 });
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("page"));
  const locale = url.searchParams.get("langue") === "en" ? "en" : "fr";
  const page = Number.isInteger(id) && id > 0 ? getDb().select({ slug: schema.pages.slug }).from(schema.pages).where(eq(schema.pages.id, id)).get() : undefined;
  if (!page) return new Response("Page inconnue", { status: 404 });

  (await draftMode()).enable();
  (await cookies()).set(DRAFT_VIEW_COOKIE, "1", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // Cookie de session (sans durée) : fermé avec le navigateur ; « Quitter
    // l'aperçu » le retire aussi.
  });
  const slug = page.slug[locale];
  const location = slug ? `/${locale}/${encodeURIComponent(slug).replace(/%2F/g, "/")}` : `/${locale}`;
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}
