/**
 * Seed initial : UNE fois dans la vie d'une base, repéré par le réglage
 * `seededAt`. Vider le contenu ensuite est un choix de l'admin, jamais un
 * déclencheur de re-seed.
 *
 * Deux temps :
 *  1. prepareSeedFiles() — asynchrone, hors transaction : copie seed/media/*
 *     dans le stockage (clés par hash de contenu, donc idempotent) ;
 *  2. seedRows() — synchrone, DANS la transaction BEGIN IMMEDIATE du démarrage
 *     (src/lib/db/bootstrap.ts) : insertions idempotentes table par table.
 * Sources : seed/artworks.json, seed/projects.json, seed/site.ts, seed/media/*,
 * presets de thèmes.
 */
import { own } from "../own";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { count, eq } from "drizzle-orm";

import artworkData from "../../../seed/artworks.json";
import projectData from "../../../seed/projects.json";
import { EXTRA_MEDIA, SEED_PAGES, SITE_SETTINGS } from "../../../seed/site";
import { contentKey, getStorage } from "@/lib/storage";
import { DEFAULT_THEME_ID, PRESETS } from "@/themes/presets";

import { getSqlite, type Db } from "./index";
import { collectionPages, renameVideoLook, upgradeContent } from "./upgrade";
import { unwrapContainers } from "./unwrap";
import { blocks, media, pages, projects, settings, slots, themes, type Localized } from "./schema";

export const SEEDED_AT_KEY = "seededAt";

type SeedArtwork = {
  id: string;
  slug: string;
  collection: "characters" | "backgrounds" | "animation";
  title: Localized;
  description: Localized;
  image: string;
  width: number;
  height: number;
  year: number;
  featured: boolean;
  duration?: string;
  videoId?: string;
  reel?: boolean;
};

type SeedProject = {
  slug: string;
  year: string;
  featured: boolean;
  title: Localized;
  context: Localized;
  description: Localized;
  artworkIds: string[];
};

type StoredFile = { key: string; size: number; mime: string };
/** Vidéo de test (lot 38) : fichier MP4 + poster, rangés comme le fait la conversion d'une vidéo envoyée (`vid/<hash16>/…`). */
export type SeedVideo = { sha256: string; mp4: StoredFile; poster: StoredFile };
export type SeedFiles = { artworks: Map<string, StoredFile>; extra: Map<string, StoredFile>; video: SeedVideo };

/** Vidéo de test de la médiathèque de démo (lot 38) : générée par ffmpeg, 5 s, 1280 × 720, H.264 + AAC, 626 Ko :
 *  ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=25 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 5 -c:v libx264 -preset slow -crf 30
 *    -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 48k -ac 1 -af volume=0.25 video-de-test.mp4 ; poster : une image à 0,5 s, WebP. */
const SEED_VIDEO = { file: "video-de-test.mp4", poster: "video-de-test-poster.webp", name: "video-de-test.mp4", width: 1280, height: 720, duration: 5, posterWidth: 1280, posterHeight: 720 } as const;

const MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

export function seedDir(): string {
  return path.resolve(process.cwd(), "seed");
}

/** Copie un fichier de seed/media dans le stockage, clé versionnée par hash. */
async function importMedia(file: string): Promise<StoredFile> {
  const source = path.join(seedDir(), "media", file);
  const bytes = await readFile(source);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = contentKey(hash, file);
  const stored = await getStorage().put(key, createReadStream(source));
  return { key, size: stored.size, mime: MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" };
}

export async function prepareSeedFiles(): Promise<SeedFiles> {
  const artworks = new Map<string, StoredFile>();
  for (const a of artworkData as SeedArtwork[]) artworks.set(a.id, await importMedia(path.basename(a.image)));
  const extra = new Map<string, StoredFile>();
  for (const file of Object.keys(EXTRA_MEDIA)) extra.set(file, await importMedia(file));
  return { artworks, extra, video: await importVideo() };
}

/** Copie la vidéo de test dans le stockage sous les clés d'une vidéo convertie (`vid/<hash16>/720.mp4`, `poster-1280.webp`). */
async function importVideo(): Promise<SeedVideo> {
  const dir = path.join(seedDir(), "media");
  const bytes = await readFile(path.join(dir, SEED_VIDEO.file));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const hash16 = sha256.slice(0, 16);
  const mp4Key = `vid/${hash16}/720.mp4`;
  const posterKey = `vid/${hash16}/poster-${SEED_VIDEO.posterWidth}.webp`;
  const mp4 = await getStorage().put(mp4Key, createReadStream(path.join(dir, SEED_VIDEO.file)));
  const poster = await getStorage().put(posterKey, createReadStream(path.join(dir, SEED_VIDEO.poster)));
  return { sha256, mp4: { key: mp4Key, size: mp4.size, mime: "video/mp4" }, poster: { key: posterKey, size: poster.size, mime: "image/webp" } };
}

/** Résout une clé de page symbolique (`page`, `reelPage`…) en `…Id` numérique. */
function resolvePageRefs(value: unknown, ids: Map<string, number>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolvePageRefs(v, ids));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if ((k === "page" || k.endsWith("Page")) && typeof v === "string") {
        const id = ids.get(v);
        if (id === undefined) throw new Error(`Seed : page inconnue « ${v} »`);
        out[`${k}Id`] = id;
      } else {
        out[k] = resolvePageRefs(v, ids);
      }
    }
    return out;
  }
  return value;
}

/** La base a-t-elle déjà été seedée ? (tolérant : tables absentes = non) */
export function isSeeded(db: Db): boolean {
  try {
    return Boolean(db.select().from(settings).where(eq(settings.key, SEEDED_AT_KEY)).get());
  } catch {
    return false;
  }
}

function mediaId(db: Db, file: StoredFile, values: Omit<typeof media.$inferInsert, "key" | "size" | "mime">): number {
  db.insert(media)
    .values({ ...values, key: file.key, size: file.size, mime: file.mime })
    .onConflictDoNothing()
    .run();
  return db.select({ id: media.id }).from(media).where(eq(media.key, file.key)).get()!.id;
}

/**
 * Thèmes livrés ↔ base, à chaque démarrage (base déjà seedée) : un thème livré
 * ajouté au code (dossier src/themes/presets/<slug>/) apparaît dans Admin →
 * Thèmes sans base neuve ; un thème livré modifié dans le code y est mis à jour
 * (il n'est pas modifiable depuis l'admin, le code fait foi). Un thème de
 * l'utilisatrice qui porterait déjà cet identifiant n'est jamais touché.
 * Synchrone, dans la transaction du démarrage. Renvoie [ajoutés, mis à jour].
 */
export function syncPresets(db: Db): [number, number] {
  let added = 0;
  let updated = 0;
  for (const theme of Object.values(PRESETS)) {
    const data = JSON.stringify(theme);
    const row = db.select().from(themes).where(eq(themes.id, theme.id)).get();
    if (!row) {
      db.insert(themes).values({ id: theme.id, name: theme.name, preset: true, data }).run();
      added++;
    } else if (!row.preset) {
      console.warn(`[db] thème livré « ${theme.id} » ignoré : un thème personnel porte déjà cet identifiant`);
    } else if (row.data !== data || row.name !== theme.name) {
      db.update(themes).set({ name: theme.name, data, updatedAt: new Date() }).where(eq(themes.id, theme.id)).run();
      updated++;
    }
  }
  return [added, updated];
}

/**
 * Insertions du seed, idempotentes table par table (onConflictDoNothing sur
 * les clés naturelles). Pages et blocs, sans clé naturelle, ne sont insérés
 * que si la table pages est vide. Termine par le marqueur `seededAt`.
 * À appeler dans une transaction (synchrone, better-sqlite3).
 */
export function seedRows(db: Db, files: SeedFiles): void {
  const artworks = artworkData as SeedArtwork[];
  const projectList = projectData as SeedProject[];

  for (const theme of Object.values(PRESETS)) {
    db.insert(themes)
      .values({ id: theme.id, name: theme.name, preset: theme.preset, data: JSON.stringify(theme) })
      .onConflictDoNothing()
      .run();
  }

  const activeThemeId =
    own(PRESETS, process.env.PORTFOLIO_THEME) ? (process.env.PORTFOLIO_THEME as string) : DEFAULT_THEME_ID;
  for (const [key, value] of [
    ["activeThemeId", activeThemeId],
    ["site", SITE_SETTINGS.site],
    ["socials", SITE_SETTINGS.socials],
  ] as const) {
    db.insert(settings).values({ key, value: JSON.stringify(value) }).onConflictDoNothing().run();
  }

  // Médias des œuvres, dans l'ordre du fichier de contenu.
  const mediaIds = new Map<string, number>();
  for (const a of artworks) {
    mediaIds.set(
      a.id,
      mediaId(db, files.artworks.get(a.id)!, {
        kind: "image",
        originalName: path.basename(a.image),
        width: a.width,
        height: a.height,
      }),
    );
  }
  const extraIds = new Map<string, number>();
  for (const [file, info] of Object.entries(EXTRA_MEDIA)) {
    extraIds.set(
      file,
      mediaId(db, files.extra.get(file)!, {
        kind: "image",
        originalName: file,
        width: info.width,
        height: info.height,
        alt: info.alt,
      }),
    );
  }

  // Vidéo de test (lot 38) : prête à l'emploi dans la médiathèque (un vrai MP4, pas un SVG), comme une vidéo déjà convertie.
  {
    const v = files.video;
    mediaId(db, v.mp4, {
      sha256: v.sha256,
      kind: "video",
      originalName: SEED_VIDEO.name,
      width: SEED_VIDEO.width,
      height: SEED_VIDEO.height,
      duration: SEED_VIDEO.duration,
      hasAudio: true,
      variants: {
        v: 1,
        originalRemoved: true,
        files: [
          { key: v.mp4.key, w: SEED_VIDEO.width, h: SEED_VIDEO.height, format: "mp4", size: v.mp4.size },
          { key: v.poster.key, w: SEED_VIDEO.posterWidth, h: SEED_VIDEO.posterHeight, format: "webp", size: v.poster.size },
        ],
      },
      alt: { fr: "Vidéo de test : mire animée avec compteur, 5 secondes", en: "Test video: animated test pattern with a counter, 5 seconds" },
    });
  }

  // Projets (clé naturelle : slug), puis slots dans l'ordre global des œuvres.
  const projectIds = new Map<string, number>();
  projectList.forEach((p, position) => {
    db.insert(projects)
      .values({
        slug: p.slug,
        title: p.title,
        context: p.context,
        description: p.description,
        year: p.year,
        featured: p.featured,
        position,
      })
      .onConflictDoNothing()
      .run();
    projectIds.set(p.slug, db.select({ id: projects.id }).from(projects).where(eq(projects.slug, p.slug)).get()!.id);
  });
  const owner = new Map<string, { project: string; position: number }>();
  for (const p of projectList) p.artworkIds.forEach((id, position) => owner.set(id, { project: p.slug, position }));
  for (const a of artworks) {
    const o = owner.get(a.id);
    if (!o) continue; // œuvre orpheline : pas de planche
    db.insert(slots)
      .values({
        projectId: projectIds.get(o.project)!,
        position: o.position,
        mediaId: mediaIds.get(a.id)!,
        aspect: a.width > 0 && a.height > 0 ? a.width / a.height : null,
        slug: a.slug,
        collection: a.collection,
        title: a.title,
        description: a.description,
        year: a.year,
        featured: a.featured,
        duration: a.duration ?? null,
        videoId: a.videoId ?? null,
        reel: a.reel ?? false,
      })
      .onConflictDoNothing()
      .run();
  }

  // Pages et blocs : seulement sur une table pages vide.
  const [{ n }] = db.select({ n: count() }).from(pages).all();
  if (n === 0) {
    const pageIds = new Map<string, number>();
    for (const page of SEED_PAGES) {
      const row = db
        .insert(pages)
        .values({ slug: page.slug, title: page.title, meta: page.meta, navOrder: page.navOrder, published: true })
        .returning({ id: pages.id })
        .get();
      pageIds.set(page.key, row.id);
    }
    for (const page of SEED_PAGES) {
      page.blocks.forEach((block, position) => {
        let props = resolvePageRefs(block.props, pageIds) as Record<string, unknown>;
        if (typeof props.portrait === "string") {
          const { portrait, ...rest } = props;
          props = { ...rest, portraitMediaId: extraIds.get(portrait as string) };
        }
        db.insert(blocks)
          .values({ pageId: pageIds.get(page.key)!, position, type: block.type, props: JSON.stringify(props) })
          .run();
      });
    }
  }

  // Contenu de départ écrit dans l'ancien format, puis converti comme une base
  // existante (migration 0014 : conteneurs, grilles, menu) : un seul chemin.
  upgradeContent(getSqlite());
  // Puis comme la migration 0021 (v0.19) : plus de conteneur « Projet mis en avant » (la migration 0014 en produit encore).
  unwrapContainers(getSqlite());
  // Et comme la migration 0022 (v0.19) : page de collection, entrées automatiques, en-têtes de collection → Titre.
  collectionPages(getSqlite());
  renameVideoLook(getSqlite());

  db.insert(settings)
    .values({ key: SEEDED_AT_KEY, value: JSON.stringify(new Date().toISOString()) })
    .onConflictDoNothing()
    .run();
}
