/**
 * Lectures de l'admin : directes (sans cache Next), l'admin étant toujours
 * rendue à la demande. Aucun composant n'importe Drizzle : tout passe ici.
 */
import { asc, count, desc, eq, isNotNull, isNull } from "drizzle-orm";

import { pageReferences, projectReferences, type Usage } from "@/blocks/refs";
import { BLOCKS } from "@/blocks/registry";

import { ThemeSchema, type Theme } from "@/themes/schema";

import { getDb, schema } from "./db";
import { boardRefs } from "@/blocks/tree";
import { parseJson } from "./json";
import { asSiteName, NETWORKS, type Network } from "./site-schema";
import { ORIGINALS_PREFIX, parseVariants } from "./images/variants";
import { mediaUrl } from "./media";
import { own } from "./own";
import { allBlocks, findMediaUsages, mediaUsagesByMedia } from "./references";
import { tagsByMedia, type MediaTag } from "./tags";

type L = { fr: string; en: string };

export type AdminCounts = { pages: number; projects: number; media: number };

export function getAdminCounts(): AdminCounts {
  const db = getDb();
  // Hors corbeille.
  const pages = db.select({ n: count() }).from(schema.pages).where(isNull(schema.pages.deletedAt)).get()?.n ?? 0;
  const projects = db.select({ n: count() }).from(schema.projects).where(isNull(schema.projects.deletedAt)).get()?.n ?? 0;
  const media = db.select({ n: count() }).from(schema.media).where(isNull(schema.media.deletedAt)).get()?.n ?? 0;
  return { pages, projects, media };
}

export type ThemeOverview = { activeId: string; themes: Theme[] };

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
  slug: L;
  navOrder: number | null;
  published: boolean;
  blocks: number;
  /** Brouillon de l'éditeur visuel en attente de publication. */
  hasDraft: boolean;
  /** Blocs d'AUTRES pages qui pointent vers celle-ci : tant qu'il y en a, elle ne se supprime pas. */
  blockedBy: BlockUse[];
  /** Mise à la corbeille (ms), ou null. */
  deletedAt: number | null;
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
  return db
    .select()
    .from(schema.pages)
    .where(trashed ? isNotNull(schema.pages.deletedAt) : isNull(schema.pages.deletedAt))
    .orderBy(trashed ? desc(schema.pages.deletedAt) : asc(schema.pages.id))
    .all()
    .map((p) => ({
      id: p.id,
      title: p.title.fr,
      slug: p.slug,
      navOrder: p.navOrder,
      published: p.published,
      blocks: byPage.get(p.id) ?? 0,
      hasDraft: p.draft !== null,
      blockedBy: trashed ? [] : blockUses(pageReferences(p.id, all), p.id),
      deletedAt: p.deletedAt ? p.deletedAt.getTime() : null,
    }));
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
    .where(trashed ? isNotNull(schema.media.deletedAt) : isNull(schema.media.deletedAt))
    .orderBy(trashed ? desc(schema.media.deletedAt) : desc(schema.media.id))
    .all()
    .map((m) => toRow(m, usage.get(m.id)?.length ?? 0, progress.get(m.id) ?? null, tags.get(m.id) ?? []));
}

/** Médias de la médiathèque (hors corbeille). */
export const listMediaForAdmin = (): AdminMediaRow[] => mediaRows(false);
/** Médias à la corbeille, le plus récent d'abord. */
export const listTrashedMedia = (): AdminMediaRow[] => mediaRows(true);

export type MediaUseRow =
  | { kind: "slot"; projectId: number; projectTitle: string; slotId: number; slotTitle: string; trashed: boolean; draftPage?: string }
  | { kind: "block"; pageId: number; pageTitle: string; blockType: string; trashed: boolean };

/** « Utilisé dans… » d'un média, avec les libellés à afficher (même calcul que le compteur). */
export function getMediaUses(id: number): MediaUseRow[] {
  const db = getDb();
  const projects = new Map(db.select().from(schema.projects).all().map((p) => [p.id, p]));
  const pages = new Map(db.select().from(schema.pages).all().map((p) => [p.id, p]));
  const slots = new Map(db.select().from(schema.slots).all().map((s) => [s.id, s.title.fr]));
  return findMediaUsages(id).map((u) =>
    u.kind === "slot"
      ? {
          kind: "slot",
          projectId: u.projectId,
          projectTitle: projects.get(u.projectId)?.title.fr ?? "",
          slotId: u.slotId,
          slotTitle: slots.get(u.slotId) || "Sans titre",
          trashed: Boolean(projects.get(u.projectId)?.deletedAt),
          ...(u.draftPageId ? { draftPage: pages.get(u.draftPageId)?.title.fr || `page ${u.draftPageId}` } : {}),
        }
      : { kind: "block", pageId: u.pageId, pageTitle: pages.get(u.pageId)?.title.fr ?? "", blockType: own(BLOCKS, u.type)?.label ?? u.type, trashed: Boolean(pages.get(u.pageId)?.deletedAt) },
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

export function getSettingsForAdmin(): AdminSettings {
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
 * Brouillon du site (nom, métier, réseaux, en-tête, pied… édités sur la toile) en attente dans l'éditeur d'une
 * page : publié avec elle, jamais en ligne avant. Les Réglages écrivent en direct, un AUTRE mécanisme : ils
 * affichent ce brouillon pour qu'on sache que l'éditeur a des modifications que l'écran ne montre pas.
 */
export function siteDraftHolder(): { pageId: number; pageTitle: string } | null {
  const db = getDb();
  const raw = parseJson(db.select().from(schema.settings).where(eq(schema.settings.key, "siteDraft")).get()?.value) as { pageId?: unknown } | undefined;
  if (!raw || !Number.isInteger(raw.pageId)) return null;
  const page = db.select({ title: schema.pages.title, deletedAt: schema.pages.deletedAt }).from(schema.pages).where(eq(schema.pages.id, raw.pageId as number)).get();
  return page && !page.deletedAt ? { pageId: raw.pageId as number, pageTitle: page.title.fr || `n° ${raw.pageId}` } : null;
}

/* ---- Éditeur de page ---------------------------------------------------- */

export type AdminPageEdit = {
  id: number;
  isHome: boolean;
  title: L;
  slug: L;
  meta: { title: L; description: L };
  published: boolean;
  inMenu: boolean;
  accent: string | null;
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
  const overrides = page.themeOverrides as { primary?: unknown } | null;
  return {
    id: page.id,
    isHome: page.slug.fr === "" && page.slug.en === "",
    title: page.title,
    slug: page.slug,
    meta: { title: asL(page.meta?.title), description: asL(page.meta?.description) },
    published: page.published,
    inMenu: page.navOrder !== null,
    accent: typeof overrides?.primary === "string" ? overrides.primary : null,
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
  return {
    pages: db
      .select()
      .from(schema.pages)
      .where(isNull(schema.pages.deletedAt))
      .orderBy(asc(schema.pages.id))
      .all()
      .filter((p) => !p.slug.fr.startsWith("_"))
      .map((p) => ({ id: p.id, title: p.title.fr, slug: p.slug.fr })),
    // Projets publiés, plus ceux créés dans le brouillon de la page éditée.
    projects: db
      .select({ slug: schema.projects.slug, title: schema.projects.title, page: schema.projects.draftPageId })
      .from(schema.projects)
      .where(isNull(schema.projects.deletedAt))
      .orderBy(asc(schema.projects.position))
      .all()
      .filter((p) => p.page === null || (draftPageId !== undefined && p.page === draftPageId))
      .map((p) => ({ slug: p.slug, title: p.title.fr, ...(p.page !== null ? { draft: true } : {}), onPage: onPage.has(p.slug) })),
    media: listMediaForAdmin().filter((m) => m.status !== "failed"),
    heroBackdrop: activeHeroVariant() !== "type-only",
  };
}

/** Forme d'ouverture du thème en ligne. */
function activeHeroVariant(): Theme["variants"]["hero"] | null {
  const { activeId, themes } = getThemeOverview();
  return themes.find((t) => t.id === activeId)?.variants.hero ?? null;
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
  const { activeId, themes } = getThemeOverview();
  return themes.find((t) => t.id === activeId)?.tokens.color ?? null;
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

export { MESSAGES_CAP } from "./contact-form";
export function countMessages(): number {
  return getDb().select({ n: count() }).from(schema.messages).get()?.n ?? 0;
}
