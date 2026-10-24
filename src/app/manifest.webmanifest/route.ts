/** GET /manifest.webmanifest : nom du site, couleurs du thème en ligne et icônes (dont la « maskable » d'Android), lot 83. */
import { manifestOf, planIcon } from "@/lib/favicon-plan";
import { getSeoSettings, getSite } from "@/lib/settings";
import { getPublishedTheme } from "@/lib/theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const [seo, theme, site] = await Promise.all([getSeoSettings(), getPublishedTheme(), getSite("fr")]);
  const plan = planIcon(seo, theme, site.name);
  const version = new URL(request.url).searchParams.get("v");
  return new Response(JSON.stringify(manifestOf(plan, site.name, "fr")), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": version === plan.fp ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
