/**
 * Lectures de l'admin : directes (sans cache Next), l'admin étant toujours
 * rendue à la demande. Aucun composant n'importe Drizzle : tout passe ici.
 */
import { asc, count, desc, eq } from "drizzle-orm";

import { extractRefs } from "@/blocks/refs";
import { BLOCKS } from "@/blocks/registry";

import { ThemeSchema, type Theme } from "@/themes/schema";

import { getDb, schema } from "./db";
import { boardRefs } from "@/blocks/tree";
import { parseJson } from "./json";
import { asSiteName, NETWORKS, type Network } from "./site-schema";
import { ORIGINALS_PREFIX, parseVariants } from "./images/variants";
import { mediaUrl } from "./media";
import { own } from "./own";
import { findMediaUsages } from "./references";
import { tagsByMedia, type MediaTag } from "./tags";

type L = { fr: string; en: string };

export type AdminCounts = { pages: number; projects: number; media: number };

export function getAdminCounts(): AdminCounts {
  const db = getDb();
  const n = (table: typeof schema.pages | typeof schema.projects | typeof schema.media) =>
    db.select({ n: count() }).from(table).get()?.n ?? 0;
  return { pages: n(schema.pages), projects: n(schema.projects), media: n(schema.media) };
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

export type AdminPageRow = {
  id: number;
  title: string;
  slug: L;
  navOrder: number | null;
  published: boolean;
  blocks: number;
  /** Brouillon de l'éditeur visuel en attente de publication. */
  hasDraft: boolean;
};

export function listPagesForAdmin(): AdminPageRow[] {
  const db = getDb();
  const blocks = db
    .select({ pageId: schema.blocks.pageId, n: count() })
    .from(schema.blocks)
    .groupBy(schema.blocks.pageId)
    .all();
  const byPage = new Map(blocks.map((b) => [b.pageId, b.n]));
  return db
    .select()
    .from(schema.pages)
    .orderBy(asc(schema.pages.id))
    .all()
    .map((p) => ({
      id: p.id,
      title: p.title.fr,
      slug: p.slug,
      navOrder: p.navOrder,
      published: p.published,
      blocks: byPage.get(p.id) ?? 0,
      hasDraft: p.draft !== null,
    }));
}

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
};

export function listProjectsForAdmin(): AdminProjectRow[] {
  const db = getDb();
  // Emplacements publiés seulement : un emplacement créé dans un brouillon de
  // page (draft_state « added ») n'existe pas encore pour cet écran.
  const slots = db.select().from(schema.slots).orderBy(asc(schema.slots.position)).all().filter((s) => s.draftState !== "added");
  const media = new Map(db.select().from(schema.media).all().map((m) => [m.id, m]));
  return db
    .select()
    .from(schema.projects)
    .orderBy(asc(schema.projects.position))
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
      };
    });
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

export function listMediaForAdmin(): AdminMediaRow[] {
  const db = getDb();
  const slotUses = new Map<number, number>();
  for (const s of db.select({ mediaId: schema.slots.mediaId }).from(schema.slots).all()) {
    if (s.mediaId) slotUses.set(s.mediaId, (slotUses.get(s.mediaId) ?? 0) + 1);
  }
  const progress = jobProgress();
  const tags = tagsByMedia();
  const blockUses = new Map<number, number>();
  for (const b of db.select().from(schema.blocks).all()) {
    for (const id of extractRefs(b.type, parseJson(b.props)).media) blockUses.set(id, (blockUses.get(id) ?? 0) + 1);
  }
  return db
    .select()
    .from(schema.media)
    .orderBy(desc(schema.media.id))
    .all()
    .map((m) => toRow(m, (slotUses.get(m.id) ?? 0) + (blockUses.get(m.id) ?? 0), progress.get(m.id) ?? null, tags.get(m.id) ?? []));
}

export type MediaUseRow =
  | { kind: "slot"; projectId: number; projectTitle: string; slotId: number; slotTitle: string }
  | { kind: "block"; pageId: number; pageTitle: string; blockType: string };

/** « Utilisé dans… » d'un média, avec les libellés à afficher. */
export function getMediaUses(id: number): MediaUseRow[] {
  const db = getDb();
  const projects = new Map(db.select().from(schema.projects).all().map((p) => [p.id, p.title.fr]));
  const pages = new Map(db.select().from(schema.pages).all().map((p) => [p.id, p.title.fr]));
  const slots = new Map(db.select().from(schema.slots).all().map((s) => [s.id, s.title.fr]));
  return findMediaUsages(id).map((u) =>
    u.kind === "slot"
      ? { kind: "slot", projectId: u.projectId, projectTitle: projects.get(u.projectId) ?? "", slotId: u.slotId, slotTitle: slots.get(u.slotId) || "Sans titre" }
      : { kind: "block", pageId: u.pageId, pageTitle: pages.get(u.pageId) ?? "", blockType: own(BLOCKS, u.type)?.label ?? u.type },
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
  if (!p || p.draftPageId !== null) return null;
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
  if (!page) return null;
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
  const pageRows = db.select({ id: schema.pages.id, draft: schema.pages.draft }).from(schema.pages).all();
  const published = db.select({ pageId: schema.blocks.pageId, type: schema.blocks.type, props: schema.blocks.props }).from(schema.blocks).all();
  for (const b of boardRefs(published.map((r) => ({ type: r.type, props: parseJson(r.props) })))) onPage.add(b.slug);
  for (const p of pageRows) {
    const blocks = (p.draft as { blocks?: unknown } | null)?.blocks;
    if (Array.isArray(blocks)) for (const b of boardRefs(blocks.filter((x) => x && typeof x.type === "string"))) onPage.add(b.slug);
  }
  return {
    pages: db
      .select()
      .from(schema.pages)
      .orderBy(asc(schema.pages.id))
      .all()
      .filter((p) => !p.slug.fr.startsWith("_"))
      .map((p) => ({ id: p.id, title: p.title.fr, slug: p.slug.fr })),
    // Projets publiés, plus ceux créés dans le brouillon de la page éditée.
    projects: db
      .select({ slug: schema.projects.slug, title: schema.projects.title, page: schema.projects.draftPageId })
      .from(schema.projects)
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
