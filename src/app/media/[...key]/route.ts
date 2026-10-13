/**
 * GET/HEAD /media/<clé> — médias servis depuis le stockage (MediaStorage).
 *
 * - Clés versionnées par hash de contenu : cache public d'un an, immuable.
 * - ETag + If-None-Match (comparaison faible : W/"…" accepté) → 304.
 * - Range (une seule plage) → 206 ; plage hors limites → 416. If-Range respecté.
 * - nosniff et CSP `default-src 'none'; style-src 'unsafe-inline'; sandbox`
 *   sur TOUS les médias : un fichier ouvert directement ne peut ni exécuter de
 *   script ni charger quoi que ce soit (SVG piégé, HTML déguisé…).
 * - `crop/<média>/<rect>-<signature>/<largeur>.<format>` : variante RECADRÉE, extraite de
 *   l'original à la demande (src/lib/images/crop-cache.ts) ; signature, largeur et file
 *   d'attente bornées (503 si pleine). Lecture seule, jamais d'écriture venue du client.
 * - PDF (bloc CV, doc/<hash>/document.pdf) : TOUJOURS en pièce jointe
 *   (Content-Disposition: attachment), jamais affiché dans le navigateur sur
 *   l'origine du site ; nom de fichier propre tiré de `?name=` réduit à
 *   [a-z0-9-] (« cv » sinon), jamais le nom du fichier envoyé.
 */
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { CROP_PREFIX, parseCropKey, rectKey, type CropRequest } from "@/lib/images/crop";
import { CropBusy, CropRejected, ensureCrop, verifyCrop } from "@/lib/images/crop-cache";
import { findCropSource, findMediaByKey } from "@/lib/media";
import { attachmentHeader } from "@/lib/pdf/limits";
import { getStorage, isValidKey, type ByteRange } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string[] }> };

const MEDIA_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const KIT_MIME: Record<string, string> = { svg: "image/svg+xml", avif: "image/avif", webp: "image/webp", png: "image/png" };

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

const CROP_MIME = { avif: "image/avif", webp: "image/webp" } as const;

/** Variante recadrée : signature vérifiée AVANT tout accès au disque ou à sharp. */
async function serveCrop(request: Request, crop: CropRequest, head: boolean) {
  if (!verifyCrop(crop.mediaId, rectKey(crop.units), crop.sig)) return notFound();
  const source = findCropSource(crop.mediaId);
  if (!source) return notFound();
  const etag = `"crop-${crop.mediaId}-${rectKey(crop.units)}-${crop.width}-${crop.format}"`;
  const headers = new Headers({
    "Content-Type": CROP_MIME[crop.format],
    ETag: etag,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": MEDIA_CSP,
  });
  const inm = request.headers.get("if-none-match");
  if (inm && weakMatch(inm, etag)) return new Response(null, { status: 304, headers });
  let out: { file: string; size: number };
  try {
    out = await ensureCrop(source, crop.units, crop.width, crop.format);
  } catch (error) {
    if (error instanceof CropBusy) {
      return new Response("Busy", { status: 503, headers: { "Retry-After": "2", "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
    }
    if (error instanceof CropRejected) return notFound();
    console.error(`[crop] média ${crop.mediaId} : génération impossible`, error);
    return new Response("Error", { status: 500, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
  }
  headers.set("Content-Length", String(out.size));
  if (head) return new Response(null, { status: 200, headers });
  return new Response(Readable.toWeb(createReadStream(out.file)) as ReadableStream, { status: 200, headers });
}

async function serve(request: Request, { params }: Params, head: boolean) {
  const key = (await params).key.join("/");
  if (!isValidKey(key)) return notFound();
  if (key.startsWith(CROP_PREFIX)) {
    const crop = parseCropKey(key);
    return crop ? serveCrop(request, crop, head) : notFound();
  }

  // Éléments du kit de thème : contenu adressé (kit/<hash>.<ext>), produit par le
  // pipeline du kit ; type d'après l'extension, mêmes en-têtes que les médias.
  const kit = /^kit\/[0-9a-f]{16}\.(svg|avif|webp|png)$/.exec(key);
  const row = kit ? null : findMediaByKey(key);
  if (!kit && (!row || row.status !== "ready")) return notFound();
  const mime = kit ? KIT_MIME[kit[1]] : row!.mime;

  const storage = getStorage();
  const stat = await storage.stat(key);
  if (!stat) return notFound();

  const etag = `"${key}"`;
  const headers = new Headers({
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": MEDIA_CSP,
  });

  if (mime === "application/pdf") {
    headers.set("Content-Disposition", attachmentHeader(new URL(request.url).searchParams.get("name") ?? ""));
    // Jamais rendu par le visualiseur intégré du navigateur, même ouvert dans un cadre.
    headers.set("X-Frame-Options", "DENY");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }

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
