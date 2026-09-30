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

export type AdminSettings = { name: string; role: string; email: string; socials: { label: string; href: string }[] };

export function getSettingsForAdmin(): AdminSettings {
  const rows = getDb().select().from(schema.settings).all();
  const values = Object.fromEntries(rows.map((r) => [r.key, parseJson(r.value)]));
  const site = (values.site ?? {}) as { name?: string; role?: L; email?: string };
  const socials = Array.isArray(values.socials) ? (values.socials as { label: string; href: string }[]) : [];
  return { name: site.name ?? "", role: site.role?.fr ?? "", email: site.email ?? "", socials };
}
