/**
 * GET/HEAD /media/<clé> — médias servis depuis le stockage (MediaStorage).
 *
 * - Clés versionnées par hash de contenu : cache public d'un an, immuable.
 * - ETag + If-None-Match (comparaison faible : W/"…" accepté) → 304.
 * - Range (une seule plage) → 206 ; plage hors limites → 416. If-Range respecté.
 * - nosniff et CSP `default-src 'none'; style-src 'unsafe-inline'; sandbox`
 *   sur TOUS les médias : un fichier ouvert directement ne peut ni exécuter de
 *   script ni charger quoi que ce soit (SVG piégé, HTML déguisé…).
 */
import { Readable } from "node:stream";

import { findMediaByKey } from "@/lib/media";
import { getStorage, isValidKey, type ByteRange } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string[] }> };

const MEDIA_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** Comparaison faible des ETag (RFC 9110 §8.8.3.2) : on ignore le préfixe W/. */
function weakMatch(header: string, etag: string): boolean {
  const opaque = (t: string) => t.trim().replace(/^W\//, "");
  return header.split(",").some((t) => t.trim() === "*" || opaque(t) === opaque(etag));
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

/** Plage demandée : ByteRange, "unsatisfiable", ou null (en-tête absent ou ignoré). */
function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null; // plusieurs plages ou syntaxe inconnue : réponse complète
  const [, a, b] = match;
  if (a === "" && b === "") return null;
  let start: number;
  let end: number;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

async function serve(request: Request, { params }: Params, head: boolean) {
  const key = (await params).key.join("/");
  if (!isValidKey(key)) return notFound();

  const row = findMediaByKey(key);
  if (!row || row.status !== "ready") return notFound();

  const storage = getStorage();
  const stat = await storage.stat(key);
  if (!stat) return notFound();

  const etag = `"${key}"`;
  const headers = new Headers({
    "Content-Type": row.mime,
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": MEDIA_CSP,
  });

  const inm = request.headers.get("if-none-match");
  if (inm && weakMatch(inm, etag)) {
    return new Response(null, { status: 304, headers });
  }

  const ifRange = request.headers.get("if-range");
  const rangeAllowed = !ifRange || ifRange === etag;
  const range = rangeAllowed ? parseRange(request.headers.get("range"), stat.size) : null;

  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${stat.size}`);
    return new Response(null, { status: 416, headers });
  }

  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    if (head) return new Response(null, { status: 206, headers });
    const stream = await storage.getStream(key, range);
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
  }

  headers.set("Content-Length", String(stat.size));
  if (head) return new Response(null, { status: 200, headers });
  const stream = await storage.getStream(key);
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
}

export function GET(request: Request, ctx: Params) {
  return serve(request, ctx, false);
}

export function HEAD(request: Request, ctx: Params) {
  return serve(request, ctx, true);
}
