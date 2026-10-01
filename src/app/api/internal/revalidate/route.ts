/**
 * POST /api/internal/revalidate — réservé au processus lui-même (worker de
 * traitements) : invalide les étiquettes « media » et « projects ». Jeton
 * aléatoire propre au processus, comparé en temps constant ; sinon 404.
 */
import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";

import { TAGS } from "@/lib/cache";
import { internalToken, INTERNAL_TOKEN_HEADER } from "@/lib/jobs/notify";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const given = Buffer.from(request.headers.get(INTERNAL_TOKEN_HEADER) ?? "");
  const expected = Buffer.from(internalToken());
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Not found", { status: 404 });
  }
  revalidateTag(TAGS.media, { expire: 0 });
  revalidateTag(TAGS.projects, { expire: 0 });
  return new Response(null, { status: 204 });
}
