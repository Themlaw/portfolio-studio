/** Réponse HTTP d'un fichier de l'icône courante (routes /site-icon/<fichier> et /favicon.ico, lot 83). */
import { readIcon } from "./favicon";
import { planIcon } from "./favicon-plan";
import { getSeoSettings, getSite } from "./settings";
import { getPublishedTheme } from "./theme";

const TYPES: Record<string, string> = { png: "image/png", ico: "image/x-icon", svg: "image/svg+xml" };

const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });

export async function iconResponse(file: string, version: string | null): Promise<Response> {
  const [seo, theme, site] = await Promise.all([getSeoSettings(), getPublishedTheme(), getSite("fr")]);
  const plan = planIcon(seo, theme, site.name);
  const data = await readIcon(plan, file);
  if (!data) return notFound();
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream",
      "Content-Length": String(data.length),
      // Adresse à l'empreinte courante : immuable. Sans empreinte (ou ancienne) : courte durée, l'icône peut avoir changé.
      "Cache-Control": version === plan.fp ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      // Comme /media : un icon.svg ouvert directement ne peut rien exécuter (docs/SECURITE.md §2.12).
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
