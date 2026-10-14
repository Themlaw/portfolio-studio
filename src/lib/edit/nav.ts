/**
 * Menu du site (v0.13) : réglage `nav` (liste ordonnée de liens : pages du
 * site, ou liens libres). `pages.nav_order` est tenu en phase (ordre des
 * pages du menu) pour les écrans qui le lisent encore (liste des pages,
 * formulaire). Toute écriture du menu passe par writeNav (dans la
 * transaction de l'appelant : une seule connexion SQLite synchrone).
 *
 * Brouillon de l'en-tête (`siteDraft`, src/lib/edit/site.ts) : les gestes
 * faits AILLEURS sur le menu (page mise au menu ou retirée depuis la liste
 * des pages, ordre du menu, page supprimée, case « dans le menu » d'une page)
 * y sont reportés aussi : la publication de l'en-tête ne les défait jamais.
 * Une page disparue est retirée partout (autonettoyage, jamais de blocage).
 */
import { asc, eq, isNotNull, isNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { NavSchema, SiteSnapSchema, type NavItem } from "@/lib/site-schema";

/** Pages qui peuvent figurer au menu (existantes, pas réservées). */
function livePages(): Set<number> {
  return new Set(
    getDb()
      .select({ id: schema.pages.id, slug: schema.pages.slug })
      .from(schema.pages)
      .where(isNull(schema.pages.deletedAt))
      .all()
      .filter((p) => !p.slug.fr.startsWith("_"))
      .map((p) => p.id),
  );
}

/** Menu nettoyé : pages disparues et doublons retirés. */
export function cleanNav(items: NavItem[], live = livePages()): NavItem[] {
  const seen = new Set<number>();
  return items.filter((i) => {
    if (i.kind !== "page") return true;
    if (!live.has(i.pageId) || seen.has(i.pageId)) return false;
    seen.add(i.pageId);
    return true;
  });
}

/** Menu publié : le réglage s'il est lisible, sinon celui des pages (avant v0.13) ; toujours nettoyé. */
export function readNav(): NavItem[] {
  const db = getDb();
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, "nav")).get();
  const parsed = NavSchema.safeParse(parseJson(row?.value));
  if (row && parsed.success) return cleanNav(parsed.data);
  return db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(isNotNull(schema.pages.navOrder))
    .orderBy(asc(schema.pages.navOrder))
    .all()
    .map((p) => ({ kind: "page" as const, pageId: p.id }));
}

/** Écrit le menu (nettoyé) et recale `pages.nav_order` (pages absentes : hors menu). */
export function writeNav(input: NavItem[]): void {
  const db = getDb();
  const items = cleanNav(input);
  const value = JSON.stringify(items);
  db.insert(schema.settings).values({ key: "nav", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
  const order = new Map<number, number>();
  for (const item of items) if (item.kind === "page" && !order.has(item.pageId)) order.set(item.pageId, order.size + 1);
  for (const p of db.select({ id: schema.pages.id, navOrder: schema.pages.navOrder }).from(schema.pages).all()) {
    const next = order.get(p.id) ?? null;
    if (next !== p.navOrder) db.update(schema.pages).set({ navOrder: next }).where(eq(schema.pages.id, p.id)).run();
  }
}

/** Le brouillon de l'en-tête en attente (brut), s'il y en a un lisible. */
function draftRow(): { pageId: number; snap: ReturnType<typeof SiteSnapSchema.parse> } | null {
  const raw = parseJson(getDb().select().from(schema.settings).where(eq(schema.settings.key, "siteDraft")).get()?.value) as
    | { pageId?: unknown; snap?: unknown }
    | undefined;
  const snap = SiteSnapSchema.safeParse(raw?.snap);
  return raw && Number.isInteger(raw.pageId) && snap.success ? { pageId: raw.pageId as number, snap: snap.data } : null;
}

/**
 * Reporte un changement du menu dans le brouillon de l'en-tête, s'il existe,
 * et incrémente la version (`draft_rev`) de la page qui le porte, dans la
 * transaction de l'appelant : un éditeur resté ouvert sur l'ancien
 * instantané reçoit « Modifié ailleurs » au lieu de défaire ce changement.
 * `skipRevOf` : page dont l'appelant gère lui-même la version (publication).
 */
function updateDraftNav(fn: (items: NavItem[]) => NavItem[], skipRevOf?: number): void {
  const draft = draftRow();
  if (!draft) return;
  const nav = cleanNav(fn(draft.snap.nav));
  if (JSON.stringify(nav) === JSON.stringify(draft.snap.nav)) return;
  const db = getDb();
  const value = JSON.stringify({ pageId: draft.pageId, snap: { ...draft.snap, nav } });
  db.update(schema.settings).set({ value }).where(eq(schema.settings.key, "siteDraft")).run();
  if (draft.pageId !== skipRevOf) {
    const row = db.select({ rev: schema.pages.draftRev }).from(schema.pages).where(eq(schema.pages.id, draft.pageId)).get();
    if (row) db.update(schema.pages).set({ draftRev: row.rev + 1 }).where(eq(schema.pages.id, draft.pageId)).run();
  }
}

const hasPage = (items: NavItem[], pageId: number) => items.some((i) => i.kind === "page" && i.pageId === pageId);
const togglePage = (items: NavItem[], pageId: number, inMenu: boolean): NavItem[] =>
  inMenu ? (hasPage(items, pageId) ? items : [...items, { kind: "page", pageId }]) : items.filter((i) => !(i.kind === "page" && i.pageId === pageId));

/** Page ajoutée en fin de menu, ou retirée : menu publié ET brouillon de l'en-tête. */
export function setPageInNav(pageId: number, inMenu: boolean, opts: { skipRevOf?: number } = {}): void {
  const items = readNav();
  if (hasPage(items, pageId) !== inMenu) writeNav(togglePage(items, pageId, inMenu));
  updateDraftNav((d) => togglePage(d, pageId, inMenu), opts.skipRevOf);
}

/** Dans le menu publié ? */
export const isPageInNav = (pageId: number): boolean => hasPage(readNav(), pageId);

/** Applique l'ordre des pages `ids` à une liste ; les liens libres et les pages hors `ids` gardent leur place. */
function reorder(items: NavItem[], ids: number[]): NavItem[] {
  const wanted = ids.filter((id) => hasPage(items, id));
  const pages = wanted.map((id) => items.find((x) => x.kind === "page" && x.pageId === id)!);
  let k = 0;
  return items.map((i) => (i.kind === "page" && wanted.includes(i.pageId) ? (pages[k++] ?? i) : i));
}

/** Nouvel ordre des pages du menu (publié ET brouillon de l'en-tête). */
export function reorderNavPages(ids: number[]): void {
  writeNav(reorder(readNav(), ids));
  updateDraftNav((d) => reorder(d, ids));
}
