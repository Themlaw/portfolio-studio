/**
 * Lectures de l'admin : directes (sans cache Next), l'admin étant toujours
 * rendue à la demande. Aucun composant n'importe Drizzle : tout passe ici.
 */
import { animOf } from "@/lib/animation/sheet";
import { and, asc, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { orderCollectionPages, orderEntryPages } from "@/blocks/collection-pages";
import { pageReferences, projectReferences, type Usage } from "@/blocks/refs";
import { BLOCKS } from "@/blocks/registry";

import { ThemeSchema, type Theme } from "@/themes/schema";

import { getDb, schema } from "./db";
import { boardRefs } from "@/blocks/tree";
import { readOnboarding } from "./edit/onboarding";
import { readSiteDraft } from "./edit/site";
import { readPagesAdminOrder } from "./edit/pages-order";
import { orderPages } from "./pages-order";
import { parseJson } from "./json";
import { asSiteName, NavSchema, NETWORKS, SiteSnapSchema, type Network } from "./site-schema";
import { ORIGINALS_PREFIX, parseVariants } from "./images/variants";
import { mediaUrl } from "./media";
import { own } from "./own";
import { isSpecialPage, isSpecialSlug } from "./special-pages";
import { allBlocks, findMediaUsages, findWallpaperUsages, LOGO_USAGE_TYPE, mediaUsagesByMedia, wallpaperUsages } from "./references";
import { listWallpaperChoices } from "./wallpapers";
import { readCardWallpaper, readPagePaper, type CardWallpaper, type PagePaper } from "@/themes/wallpaper";
import { tagsByMedia, type MediaTag } from "./tags";
import type { FaviconInput } from "./favicon-spec";
import { readSeo, type SeoInput } from "./seo-schema";
import { untranslatedCount } from "./translation-gaps";

type L = { fr: string; en: string };

export type AdminCounts = { pages: number; projects: number; media: number };

export function getAdminCounts(): AdminCounts {
  const db = getDb();
  // Hors corbeille.
  // Hors pages spéciales (« Page introuvable », lot 89) : ce n'est pas une page du site au sens de l'artiste.
  const pages = db.select({ slug: schema.pages.slug }).from(schema.pages).where(isNull(schema.pages.deletedAt)).all().filter((p) => !isSpecialPage({ slug: p.slug })).length;
  const projects = db.select({ n: count() }).from(schema.projects).where(isNull(schema.projects.deletedAt)).get()?.n ?? 0;
  const media = db.select({ n: count() }).from(schema.media).where(and(isNull(schema.media.deletedAt), sql`${schema.media.id} not in (select media_id from wallpapers)`)).get()?.n ?? 0;
  return { pages, projects, media };
}

export type OnboardingStep = { key: "theme" | "project" | "page" | "publish" | "about"; done: boolean };
export type Onboarding = { hidden: boolean; steps: OnboardingStep[] };

/**
 * « Premiers pas » du tableau de bord : chaque étape se coche d'après l'état réel du site.
 * Thème et identité : geste enregistré (`lib/edit/onboarding`). Projet : un projet du site a au moins une image.
 * Page : un bloc d'une page (publiée ou non) affiche un projet. Mise en ligne : une page publiée affiche un projet.
 */
export function getOnboarding(): Onboarding {
  const db = getDb();
  const state = readOnboarding();
  const projects = db.select({ id: schema.projects.id, slug: schema.projects.slug }).from(schema.projects).where(and(isNull(schema.projects.deletedAt), isNull(schema.projects.draftPageId))).all();
  const withImage = new Set(
    db
      .select({ projectId: schema.slots.projectId, state: schema.slots.draftState })
      .from(schema.slots)
      .where(isNotNull(schema.slots.mediaId))
      .all()
      .filter((s) => s.state !== "added")
      .map((s) => s.projectId),
  );
  const hasImages = projects.some((p) => withImage.has(p.id));
  const livePages = new Set(
    db
      .select({ id: schema.pages.id, published: schema.pages.published })
      .from(schema.pages)
      .where(isNull(schema.pages.deletedAt))
      .all()
      .filter((p) => p.published)
      .map((p) => p.id),
  );
  const alive = new Set(db.select({ id: schema.pages.id }).from(schema.pages).where(isNull(schema.pages.deletedAt)).all().map((p) => p.id));
  const blocks = allBlocks();
  const shown = projects.some((p) => projectReferences(p.slug, blocks).some((u) => u.kind === "block" && alive.has(u.pageId)));
  const online = projects.some((p) => projectReferences(p.slug, blocks.filter((b) => !b.draft)).some((u) => u.kind === "block" && livePages.has(u.pageId)));
  return {
    hidden: state.hidden === true,
    steps: [
      { key: "theme", done: state.theme === true },
      { key: "project", done: hasImages },
      { key: "page", done: shown },
      { key: "publish", done: online },
      { key: "about", done: state.identity === true },
    ],
  };
}

/** `themes` : la version EN COURS de chaque thème (brouillon de Mon thème : lot 60). Ce que voient les visiteurs : `getLiveTheme()`. */
export type ThemeOverview = { activeId: string; themes: Theme[] };

/** Thème en ligne tel que le voient les visiteurs : sa version publiée (`live_data` quand elle diffère du brouillon de Mon thème). */
export function getLiveTheme(): Theme | null {
  const db = getDb();
  const active = parseJson(db.select().from(schema.settings).where(eq(schema.settings.key, "activeThemeId")).get()?.value);
  const row = typeof active === "string" ? db.select().from(schema.themes).where(eq(schema.themes.id, active)).get() : undefined;
  if (!row) return null;
  const parsed = ThemeSchema.safeParse(parseJson(row.liveData ?? row.data));
  return parsed.success ? parsed.data : null;
}

export function getThemeOverview(): ThemeOverview {
  const db = getDb();
  const themes = db
    .select()
    .from(schema.themes)
    .all()
    .flatMap((row) => {
      const parsed = ThemeSchema.safeParse(parseJson(row.data));
      return parsed.success ? [parsed.data] : [];
    });
  const active = parseJson(db.select().from(schema.settings).where(eq(schema.settings.key, "activeThemeId")).get()?.value);
  return { activeId: typeof active === "string" ? active : "", themes };
}

/** Un bloc qui montre un élément (page, projet, média) : ce qui empêche de le supprimer. */
export type BlockUse = { pageId: number; pageTitle: string; blockType: string; trashed: boolean };

/**
 * Blocs d'une liste d'usages, une ligne par page et par type de bloc (le brouillon d'un bloc publié est la
 * même place : voir `mediaUsageIndex`). `skipPage` : la page elle-même ne compte pas (liens vers soi).
 */
function blockUses(usages: Usage[], skipPage?: number): BlockUse[] {
  const pages = new Map(getDb().select({ id: schema.pages.id, title: schema.pages.title, deletedAt: schema.pages.deletedAt }).from(schema.pages).all().map((p) => [p.id, p]));
  // Brouillon = identifiant négatif (voir references.ts) : publié + brouillon du même bloc = une seule place.
  const counts = new Map<string, { pageId: number; type: string; published: number; draft: number }>();
  for (const u of usages) {
    if (u.kind !== "block" || u.pageId === skipPage) continue;
    const key = `${u.pageId}:${u.type}`;
    const c = counts.get(key) ?? { pageId: u.pageId, type: u.type, published: 0, draft: 0 };
    if (u.blockId < 0) c.draft++;
    else c.published++;
    counts.set(key, c);
  }
  return [...counts.values()].flatMap((c) => {
    const p = pages.get(c.pageId);
    const use = { pageId: c.pageId, pageTitle: p?.title.fr || `page ${c.pageId}`, blockType: own(BLOCKS, c.type)?.label ?? c.type, trashed: Boolean(p?.deletedAt) };
    return Array.from({ length: Math.max(c.published, c.draft) }, () => use);
  });
}

export type AdminPageRow = {
  id: number;
  title: string;
  titleEn: string;
  slug: L;
  navOrder: number | null;
  published: boolean;
  blocks: number;
  /** Brouillon de l'éditeur visuel en attente de publication. */
  hasDraft: boolean;
  /** Textes de la version publiée qui n'ont pas de traduction anglaise (lot 52), titre compris. */
  untranslated: number;
  /** Blocs d'AUTRES pages qui pointent vers celle-ci : tant qu'il y en a, elle ne se supprime pas. */
  blockedBy: BlockUse[];
  /** Mise à la corbeille (ms), ou null. */
  deletedAt: number | null;
  /** Page spéciale (lot 89, « Page introuvable ») : rangée à part, ni renommable, ni supprimable, ni au menu. */
  special: boolean;
};

function pageRows(trashed: boolean): AdminPageRow[] {
  const db = getDb();
  const blocks = db
    .select({ pageId: schema.blocks.pageId, n: count() })
    .from(schema.blocks)
    .groupBy(schema.blocks.pageId)
    .all();
  const byPage = new Map(blocks.map((b) => [b.pageId, b.n]));
  const all = trashed ? [] : allBlocks();
  const rows = db
    .select()
    .from(schema.pages)
    .where(trashed ? isNotNull(schema.pages.deletedAt) : isNull(schema.pages.deletedAt))
    .orderBy(trashed ? desc(schema.pages.deletedAt) : asc(schema.pages.id))
    .all()
    .map((p) => ({
      id: p.id,
      title: p.title.fr,
      titleEn: p.title.en || p.title.fr,
      slug: p.slug,
      navOrder: p.navOrder,
      published: p.published,
      blocks: byPage.get(p.id) ?? 0,
      hasDraft: p.draft !== null,
      untranslated: trashed ? 0 : untranslatedCount(p.title, all.filter((b) => b.pageId === p.id && !b.draft)),
      blockedBy: trashed ? [] : blockUses(pageReferences(p.id, all), p.id),
      deletedAt: p.deletedAt ? p.deletedAt.getTime() : null,
      special: isSpecialPage(p),
    }));
  if (trashed) return rows;
  const orderedNormal = orderPages(rows.filter((p) => !p.special), readPagesAdminOrder());
  const specials = rows.filter((p) => p.special).sort((a, b) => a.id - b.id);
  return [...orderedNormal, ...specials];
}

/** Pages du site (hors corbeille). */
export const listPagesForAdmin = (): AdminPageRow[] => pageRows(false);
/** Pages à la corbeille, la plus récente d'abord. */
export const listTrashedPages = (): AdminPageRow[] => pageRows(true);

export type AdminProjectRow = {
  id: number;
  slug: string;
  title: string;
  context: string;
  year: string;
  featured: boolean;
  slots: number;
  empty: number;
  collections: string[];
  thumb: string | null;
  /** Blocs qui montrent ce projet : tant qu'il y en a, il ne se supprime pas. */
  blockedBy: BlockUse[];
  /** Mise à la corbeille (ms), ou null. */
  deletedAt: number | null;
};

function projectRows(trashed: boolean): AdminProjectRow[] {
  const db = getDb();
  // Emplacements publiés seulement : un emplacement créé dans un brouillon de
  // page (draft_state « added ») n'existe pas encore pour cet écran.
  const slots = db.select().from(schema.slots).orderBy(asc(schema.slots.position)).all().filter((s) => s.draftState !== "added");
  const media = new Map(db.select().from(schema.media).all().map((m) => [m.id, m]));
  const blocks = trashed ? [] : allBlocks();
  return db
    .select()
    .from(schema.projects)
    .where(trashed ? isNotNull(schema.projects.deletedAt) : isNull(schema.projects.deletedAt))
    .orderBy(trashed ? desc(schema.projects.deletedAt) : asc(schema.projects.position))
    .all()
    // Projet créé dans un brouillon de page : pas encore un projet du site.
    .filter((p) => p.draftPageId === null)
    .map((p) => {
      const mine = slots.filter((s) => s.projectId === p.id);
      const first = mine.map((s) => (s.mediaId ? media.get(s.mediaId) : undefined)).find((m) => m && m.status === "ready");
      return {
        id: p.id,
        slug: p.slug,
        title: p.title.fr,
        context: p.context.fr,
        year: p.year,
        featured: p.featured,
        slots: mine.length,
        empty: mine.filter((s) => s.mediaId === null).length,
        collections: [...new Set(mine.map((s) => s.collection))],
        thumb: first ? thumbUrl(first) : null,
        blockedBy: trashed ? [] : blockUses(projectReferences(p.slug, blocks)),
        deletedAt: p.deletedAt ? p.deletedAt.getTime() : null,
      };
    });
}

/** Projets du site (hors corbeille). */
export const listProjectsForAdmin = (): AdminProjectRow[] => projectRows(false);
/** Projets à la corbeille, le plus récent d'abord. */
export const listTrashedProjects = (): AdminProjectRow[] => projectRows(true);

/** Ce que « Vider la corbeille » supprimerait : de quoi nommer ce qui sera perdu. */
export type TrashSummary = { pages: number; projects: number; media: number; slots: number; total: number };

export function getTrashSummary(): TrashSummary {
  const db = getDb();
  const pages = db.select({ n: count() }).from(schema.pages).where(isNotNull(schema.pages.deletedAt)).get()?.n ?? 0;
  const media = db.select({ n: count() }).from(schema.media).where(isNotNull(schema.media.deletedAt)).get()?.n ?? 0;
  const trashedProjects = db.select({ id: schema.projects.id }).from(schema.projects).where(isNotNull(schema.projects.deletedAt)).all().map((p) => p.id);
  const slots = db.select({ p: schema.slots.projectId }).from(schema.slots).all().filter((s) => trashedProjects.includes(s.p)).length;
  return { pages, projects: trashedProjects.length, media, slots, total: pages + media + trashedProjects.length };
}

/**
 * Pages où un ancien bloc « Projets mis en avant » (sans projets choisis) lit encore le réglage « Mis en avant »
 * des projets. Vide : le réglage ne sert plus à rien et l'interrupteur disparaît de l'éditeur de projet.
 */
export function legacyFeaturedPages(): { pageId: number; pageTitle: string }[] {
  const titles = new Map(getDb().select({ id: schema.pages.id, title: schema.pages.title, deletedAt: schema.pages.deletedAt }).from(schema.pages).all().map((p) => [p.id, p]));
  const seen = new Set<number>();
  for (const b of allBlocks()) {
    const chosen = (b.props as { projects?: unknown } | undefined)?.projects;
    if (b.type === "featured-projects" && !(Array.isArray(chosen) && chosen.length)) seen.add(b.pageId);
  }
  return [...seen].flatMap((id) => (titles.get(id) && !titles.get(id)!.deletedAt ? [{ pageId: id, pageTitle: titles.get(id)!.title.fr || `page ${id}` }] : []));
}

export type AdminMediaRow = {
  id: number;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  status: "processing" | "ready" | "failed";
  error: string | null;
  alt: L;
  createdAt: number;
  /** Date du dernier envoi (ms) : renvoi d'un contenu déjà présent compris (lot 112) ; sinon la date d'ajout. */
  importedAt: number;
  /** Date de création du fichier (EXIF, PNG, vidéo ; ms UTC), ou null si inconnue ou pas encore lue (`takenChecked`). */
  takenAt: number | null;
  takenChecked: boolean;
  /** Vignette (variante la plus petite, ou le fichier du seed). */
  thumb: string | null;
  /** Aperçu large (plus grande variante). */
  preview: string | null;
  color: string | null;
  uses: number;
  kind: "image" | "video" | "pdf";
  /** Vidéo : durée (s), son, avancement de la conversion (0–100), fichier lisible. */
  duration: number | null;
  hasAudio: boolean | null;
  progress: number | null;
  videoSrc: string | null;
  /** Tags de la bibliothèque. */
  tags: MediaTag[];
  /** Mise à la corbeille (ms), ou null. */
  deletedAt: number | null;
  /** Lot 132 : animation image par image (bande WebP) : nombre d'images et taille d'une image. Absent pour tout autre média. */
  anim?: { frames: number; fw: number; fh: number };
};

/** Vignette d'un média : plus petite variante WebP, sinon le fichier lui-même (seed). */
function thumbUrl(m: { key: string; status: string; variants: unknown }): string | null {
  if (m.status !== "ready") return null;
  const variants = parseVariants(m.variants);
  if (!variants) return m.key.startsWith(ORIGINALS_PREFIX) ? null : mediaUrl(m.key);
  // PDF : la première page seulement.
  const webp = variants.files.filter((f) => f.format === "webp" && (f.page ?? 1) === 1).sort((a, b) => a.w - b.w);
  return webp[0] ? mediaUrl(webp[0].key) : null;
}

function toRow(m: typeof schema.media.$inferSelect, uses: number, progress: number | null = null, tags: MediaTag[] = []): AdminMediaRow {
  const variants = parseVariants(m.variants);
  const mp4 = variants?.files.filter((f) => f.format === "mp4").sort((a, b) => a.h - b.h)[0];
  const largest = variants?.files.filter((f) => f.format === "webp" && (f.page ?? 1) === 1).sort((a, b) => b.w - a.w)[0];
  return {
    id: m.id,
    name: m.originalName ?? m.key,
    mime: m.mime,
    size: m.size,
    width: m.width,
    height: m.height,
    status: m.status,
    error: m.error,
    alt: asL(m.alt),
    createdAt: m.createdAt.getTime(),
    importedAt: m.lastImportAt ?? m.createdAt.getTime(),
    takenAt: m.takenAt,
    takenChecked: m.takenChecked === 1,
    thumb: thumbUrl(m),
    preview: largest ? mediaUrl(largest.key) : thumbUrl(m),
    color: m.dominantColor,
    uses,
    kind: m.kind,
    duration: m.duration,
    hasAudio: m.hasAudio,
    progress: m.status === "processing" ? progress : null,
    videoSrc: mp4 ? mediaUrl(mp4.key) : null,
    tags,
    deletedAt: m.deletedAt ? m.deletedAt.getTime() : null,
    ...(m.kind === "image" && animOf(m.variants) ? { anim: animOf(m.variants)! } : {}),
  };
}

/** Avancement des jobs en cours, par média. */
function jobProgress(): Map<number, number> {
  return new Map(
    getDb()
      .select({ mediaId: schema.jobs.mediaId, progress: schema.jobs.progress, status: schema.jobs.status })
      .from(schema.jobs)
      .all()
      .filter((j) => j.mediaId !== null && (j.status === "queued" || j.status === "running"))
      .map((j) => [j.mediaId as number, j.progress]),
  );
}

function mediaRows(trashed: boolean): AdminMediaRow[] {
  const db = getDb();
  const progress = jobProgress();
  const tags = tagsByMedia();
  // Une seule règle d'usage pour le compteur ET le détail (lot 23).
  const usage = trashed ? new Map<number, Usage[]>() : mediaUsagesByMedia();
  return db
    .select()
    .from(schema.media)
    // Le fichier d'un papier peint (lot 35) n'est pas une photo : il vit dans Thèmes → Papiers peints, pas dans la médiathèque.
    .where(and(trashed ? isNotNull(schema.media.deletedAt) : isNull(schema.media.deletedAt), sql`${schema.media.id} not in (select media_id from wallpapers)`))
        // Lot 112 : « Ajouté récemment » = dernier envoi (un contenu renvoyé remonte), puis l'identifiant.
    .orderBy(...(trashed ? [desc(schema.media.deletedAt)] : [sql`coalesce(${schema.media.lastImportAt}, ${schema.media.createdAt} * 1000) desc`, desc(schema.media.id)]))
    .all()
    .map((m) => toRow(m, usage.get(m.id)?.length ?? 0, progress.get(m.id) ?? null, tags.get(m.id) ?? []));
}

/** Médias de la médiathèque (hors corbeille). */
export const listMediaForAdmin = (): AdminMediaRow[] => mediaRows(false);
/** Médias à la corbeille, le plus récent d'abord. */
export const listTrashedMedia = (): AdminMediaRow[] => mediaRows(true);

export type MediaUseRow =
  | { kind: "slot"; projectId: number; projectTitle: string; slotId: number; slotTitle: string; trashed: boolean; draftPage?: string }
  | { kind: "block"; pageId: number; pageTitle: string; blockType: string; trashed: boolean; /** Logo du site (réglé depuis cette page), pas une rubrique. */ logo?: true };

/** « Utilisé dans… » d'un média, avec les libellés à afficher (même calcul que le compteur). */
export function getMediaUses(id: number): MediaUseRow[] {
  const db = getDb();
  const projects = new Map(db.select().from(schema.projects).all().map((p) => [p.id, p]));
  const pages = new Map(db.select().from(schema.pages).all().map((p) => [p.id, p]));
  const slots = new Map(db.select().from(schema.slots).all().map((s) => [s.id, s.title.fr]));
  return findMediaUsages(id).map((u) =>
    u.kind === "layout"
      ? {
          // Contenu de la planche (lot 31) : montré comme un emplacement de la planche du projet.
          kind: "slot" as const,
          projectId: u.projectId,
          projectTitle: projects.get(u.projectId)?.title.fr ?? "",
          slotId: 0,
          slotTitle: "Grille, image ou vidéo du projet",
          trashed: Boolean(projects.get(u.projectId)?.deletedAt),
          ...(u.draftPageId ? { draftPage: pages.get(u.draftPageId)?.title.fr || `page ${u.draftPageId}` } : {}),
        }
      : u.kind === "slot"
      ? {
          kind: "slot",
          projectId: u.projectId,
          projectTitle: projects.get(u.projectId)?.title.fr ?? "",
          slotId: u.slotId,
          slotTitle: slots.get(u.slotId) || "Sans titre",
          trashed: Boolean(projects.get(u.projectId)?.deletedAt),
          ...(u.draftPageId ? { draftPage: pages.get(u.draftPageId)?.title.fr || `page ${u.draftPageId}` } : {}),
        }
      : { kind: "block", pageId: u.pageId, pageTitle: pages.get(u.pageId)?.title.fr ?? "", blockType: own(BLOCKS, u.type)?.label ?? u.type, trashed: Boolean(pages.get(u.pageId)?.deletedAt), ...(u.type === LOGO_USAGE_TYPE ? { logo: true as const } : {}) },
  );
}

export type AdminSlot = {
  id: number;
  position: number;
  title: L;
  description: L;
  collection: "characters" | "backgrounds" | "animation";
  year: number;
  featured: boolean;
  /** Ratio de la place (dernière image), null = créé vide. */
  aspect: number | null;
  media: AdminMediaRow | null;
};

export type AdminProjectEdit = {
  id: number;
  slug: string;
  title: L;
  context: L;
  description: L;
  year: string;
  featured: boolean;
  slots: AdminSlot[];
  /** Emplacements avec une modification en brouillon (éditeur visuel), pas encore publiée. */
  pendingDrafts: number;
  /** Titre de la page dont le brouillon modifie les TEXTES du projet (v0.15), ou null. */
  textHeldBy: string | null;
};

export function getProjectForEdit(id: number): AdminProjectEdit | null {
  const db = getDb();
  const p = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!p || p.draftPageId !== null || p.deletedAt) return null;
  const media = new Map(db.select().from(schema.media).all().map((m) => [m.id, m]));
  const all = db.select().from(schema.slots).where(eq(schema.slots.projectId, id)).orderBy(asc(schema.slots.position)).all();
  // Version publiée de la planche ; les modifications en brouillon d'une page
  // (éditeur visuel) sont comptées pour être signalées.
  const slots = all.filter((s) => s.draftState !== "added");
  const pendingDrafts = all.filter((s) => s.draftState !== null || s.draftPosition !== null || s.draftMediaId !== null).length;
  const progressMap = jobProgress();
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    context: asL(p.context),
    description: asL(p.description),
    year: p.year,
    featured: p.featured,
    pendingDrafts,
    textHeldBy: p.draftTextPageId === null ? null : (db.select({ title: schema.pages.title }).from(schema.pages).where(eq(schema.pages.id, p.draftTextPageId)).get()?.title.fr || `n° ${p.draftTextPageId}`),
    slots: slots.map((s) => {
      const m = s.mediaId ? media.get(s.mediaId) : undefined;
      return {
        id: s.id,
        position: s.position,
        title: asL(s.title),
        description: asL(s.description),
        collection: s.collection,
        year: s.year,
        featured: s.featured,
        aspect: s.aspect,
        media: m ? toRow(m, 0, progressMap.get(m.id) ?? null) : null,
      };
    }),
  };
}

export type AdminSettings = {
  site: { name: L; role: L; email: string; credit: L; headerSocials?: boolean };
  socials: { label: string; href: string; kind?: Network }[];
};

const EMPTY: L = { fr: "", en: "" };
const asL = (v: unknown): L => {
  const o = v as Partial<L> | undefined;
  return { fr: typeof o?.fr === "string" ? o.fr : "", en: typeof o?.en === "string" ? o.en : "" };
};

/** Partage et référencement tels que l'écran des réglages les montre (lot 52). */
export function getSeoForAdmin(): SeoInput {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, "seo")).get();
  const seo = readSeo(row ? parseJson(row.value) : undefined);
  return { description: seo.description, shareImage: seo.shareImage };
}

/** Icône de l'onglet telle que les deux écrans (Réglages, étape « Logo » du thème) la montrent : un seul réglage de site (lot 83). */
export function getFaviconForAdmin(): FaviconInput {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, "seo")).get();
  const seo = readSeo(row ? parseJson(row.value) : undefined);
  return { mode: seo.faviconMode.mode, mediaId: seo.favicon?.mediaId ?? null, mono: seo.faviconMode.mono, crop: seo.faviconMode.crop };
}

/**
 * `withDraft` (écran Réglages, lot 96) : les champs qu'il enregistre (nom, métier, e-mail, mention, réseaux) montrent les valeurs EN ATTENTE du
 * brouillon du site quand il y en a, pas seulement les publiées : enregistrer ici ne peut ainsi jamais ré-écraser, à l'insu de l'artiste, un
 * nom modifié dans l'éditeur.
 */
export function getSettingsForAdmin(withDraft = false): AdminSettings {
  const pending = withDraft ? readSiteDraft() : null;
  if (pending) {
    const i = pending.snap.identity;
    return {
      site: { name: i.name, role: i.role, email: i.email, credit: i.credit, headerSocials: i.headerSocials === true },
      socials: pending.snap.socials.map((s) => ({ label: s.label, href: s.href, ...((NETWORKS as readonly unknown[]).includes(s.kind) ? { kind: s.kind as Network } : {}) })),
    };
  }
  const rows = getDb().select().from(schema.settings).all();
  const values = Object.fromEntries(rows.map((r) => [r.key, parseJson(r.value)]));
  const site = (values.site ?? {}) as Record<string, unknown>;
  const socials = Array.isArray(values.socials)
    ? (values.socials as { label?: unknown; href?: unknown; kind?: unknown }[]).map((x) => ({
        label: String(x.label ?? ""),
        href: String(x.href ?? ""),
        // Le réseau reconnu est gardé : enregistrer les réglages ne le perd plus.
        ...((NETWORKS as readonly unknown[]).includes(x.kind) ? { kind: x.kind as Network } : {}),
      }))
    : [];
  return {
    site: {
      name: asSiteName(site.name),
      role: site.role ? asL(site.role) : EMPTY,
      email: typeof site.email === "string" ? site.email : "",
      credit: site.credit ? asL(site.credit) : EMPTY,
      headerSocials: site.headerSocials === true,
    },
    socials,
  };
}

/**
 * Brouillon COMMUN du site (nom, métier, réseaux, en-tête, pied, menu, styles… édités sur la toile) en attente (lot 96) :
 * publié avec n'importe quelle page. Les Réglages publient en direct et reportent leurs valeurs dans ce brouillon ; ils
 * l'affichent pour qu'on sache que l'éditeur a d'autres modifications (menu, styles…). `pageId` : une page où l'ouvrir
 * (la dernière qui l'a modifié si elle existe encore, sinon l'accueil), ou null s'il n'y a pas de page.
 */
export function siteDraftHolder(): { pageId: number; pageTitle: string } | null {
  const db = getDb();
  const raw = parseJson(db.select().from(schema.settings).where(eq(schema.settings.key, "siteDraft")).get()?.value) as { pageId?: unknown; snap?: unknown } | undefined;
  if (!raw || typeof raw !== "object" || !SiteSnapSchema.safeParse(raw.snap).success) return null;
  const alive = (id: number) => db.select({ id: schema.pages.id, title: schema.pages.title, deletedAt: schema.pages.deletedAt }).from(schema.pages).where(eq(schema.pages.id, id)).get();
  let page = Number.isInteger(raw.pageId) ? alive(raw.pageId as number) : undefined;
  if (!page || page.deletedAt) page = db.select({ id: schema.pages.id, title: schema.pages.title, deletedAt: schema.pages.deletedAt }).from(schema.pages).where(isNull(schema.pages.deletedAt)).orderBy(schema.pages.id).get();
  return page ? { pageId: page.id, pageTitle: page.title.fr || `n° ${page.id}` } : null;
}

/* ---- Éditeur de page ---------------------------------------------------- */

export type AdminPageEdit = {
  id: number;
  isHome: boolean;
  title: L;
  slug: L;
  meta: { title: L; description: L; image?: number | null };
  published: boolean;
  inMenu: boolean;
  accent: string | null;
  /** Papier peint de la page (lot 35) : absent = celui du site. */
  wallpaper: PagePaper | null;
  /** Collection que la page présente (lot 22), ou null. */
  collection: "characters" | "backgrounds" | "animation" | null;
  blocks: { type: string; props: Record<string, unknown> }[];
};

export function getPageForEdit(id: number): AdminPageEdit | null {
  const db = getDb();
  const page = db.select().from(schema.pages).where(eq(schema.pages.id, id)).get();
  // Une page à la corbeille ne s'édite pas : on la restaure d'abord.
  if (!page || page.deletedAt) return null;
  const blocks = db
    .select()
    .from(schema.blocks)
    .where(eq(schema.blocks.pageId, id))
    .orderBy(asc(schema.blocks.position))
    .all()
    .map((b) => ({ type: b.type, props: (parseJson(b.props) as Record<string, unknown>) ?? {} }));
  const overrides = page.themeOverrides as { primary?: unknown; wallpaper?: unknown } | null;
  return {
    id: page.id,
    isHome: page.slug.fr === "" && page.slug.en === "",
    title: page.title,
    slug: page.slug,
    meta: { title: asL(page.meta?.title), description: asL(page.meta?.description), image: Number.isInteger(page.meta?.image) ? (page.meta?.image as number) : null },
    published: page.published,
    inMenu: page.navOrder !== null,
    accent: typeof overrides?.primary === "string" ? overrides.primary : null,
    wallpaper: readPagePaper(overrides?.wallpaper) ?? null,
    collection: page.collection ?? null,
    blocks,
  };
}

/** Choix proposés par les sélecteurs des éditeurs de blocs. */
/** `draftPageId` : page éditée (ses projets en brouillon sont proposés). */
export function getEditorContext(draftPageId?: number) {
  const db = getDb();
  // Projets déjà montrés par une planche d'une page (publiée ou brouillon) :
  // les autres sont mis en évidence dans les sélecteurs (« pas encore sur une page »).
  const onPage = new Set<string>();
  const draftRows = db.select({ id: schema.pages.id, draft: schema.pages.draft }).from(schema.pages).where(isNull(schema.pages.deletedAt)).all();
  const published = db.select({ pageId: schema.blocks.pageId, type: schema.blocks.type, props: schema.blocks.props }).from(schema.blocks).all();
  for (const b of boardRefs(published.map((r) => ({ type: r.type, props: parseJson(r.props) })))) onPage.add(b.slug);
  for (const p of draftRows) {
    const blocks = (p.draft as { blocks?: unknown } | null)?.blocks;
    if (Array.isArray(blocks)) for (const b of boardRefs(blocks.filter((x) => x && typeof x.type === "string"))) onPage.add(b.slug);
  }
  // Pages de collection publiées, dans l'ordre du menu : entrées automatiques des collections (lot 22).
  const navRow = db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "nav")).get();
  const navList = NavSchema.safeParse(parseJson(navRow?.value));
  // Une page à la corbeille n'est ni publique ni une entrée de collection : elle n'est pas proposée aux tuiles.
  const livePages = db.select().from(schema.pages).where(and(eq(schema.pages.published, true), isNull(schema.pages.deletedAt))).orderBy(asc(schema.pages.id)).all();
  const menu = navList.success
    ? navList.data.flatMap((n) => (n.kind === "page" ? [n.pageId] : []))
    : livePages.filter((p) => p.navOrder !== null).sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0)).map((p) => p.id);
  const blockRows = db.select({ pageId: schema.blocks.pageId, type: schema.blocks.type, props: schema.blocks.props }).from(schema.blocks).orderBy(asc(schema.blocks.position)).all();
  const collectionPages = orderCollectionPages(
    livePages.map((p) => ({ id: p.id, title: p.title, collection: p.collection, blocks: blockRows.filter((b) => b.pageId === p.id).map((b) => ({ type: b.type, props: parseJson(b.props) })) })),
    menu,
  );
  const entryPages = orderEntryPages(
    livePages.map((p) => ({ id: p.id, slug: p.slug, title: p.title, collection: p.collection, blocks: blockRows.filter((b) => b.pageId === p.id).map((b) => ({ type: b.type, props: parseJson(b.props) })) })),
    menu,
  );
  // Page « Page introuvable » (lot 89) : les œuvres publiées, pour la sélection manuelle du bloc « Une œuvre au hasard ».
  const editedPage = draftPageId === undefined ? undefined : db.select({ slug: schema.pages.slug }).from(schema.pages).where(eq(schema.pages.id, draftPageId)).get();
  const works = editedPage && isSpecialSlug(editedPage.slug.fr) ? listWorksForAdmin() : undefined;
  return {
    collectionPages,
    entryPages,
    ...(works ? { works } : {}),
    pages: db
      .select()
      .from(schema.pages)
      .where(isNull(schema.pages.deletedAt))
      .orderBy(asc(schema.pages.id))
      .all()
      .filter((p) => !p.slug.fr.startsWith("_"))
      .map((p) => ({ id: p.id, title: p.title.fr, slug: p.slug.fr, collection: p.collection ?? null })),
    // Projets publiés, plus ceux créés dans le brouillon de la page éditée.
    projects: db
      .select({ id: schema.projects.id, slug: schema.projects.slug, title: schema.projects.title, page: schema.projects.draftPageId })
      .from(schema.projects)
      .where(isNull(schema.projects.deletedAt))
      .orderBy(asc(schema.projects.position))
      .all()
      .filter((p) => p.page === null || (draftPageId !== undefined && p.page === draftPageId))
      .map((p) => ({ id: p.id, slug: p.slug, title: p.title.fr, ...(p.page !== null ? { draft: true } : {}), onPage: onPage.has(p.slug) })),
    media: listMediaForAdmin().filter((m) => m.status !== "failed"),
    wallpapers: listWallpaperChoices(),
    heroBackdrop: activeHeroVariant() !== "type-only",
  };
}

/** Œuvres publiées (emplacement d'un projet publié, avec une image) : sélection du bloc « Une œuvre au hasard ». */
function listWorksForAdmin(): { slug: string; title: string; project: string; collection: string }[] {
  const db = getDb();
  const projects = new Map(db.select({ id: schema.projects.id, title: schema.projects.title, draft: schema.projects.draftPageId, deletedAt: schema.projects.deletedAt }).from(schema.projects).all().map((p) => [p.id, p]));
  return db
    .select({ slot: schema.slots, media: schema.media.status })
    .from(schema.slots)
    .innerJoin(schema.media, eq(schema.slots.mediaId, schema.media.id))
    .where(and(eq(schema.media.status, "ready"), isNull(schema.media.deletedAt)))
    .orderBy(asc(schema.slots.id))
    .all()
    .flatMap(({ slot }) => {
      const project = projects.get(slot.projectId);
      if (!project || project.draft !== null || project.deletedAt || slot.draftState === "added") return [];
      return [{ slug: slot.slug, title: slot.title.fr || slot.slug, project: project.title.fr, collection: slot.collection }];
    });
}

/** Forme d'ouverture du thème en ligne. */
function activeHeroVariant(): Theme["variants"]["hero"] | null {
  return getLiveTheme()?.variants.hero ?? null;
}

/** Pages qui ont un accent propre (contrôle avant de mettre un thème en ligne). */
export function listPageAccents(): { id: number; title: string; accent: string }[] {
  return getDb()
    .select({ id: schema.pages.id, title: schema.pages.title, overrides: schema.pages.themeOverrides })
    .from(schema.pages)
    .where(isNull(schema.pages.deletedAt))
    .all()
    .flatMap((p) => {
      const accent = (p.overrides as { primary?: unknown } | null)?.primary;
      return typeof accent === "string" ? [{ id: p.id, title: p.title.fr, accent }] : [];
    });
}

/** Couleurs du thème en ligne (contrôle de l'accent d'une page). */
export function getActiveThemeColors(): Theme["tokens"]["color"] | null {
  return getLiveTheme()?.tokens.color ?? null;
}

/** Identifiant de la page d'accueil (adresses vides), ou null. */
export function getHomePageId(): number | null {
  return getDb().select({ id: schema.pages.id, slug: schema.pages.slug }).from(schema.pages).all().find((p) => p.slug.fr === "" && p.slug.en === "")?.id ?? null;
}

/** Projets dont le brouillon de la page a modifié les images (surcouche en attente), par slug. */
export function overlayProjectSlugs(pageId: number): string[] {
  const db = getDb();
  const ids = new Set(db.select({ p: schema.slots.projectId }).from(schema.slots).where(eq(schema.slots.draftPageId, pageId)).all().map((r) => r.p));
  return db.select({ id: schema.projects.id, slug: schema.projects.slug }).from(schema.projects).all().filter((p) => ids.has(p.id)).map((p) => p.slug);
}

/* ---- Messages du formulaire de contact (v0.13) --------------------------- */

export type AdminMessage = { id: number; subject: string; replyTo: string | null; fields: { label: string; value: string }[]; createdAt: Date; page: string | null };

/** Derniers messages reçus (lecture directe). */
export function listMessages(limit = 200): AdminMessage[] {
  const db = getDb();
  const titles = new Map(db.select({ id: schema.pages.id, title: schema.pages.title }).from(schema.pages).all().map((p) => [p.id, p.title.fr]));
  return db
    .select()
    .from(schema.messages)
    .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
    .limit(limit)
    .all()
    .map((m) => {
      const parsed = parseJson(m.fields);
      const fields = Array.isArray(parsed) ? parsed.filter((f) => f && typeof f.label === "string" && typeof f.value === "string") : [];
      return { id: m.id, subject: m.subject, replyTo: m.replyTo, fields, createdAt: m.createdAt, page: m.pageId ? (titles.get(m.pageId) ?? null) : null };
    });
}

/**
 * Aucun envoi d'e-mail n'existe encore : les messages ne sont lus qu'ici (lot 52, la page Messages le dit en clair).
 * Passera à vrai le jour où un serveur d'envoi sera branché.
 */
export const messagesEmailConfigured = (): boolean => false;

/** Numéro du dernier message déjà vu (réglage `messagesSeen`), 0 si jamais. */
export function lastSeenMessageId(): number {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, "messagesSeen")).get();
  const v = row ? parseJson(row.value) : undefined;
  return Number.isInteger(v) && (v as number) > 0 ? (v as number) : 0;
}

/** Messages arrivés depuis la dernière visite de la page Messages (pastille du menu, carte du tableau de bord). */
export function countUnreadMessages(): number {
  return getDb().select({ n: count() }).from(schema.messages).where(sql`${schema.messages.id} > ${lastSeenMessageId()}`).get()?.n ?? 0;
}

export { MESSAGES_CAP } from "./contact-form";
export function countMessages(): number {
  return getDb().select({ n: count() }).from(schema.messages).get()?.n ?? 0;
}

/* ---- Papiers peints (lot 35) ---------------------------------------------------------------------------------- */

export type WallpaperUseRow = { kind: "block"; pageId: number; pageTitle: string; blockType: string; trashed: boolean } | { kind: "page"; pageId: number; pageTitle: string; trashed: boolean } | { kind: "cards" };

/** « Utilisé dans… » d'un motif, avec les libellés à afficher (avertissement avant de le supprimer). */
export function getWallpaperUses(id: number): WallpaperUseRow[] {
  const pages = new Map(getDb().select().from(schema.pages).all().map((p) => [p.id, p]));
  return findWallpaperUsages(id).map((u) => {
    if (u.kind === "cards") return { kind: "cards" as const };
    const page = pages.get(u.pageId);
    const base = { pageId: u.pageId, pageTitle: page?.title.fr || `page ${u.pageId}`, trashed: Boolean(page?.deletedAt) };
    return u.kind === "page" ? { kind: "page" as const, ...base } : { kind: "block" as const, ...base, blockType: own(BLOCKS, u.type)?.label ?? u.type };
  });
}

/** Papier peint par défaut des cartes du site (réglage `cardWallpaper`), ou null. */
export function getCardWallpaperSetting(): CardWallpaper | null {
  return readCardWallpaper(parseJson(getDb().select().from(schema.settings).where(eq(schema.settings.key, "cardWallpaper")).get()?.value)) ?? null;
}

/** Nombre d'endroits qui utilisent chaque motif (pastille « utilisé à N endroits »). */
export function wallpaperUseCounts(): Record<number, number> {
  return Object.fromEntries([...wallpaperUsages()].map(([id, uses]) => [id, uses.length]));
}
