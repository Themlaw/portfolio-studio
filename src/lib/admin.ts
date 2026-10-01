/**
 * Lectures de l'admin : directes (sans cache Next), l'admin étant toujours
 * rendue à la demande. Aucun composant n'importe Drizzle : tout passe ici.
 */
import { asc, count, eq } from "drizzle-orm";

import { ThemeSchema, type Theme } from "@/themes/schema";

import { getDb, schema } from "./db";
import { parseJson } from "./json";
import { mediaUrl } from "./media";

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

export type AdminPageRow = { id: number; title: string; slug: L; navOrder: number | null; published: boolean; blocks: number };

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
    }));
}

export type AdminProjectRow = { id: number; title: string; year: string; slots: number; empty: number; collections: string[] };

export function listProjectsForAdmin(): AdminProjectRow[] {
  const db = getDb();
  const slots = db.select().from(schema.slots).all();
  return db
    .select()
    .from(schema.projects)
    .orderBy(asc(schema.projects.position))
    .all()
    .map((p) => {
      const own = slots.filter((s) => s.projectId === p.id);
      return {
        id: p.id,
        title: p.title.fr,
        year: p.year,
        slots: own.length,
        empty: own.filter((s) => s.mediaId === null).length,
        collections: [...new Set(own.map((s) => s.collection))],
      };
    });
}

export type AdminMediaRow = { id: number; url: string; name: string; mime: string; size: number; width: number | null; height: number | null };

export function listMediaForAdmin(): AdminMediaRow[] {
  return getDb()
    .select()
    .from(schema.media)
    .orderBy(asc(schema.media.id))
    .all()
    .map((m) => ({
      id: m.id,
      url: mediaUrl(m.key),
      name: m.originalName ?? m.key,
      mime: m.mime,
      size: m.size,
      width: m.width,
      height: m.height,
    }));
}

export type AdminSettings = {
  site: { name: string; role: L; email: string; credit: L };
  socials: { label: string; href: string }[];
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
    ? (values.socials as { label?: unknown; href?: unknown }[]).map((x) => ({ label: String(x.label ?? ""), href: String(x.href ?? "") }))
    : [];
  return {
    site: {
      name: typeof site.name === "string" ? site.name : "",
      role: site.role ? asL(site.role) : EMPTY,
      email: typeof site.email === "string" ? site.email : "",
      credit: site.credit ? asL(site.credit) : EMPTY,
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
export function getEditorContext() {
  const db = getDb();
  return {
    pages: db
      .select()
      .from(schema.pages)
      .orderBy(asc(schema.pages.id))
      .all()
      .filter((p) => !p.slug.fr.startsWith("_"))
      .map((p) => ({ id: p.id, title: p.title.fr, slug: p.slug.fr })),
    projects: db
      .select({ slug: schema.projects.slug, title: schema.projects.title })
      .from(schema.projects)
      .orderBy(asc(schema.projects.position))
      .all()
      .map((p) => ({ slug: p.slug, title: p.title.fr })),
    media: db
      .select()
      .from(schema.media)
      .orderBy(asc(schema.media.id))
      .all()
      .filter((m) => m.mime.startsWith("image/"))
      .map((m) => ({ id: m.id, url: mediaUrl(m.key), name: m.originalName ?? m.key })),
  };
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
