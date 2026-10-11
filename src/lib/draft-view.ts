/**
 * Vue brouillon (éditeur visuel) : le site rendu avec les brouillons des pages
 * et la surcouche de brouillon des emplacements. Active seulement si les trois
 * conditions sont réunies : draft mode de Next, cookie `page-draft` posé par
 * la route de la toile (/admin/api/editeur/toile, admin et même origine), et
 * session admin vérifiée en base. Hors draft mode, aucun cookie n'est lu : les
 * pages publiques restent en cache, sans jamais contenir un brouillon.
 */
import { eq } from "drizzle-orm";
import { cookies, draftMode } from "next/headers";
import { cache } from "react";

import { isBuildPhase } from "./cache";
import { getDb, schema } from "./db";
import { parseJson } from "./json";
import { SiteSnapSchema, type SiteSnap } from "./site-schema";
import { isAdminPreview } from "./page-preview";
import type { RawBlock } from "./pages";

export const DRAFT_VIEW_COOKIE = "page-draft";

export const isDraftView = cache(async (): Promise<boolean> => {
  if (isBuildPhase()) return false;
  try {
    if (!(await draftMode()).isEnabled) return false;
    if ((await cookies()).get(DRAFT_VIEW_COOKIE)?.value !== "1") return false;
  } catch {
    // Hors requête (script, test) : jamais de brouillon.
    return false;
  }
  return isAdminPreview();
});

/** Blocs du brouillon d'une page (vue brouillon), ou null s'il n'y en a pas. Lecture directe, sans cache. */
export async function getDraftBlocks(pageId: number): Promise<RawBlock[] | null> {
  const row = getDb().select({ draft: schema.pages.draft }).from(schema.pages).where(eq(schema.pages.id, pageId)).get();
  const blocks = (row?.draft as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks)) return null;
  return blocks.map((b, i) => {
    const block = (b ?? {}) as { uid?: unknown; type?: unknown; props?: unknown };
    return {
      id: -(i + 1),
      uid: typeof block.uid === "string" ? block.uid : `b${i}`,
      type: typeof block.type === "string" ? block.type : "",
      props: block.props,
      corrupt: block.props === undefined || block.props === null || typeof block.props !== "object",
    };
  });
}

/**
 * Page rendue par la requête en vue brouillon : seule SA surcouche
 * d'emplacements est appliquée par la galerie (pas celle d'une autre page qui
 * partage un projet). Posée par la route des pages avant le rendu des blocs.
 */
const draftPageSlot = cache((): { id: number | null } => ({ id: null }));
export function setDraftViewPage(id: number): void {
  draftPageSlot().id = id;
}
export function draftViewPage(): number | null {
  return draftPageSlot().id;
}

/**
 * Révision du brouillon (`pages.draft_rev`) au moment du rendu : la toile la
 * lit dans la page pour savoir si la réponse du serveur est au moins aussi
 * récente que ce que l'éditeur a écrit (src/components/edit/optimistic.ts).
 */
export function getDraftRev(pageId: number): number | null {
  return getDb().select({ rev: schema.pages.draftRev }).from(schema.pages).where(eq(schema.pages.id, pageId)).get()?.rev ?? null;
}

type L = { fr: string; en: string };
const isL = (v: unknown): v is L => Boolean(v) && typeof (v as L).fr === "string" && typeof (v as L).en === "string";

/** Titre, méta et accent du brouillon d'une page (vue brouillon), ou null. */
export function getDraftPageInfo(pageId: number): { title: L; meta: { title: L; description: L }; accent: string | null } | null {
  const draft = getDb().select({ draft: schema.pages.draft }).from(schema.pages).where(eq(schema.pages.id, pageId)).get()?.draft as
    | { title?: unknown; meta?: { title?: unknown; description?: unknown }; accent?: unknown }
    | null
    | undefined;
  if (!draft || typeof draft !== "object" || !isL(draft.title)) return null;
  const meta = draft.meta && isL(draft.meta.title) && isL(draft.meta.description) ? { title: draft.meta.title, description: draft.meta.description } : { title: { fr: "", en: "" }, description: { fr: "", en: "" } };
  const accent = typeof draft.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(draft.accent) ? draft.accent : null;
  return { title: draft.title, meta, accent };
}

/**
 * Brouillon de l'en-tête, du pied et des réseaux (communs au site) porté par
 * CETTE page, en vue brouillon seulement (src/lib/edit/site.ts) ; sinon null.
 */
export async function getDraftSite(pageId: number): Promise<SiteSnap | null> {
  if (!(await isDraftView())) return null;
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, "siteDraft")).get();
  const raw = parseJson(row?.value) as { pageId?: unknown; snap?: unknown } | undefined;
  if (!raw || raw.pageId !== pageId) return null;
  const snap = SiteSnapSchema.safeParse(raw.snap);
  return snap.success ? snap.data : null;
}
