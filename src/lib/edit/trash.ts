/**
 * Purge de la corbeille (lot 23) : pages, projets et médias mis à la corbeille depuis plus de 30 jours sont
 * supprimés pour de bon. Appelée au démarrage du worker puis toutes les 15 minutes (src/lib/jobs/worker.ts), et
 * directement par les tests (`now` simule le temps). Ordre : pages (leurs blocs libèrent projets et médias),
 * projets (leurs emplacements libèrent les médias), médias. Un élément encore cité par un bloc reste à la
 * corbeille (réessayé au tour suivant) : jamais de lien cassé créé par la purge.
 *
 * Module léger (ni registre de blocs ni éditeur) : le worker du serveur le charge au démarrage.
 */
import { and, eq, isNotNull, isNull, like, lt, or } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { purgeCrops } from "@/lib/images/crop-cache";
import { parseVariants } from "@/lib/images/variants";
import { findMediaUsages, findPageReferences, findProjectReferences } from "@/lib/references";
import { getStorage } from "@/lib/storage";
import { TRASH_DAYS } from "@/lib/trash";

import { purgeWallpaper } from "./wallpapers";

export type PurgeReport = { pages: number; projects: number; media: number; wallpapers: number };

/**
 * Page : ses blocs partent avec elle, la surcouche de planches portée par son brouillon est abandonnée.
 * Refusée (false) si un bloc d'une AUTRE page la montre encore.
 */
export function purgePage(id: number): boolean {
  const db = getDb();
  const page = db.select({ deletedAt: schema.pages.deletedAt }).from(schema.pages).where(eq(schema.pages.id, id)).get();
  if (!page?.deletedAt) return false;
  if (findPageReferences(id).some((u) => u.kind === "block" && u.pageId !== id)) return false;
  db.transaction((tx) => {
    tx.delete(schema.slots).where(and(eq(schema.slots.draftPageId, id), eq(schema.slots.draftState, "added"))).run();
    tx.update(schema.slots)
      .set({ draftState: null, draftPosition: null, draftMediaId: null, draftPageId: null, draftTitle: null, draftDescription: null, draftKey: null })
      .where(eq(schema.slots.draftPageId, id))
      .run();
    tx.update(schema.projects).set({ draftText: null, draftTextPageId: null }).where(eq(schema.projects.draftTextPageId, id)).run();
    tx.update(schema.projects).set({ draftLayout: null, draftLayoutPageId: null }).where(eq(schema.projects.draftLayoutPageId, id)).run();
    // Projets créés dans son brouillon (jamais publiés) : partent avec elle (clé étrangère en cascade).
    tx.delete(schema.pages).where(eq(schema.pages.id, id)).run();
  });
  return true;
}

/** Projet : emplacements en cascade, médias conservés. Refusé (false) si un bloc le cite encore. */
export function purgeProject(id: number): boolean {
  const db = getDb();
  const project = db.select({ slug: schema.projects.slug, deletedAt: schema.projects.deletedAt }).from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!project?.deletedAt) return false;
  if (findProjectReferences(project.slug).some((u) => u.kind === "block")) return false;
  db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
  return true;
}

/** Une ligne média utilise-t-elle ce fichier (original, ou variante listée dans `variants`) ? */
export function mediaKeyInUse(key: string): boolean {
  const db = getDb();
  return Boolean(db.select({ id: schema.media.id }).from(schema.media).where(or(eq(schema.media.key, key), like(schema.media.variants, `%${key}%`))).get());
}

/**
 * Média : ligne, original et variantes du stockage (seulement ceux qu'aucune autre ligne ne référence),
 * recadrages gardés. Refusé (false) si quelque chose l'utilise de nouveau.
 */
export async function purgeMedia(id: number): Promise<boolean> {
  const db = getDb();
  const keys = db.transaction((tx) => {
    const media = tx.select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!media?.deletedAt || media.status === "processing") return null;
    if (findMediaUsages(id).length) return null;
    // Fichier d'un papier peint encore dans la bibliothèque (ou sa corbeille) : la ligne du motif le retient.
    if (tx.select({ id: schema.wallpapers.id }).from(schema.wallpapers).where(eq(schema.wallpapers.mediaId, id)).get()) return null;
    // Les emplacements qui l'ont montré (jamais, en principe : utilisé = non supprimable) gardent la largeur.
    if (media.width && media.height) {
      tx.update(schema.slots).set({ aspect: media.width / media.height }).where(and(eq(schema.slots.mediaId, id), isNull(schema.slots.aspect))).run();
    }
    tx.delete(schema.media).where(eq(schema.media.id, id)).run(); // slots.media_id → null (clé étrangère)
    const hash16 = media.sha256?.slice(0, 16);
    const sharedOriginal = tx.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.key, media.key)).get();
    const sharedVariants = hash16 ? tx.select({ id: schema.media.id }).from(schema.media).where(like(schema.media.sha256, `${hash16}%`)).get() : undefined;
    return [
      ...(sharedOriginal ? [] : [media.key]),
      ...(sharedVariants ? [] : (parseVariants(media.variants)?.files.map((f) => f.key) ?? [])),
    ];
  });
  if (!keys) return false;
  const storage = getStorage();
  for (const key of keys) {
    // Le fichier a pu être redemandé entre le calcul de la liste et ici (même contenu renvoyé, `reviveIfTrashed`) : on revérifie
    // juste avant chaque suppression qu'aucune ligne média ne l'utilise.
    if (mediaKeyInUse(key)) continue;
    await storage.delete(key).catch((e) => console.error(`[media] suppression de ${key} impossible`, e));
  }
  // Recadrages gardés sur disque (variantes extraites de l'original) : plus de média, plus de recadrage.
  await purgeCrops(id);
  return true;
}

export async function purgeTrash(now: number = Date.now()): Promise<PurgeReport> {
  const db = getDb();
  // Mis à la corbeille avant ce seuil = délai écoulé.
  const cutoff = new Date(now - TRASH_DAYS * 86_400_000);
  const report: PurgeReport = { pages: 0, projects: 0, media: 0, wallpapers: 0 };
  for (const p of db.select({ id: schema.pages.id }).from(schema.pages).where(and(isNotNull(schema.pages.deletedAt), lt(schema.pages.deletedAt, cutoff))).all()) {
    if (purgePage(p.id)) report.pages++;
  }
  for (const p of db.select({ id: schema.projects.id }).from(schema.projects).where(and(isNotNull(schema.projects.deletedAt), lt(schema.projects.deletedAt, cutoff))).all()) {
    if (purgeProject(p.id)) report.projects++;
  }
  // Motifs avant médias : leur fichier passe à la corbeille des médias avec la même date, et part dans ce même tour.
  for (const w of db.select({ id: schema.wallpapers.id }).from(schema.wallpapers).where(and(isNotNull(schema.wallpapers.deletedAt), lt(schema.wallpapers.deletedAt, cutoff))).all()) {
    if (purgeWallpaper(w.id)) report.wallpapers++;
  }
  for (const m of db.select({ id: schema.media.id }).from(schema.media).where(and(isNotNull(schema.media.deletedAt), lt(schema.media.deletedAt, cutoff))).all()) {
    if (await purgeMedia(m.id)) report.media++;
  }
  if (report.pages || report.projects || report.media || report.wallpapers) {
    console.log(`[corbeille] purgés après ${TRASH_DAYS} jours : ${report.pages} page(s), ${report.projects} projet(s), ${report.media} média(s), ${report.wallpapers} papier(s) peint(s)`);
  }
  return report;
}

export type TrashKind = "page" | "project" | "media" | "wallpaper";

/**
 * « Supprimer définitivement » un élément de la corbeille, sans attendre les 30 jours (même purge que le job,
 * pour cet élément seul). Refusé si l'élément n'est pas à la corbeille, ou s'il est encore cité par un bloc.
 */
export async function purgeOne(kind: TrashKind, id: number): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = getDb();
  const row =
    kind === "page"
      ? db.select({ d: schema.pages.deletedAt }).from(schema.pages).where(eq(schema.pages.id, id)).get()
      : kind === "project"
        ? db.select({ d: schema.projects.deletedAt }).from(schema.projects).where(eq(schema.projects.id, id)).get()
        : kind === "wallpaper"
          ? db.select({ d: schema.wallpapers.deletedAt }).from(schema.wallpapers).where(eq(schema.wallpapers.id, id)).get()
          : db.select({ d: schema.media.deletedAt }).from(schema.media).where(eq(schema.media.id, id)).get();
  if (!row?.d) return { ok: false, message: "Cet élément n'est pas dans la corbeille." };
  const done = kind === "page" ? purgePage(id) : kind === "project" ? purgeProject(id) : kind === "wallpaper" ? purgeWallpaper(id) : await purgeMedia(id);
  return done ? { ok: true } : { ok: false, message: "Cet élément est encore utilisé (bloc, projet ou brouillon) : il reste à la corbeille." };
}

/**
 * « Vider la corbeille » : purge immédiate de tout (les papiers peints ont leur propre corbeille, dans leur écran : ils ne partent pas ici), dans l'ordre du job (pages, projets, puis médias que les
 * premiers libèrent). Plusieurs tours : une page peut ne devenir supprimable qu'une fois une autre partie.
 * `kept` : éléments encore cités, restés à la corbeille.
 */
export async function emptyTrash(): Promise<PurgeReport & { kept: number }> {
  const db = getDb();
  const report: PurgeReport = { pages: 0, projects: 0, media: 0, wallpapers: 0 };
  for (let pass = 0; pass < 5; pass++) {
    const before = report.pages + report.projects + report.media;
    for (const p of db.select({ id: schema.pages.id }).from(schema.pages).where(isNotNull(schema.pages.deletedAt)).all()) if (purgePage(p.id)) report.pages++;
    for (const p of db.select({ id: schema.projects.id }).from(schema.projects).where(isNotNull(schema.projects.deletedAt)).all()) if (purgeProject(p.id)) report.projects++;
    for (const m of db.select({ id: schema.media.id }).from(schema.media).where(isNotNull(schema.media.deletedAt)).all()) if (await purgeMedia(m.id)) report.media++;
    if (report.pages + report.projects + report.media === before) break;
  }
  const kept =
    db.select({ id: schema.pages.id }).from(schema.pages).where(isNotNull(schema.pages.deletedAt)).all().length +
    db.select({ id: schema.projects.id }).from(schema.projects).where(isNotNull(schema.projects.deletedAt)).all().length +
    db.select({ id: schema.media.id }).from(schema.media).where(isNotNull(schema.media.deletedAt)).all().length;
  return { ...report, kept };
}
