/**
 * GET /site-icon/<taille>.png : l'icône de l'onglet choisie dans les réglages, déclinée à l'enregistrement.
 * Le point dans l'adresse tient la route hors du proxy (comme /media). 404 tant qu'aucune icône n'est choisie.
 */
import { Readable } from "node:stream";

import { ICON_SIZES } from "@/lib/seo-schema";
import { getSeoSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = /^(\d{2,3})\.png$/.exec(file);
  const size = m ? Number(m[1]) : 0;
  if (!(ICON_SIZES as readonly number[]).includes(size)) return notFound();
  const seo = await getSeoSettings();
  if (!seo.favicon) return notFound();
  const key = `${seo.favicon.dir}/${size}.png`;
  const storage = getStorage();
  const stat = await storage.stat(key);
  if (!stat) return notFound();
  return new Response(Readable.toWeb(await storage.getStream(key)) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(stat.size),
      // L'adresse des balises porte l'empreinte du dossier : un nouveau choix change l'adresse.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
