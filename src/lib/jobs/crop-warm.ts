/**
 * Préchauffage des recadrages (job « crop-warm », file image, priorité la plus basse).
 *
 * Les variantes recadrées (/media/crop/…) sont extraites de l'original à la première demande, UNE à la fois ;
 * sur une page neuve ou un serveur redémarré, des dizaines de visiteurs ou d'images demandent leurs variantes
 * ensemble et la file d'attente déborde (503). Ici, le serveur fait lui-même la première demande, en fond :
 *  - à la publication d'une page (et quand une page est publiée), puis au démarrage pour chaque page publiée ;
 *  - le job demande la page PUBLIQUE à ce serveur (localhost) et lit les URLs `/media/crop/…` du HTML rendu : les
 *    mêmes règles de cadrage que les visiteurs (cases de grille, tuiles, anciens cadrages), sans les recopier ;
 *  - une variante à la fois, largeurs courantes d'abord, en cédant la place à toute image à traiter (le job se
 *    remet en file avec sa progression) : un envoi ne attend jamais derrière le préchauffage.
 * Désactivable : CROP_WARM=0. Adresse du serveur : PORT (3000 par défaut), CROP_WARM_ORIGIN pour la changer.
 */
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { CROP_PREFIX, parseCropKey, type CropRequest } from "@/lib/images/crop";
import { CropBusy, CropRejected, ensureCrop, verifyCrop } from "@/lib/images/crop-cache";
import { rectKey } from "@/lib/images/crop";
import { findCropSource } from "@/lib/media";
import { isSpecialSlug } from "@/lib/special-pages";

/** Largeurs servies le plus souvent (écran 1× à 2×) d'abord : ce que les visiteurs demandent en premier. */
const WIDTH_RANK = [960, 1600, 2400, 480, 3600, 4800];
const rank = (w: number) => {
  const i = WIDTH_RANK.indexOf(w);
  return i < 0 ? WIDTH_RANK.length : i;
};

const enabled = () => process.env.CROP_WARM !== "0";

/** URLs de recadrage d'un HTML rendu, sans doublon, dans l'ordre de préchauffage. La signature se vérifie à la génération. */
export function cropKeysIn(html: string): CropRequest[] {
  const seen = new Set<string>();
  const out: CropRequest[] = [];
  for (const m of html.matchAll(/\/media\/(crop\/[0-9]+\/x[0-9]+y[0-9]+w[0-9]+h[0-9]+-[0-9a-f]{20}\/[0-9]+\.(?:avif|webp))/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const parsed = m[1].startsWith(CROP_PREFIX) ? parseCropKey(m[1]) : null;
    if (parsed) out.push(parsed);
  }
  const first = new Map<string, number>();
  out.forEach((k, i) => {
    const id = `${k.mediaId}/${rectKey(k.units)}`;
    if (!first.has(id)) first.set(id, i);
  });
  // Recadrage par recadrage (ordre de la page), AVIF d'abord, largeurs courantes d'abord.
  return out.sort((a, b) => {
    const ra = first.get(`${a.mediaId}/${rectKey(a.units)}`)!;
    const rb = first.get(`${b.mediaId}/${rectKey(b.units)}`)!;
    return ra - rb || (a.format === b.format ? 0 : a.format === "avif" ? -1 : 1) || rank(a.width) - rank(b.width);
  });
}

type WarmPayload = { pageId: number; offset?: number };

const queuedFor = (pageId: number) =>
  getDb()
    .select({ payload: schema.jobs.payload })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.kind, "crop-warm"), eq(schema.jobs.status, "queued")))
    .all()
    .some((j) => (j.payload as WarmPayload | null)?.pageId === pageId);

/** Met en file le préchauffage d'une page ; false si désactivé ou déjà en file. */
export function enqueueCropWarm(pageId: number, delayMs = 3000): boolean {
  if (!enabled() || queuedFor(pageId)) return false;
  getDb()
    .insert(schema.jobs)
    .values({ kind: "crop-warm", payload: { pageId, offset: 0 }, runAfter: delayMs > 0 ? new Date(Date.now() + delayMs) : null })
    .run();
  return true;
}

/** Un job par page publiée (démarrage du serveur) ; renvoie le nombre mis en file. */
export function enqueueCropWarmAll(delayMs = 20_000): number {
  let n = 0;
  for (const p of getDb().select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.published, true), isNull(schema.pages.deletedAt))).all()) if (enqueueCropWarm(p.id, delayMs)) n++;
  return n;
}

const origin = () => process.env.CROP_WARM_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type WarmOutcome = { done: true; made: number } | { done: false; offset: number; made: number };

/**
 * Exécute une tranche du préchauffage d'une page. `shouldYield` : une image attend (le job cède la place).
 * Lève si la page ne répond pas (le worker retente).
 */
export async function runCropWarm(payload: WarmPayload, shouldYield: () => boolean): Promise<WarmOutcome> {
  const row = getDb().select({ slug: schema.pages.slug, published: schema.pages.published, deletedAt: schema.pages.deletedAt }).from(schema.pages).where(eq(schema.pages.id, payload.pageId)).get();
  if (!row || !row.published || row.deletedAt) return { done: true, made: 0 };
  const slug = row.slug.fr ?? "";
  const res = await fetch(`${origin()}/fr${slug ? `/${slug}` : ""}`, { headers: { "user-agent": "portfolio-crop-warm" }, signal: AbortSignal.timeout(60_000) });
  // La page « Page introuvable » (lot 89) répond 404 par construction : son contenu est celui qu'on veut préchauffer.
  if (!res.ok && !(isSpecialSlug(slug) && res.status === 404)) throw new Error(`page publique : réponse ${res.status}`);
  const keys = cropKeysIn(await res.text());
  let made = 0;
  for (let i = payload.offset ?? 0; i < keys.length; i++) {
    const k = keys[i];
    if (verifyCrop(k.mediaId, rectKey(k.units), k.sig)) {
      const source = findCropSource(k.mediaId);
      for (let attempt = 0; source && attempt < 10; attempt++) {
        try {
          await ensureCrop(source, k.units, k.width, k.format);
          made++;
          break;
        } catch (error) {
          if (error instanceof CropBusy) await sleep(1000);
          else {
            if (!(error instanceof CropRejected)) console.error(`[crop] préchauffage du média ${k.mediaId} : ${error instanceof Error ? error.message : error}`);
            break;
          }
        }
      }
    }
    if (i + 1 < keys.length && shouldYield()) return { done: false, offset: i + 1, made };
  }
  return { done: true, made };
}
