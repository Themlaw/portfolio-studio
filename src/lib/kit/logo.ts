/**
 * Logo d'un thème depuis une IMAGE importée (lot 61, étape « Logo » de l'éditeur de thème) : l'image envoyée à la médiathèque
 * (file d'envoi commune, type vérifié par signature, variantes AVIF et WebP produites par le worker) devient `assets.kit.signature`
 * du thème. Aucun décodage ici : les variantes déjà produites (borne de 4096 px) sont COPIÉES sous /media/kit/<sha256 16>.<ext>
 * (contenu adressé, comme le kit), jamais l'original. Le logo garde ses couleurs (`colors: true`) : « Garder mes couleurs » est
 * le réglage par défaut, « Prendre la couleur du texte » le retire (variants.css teinte alors la même image en masque).
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { done, fail, type ActionResult } from "@/lib/edit/result";
import type { ImageVariants } from "@/lib/images/variants";
import { getStorage } from "@/lib/storage";
import { pickLogoVariant } from "@/themes/guided";
import type { KitImage } from "@/themes/schema";

/** Un logo pèse peu : au-delà, ce n'est pas un logo (et on ne le lit pas en mémoire). */
const MAX_BYTES = 6 * 1024 * 1024;

async function bytesOf(key: string): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of await getStorage().getStream(key)) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > MAX_BYTES) return null;
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

async function store(data: Buffer, ext: "avif" | "webp"): Promise<string> {
  const key = `kit/${createHash("sha256").update(data).digest("hex").slice(0, 16)}.${ext}`;
  const storage = getStorage();
  if (!(await storage.stat(key))) await storage.put(key, Readable.from(data));
  return `/media/${key}`;
}

export async function logoFromMedia(mediaId: unknown): Promise<ActionResult<{ signature: KitImage }>> {
  if (typeof mediaId !== "number" || !Number.isInteger(mediaId) || mediaId <= 0) return fail("Image inconnue.");
  const row = getDb()
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, mediaId), isNull(schema.media.deletedAt)))
    .get();
  if (!row || row.kind !== "image") return fail("Cette image n'existe plus : envoie-la de nouveau.");
  if (row.status !== "ready") return fail("L'image est encore en préparation : réessaie dans un instant.");
  const variants = row.variants as ImageVariants | null;
  const pick = variants?.v === 1 ? pickLogoVariant(variants.files) : null;
  if (!pick) return fail("Cette image ne peut pas servir de logo (aucune version utilisable).");
  const [avif, webp] = await Promise.all([bytesOf(pick.avif.key), bytesOf(pick.webp.key)]);
  if (!avif || !webp) return fail("Cette image est trop lourde pour un logo.");
  const signature: KitImage = { avif: await store(avif, "avif"), webp: await store(webp, "webp"), w: pick.avif.w, h: pick.avif.h, colors: true };
  return done({ signature });
}
