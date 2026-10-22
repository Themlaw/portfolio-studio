/**
 * POST /admin/apercu (formulaire natif, target="_blank" ou cadre d'aperçu) :
 * active l'aperçu — draft mode, plus le cookie d'id si un thème est donné —
 * puis ouvre le site. `page=<id>` : ouvre cette page (pages non publiées
 * comprises) avec le thème en ligne, ou, si `id` désigne un thème, avec ce thème
 * en essai (éditeur de thème : une page au choix). Admin connecté et même origine obligatoires.
 * L'écran d'origine (champ `retour`, sinon Referer, s'il est dans l'admin) est
 * retenu : « Quitter l'aperçu » y ramène.
 */
import { eq } from "drizzle-orm";
import { cookies, draftMode } from "next/headers";

import { assertAdmin } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";
import { touchThemeUsage } from "@/lib/edit/theme-usage";
import { adminScreen, isSameOrigin, PREVIEW_FROM_COOKIE } from "@/lib/preview";
import { getTheme, PREVIEW_COOKIE } from "@/lib/theme";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await assertAdmin();
  if (!isSameOrigin(request)) return new Response("Origine refusée", { status: 403 });

  const form = await request.formData().catch(() => null);
  const id = String(form?.get("id") ?? "");
  const pageId = Number(form?.get("page") ?? 0);
  const locale = form?.get("langue") === "en" ? "en" : "fr";

  let location = `/${locale}`;
  if (pageId) {
    const page = getDb().select({ slug: schema.pages.slug }).from(schema.pages).where(eq(schema.pages.id, pageId)).get();
    if (!page) return new Response("Page inconnue", { status: 400 });
    location = page.slug[locale] ? `/${locale}/${encodeURIComponent(page.slug[locale])}` : `/${locale}`;
  } else if (!(await getTheme(id))) {
    return new Response("Thème inconnu", { status: 400 });
  }

  (await draftMode()).enable();
  const jar = await cookies();
  const from = adminScreen(String(form?.get("retour") ?? "") || request.headers.get("referer"));
  if (from) jar.set(PREVIEW_FROM_COOKIE, from, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 });
  else jar.delete(PREVIEW_FROM_COOKIE);
  if (pageId && !(id && (await getTheme(id)))) {
    // Aperçu d'une page : avec le thème en ligne, pas un thème en essai.
    jar.delete(PREVIEW_COOKIE);
  } else {
    // Thème préparé : retenu comme « utilisé » (menu Thème de l'éditeur, lot 63).
    touchThemeUsage(id);
    jar.set(PREVIEW_COOKIE, id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24,
    });
  }
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}
