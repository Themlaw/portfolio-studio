/**
 * En-tête, pied de page et réseaux édités sur la toile (v0.13) : un
 * brouillon GLOBAL du site, porté par le brouillon d'UNE page (comme la
 * surcouche des planches) : réglage `siteDraft` = { pageId, snap }.
 *
 * - Rien n'est public avant « Publier » de cette page : la publication
 *   applique l'identité, le menu et les réseaux dans la même transaction que
 *   la page (applySiteDraft) ; « Abandonner » l'efface.
 * - Une autre page ne peut pas le modifier tant qu'il existe (la page qui le
 *   tient est nommée) ; l'écran Réglages refuse d'enregistrer pendant ce temps.
 * - Chaque écriture porte la version de la page (`draft_rev`) et l'incrémente.
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { cleanSiteStyles, SiteStylesSchema } from "@/lib/look";
import { asSiteName, canonicalSnap, SiteSnapSchema, type SiteSnap } from "@/lib/site-schema";

import { sitePaletteProblem } from "@/themes/site-palette";
import type { PaletteColors } from "@/themes/palette";

import { touchPage } from "./boards";
import type { DraftRefusal } from "./drafts";
import { activeThemeForEdit } from "./look-context";
import { cleanNav, readNav, writeNav } from "./nav";
import { done, fail, type ActionResult } from "./result";

const L0 = { fr: "", en: "" };
const asL = (v: unknown) => {
  const o = (v ?? {}) as { fr?: unknown; en?: unknown };
  return { fr: typeof o.fr === "string" ? o.fr : "", en: typeof o.en === "string" ? o.en : "" };
};

function setting(key: string): unknown {
  return parseJson(getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value);
}

function writeSetting(key: string, value: unknown): void {
  const v = JSON.stringify(value);
  getDb().insert(schema.settings).values({ key, value: v }).onConflictDoUpdate({ target: schema.settings.key, set: { value: v } }).run();
}

/** Version publiée (réglages + menu). */
export function readPublishedSite(): SiteSnap {
  const site = (setting("site") ?? {}) as Record<string, unknown>;
  const rawSocials = setting("socials");
  const socials = Array.isArray(rawSocials)
    ? rawSocials
        .filter((s) => s && typeof s === "object")
        .map((s) => {
          const x = s as { label?: unknown; href?: unknown; kind?: unknown };
          return { label: String(x.label ?? ""), href: String(x.href ?? ""), ...(typeof x.kind === "string" ? { kind: x.kind } : {}) };
        })
    : [];
  // Styles du site (lot 2) : un réglage illisible est ignoré, jamais bloquant.
  const styles = SiteStylesSchema.safeParse(setting("styles")).data;
  const snap = {
    identity: {
      name: asSiteName(site.name),
      role: site.role ? asL(site.role) : L0,
      email: typeof site.email === "string" ? site.email : "",
      credit: site.credit ? asL(site.credit) : L0,
      ...(site.headerSocials === true ? { headerSocials: true } : {}),
    },
    nav: readNav(),
    socials,
    ...(styles && Object.keys(styles).length ? { styles } : {}),
  };
  // Une donnée ancienne invalide n'empêche pas l'édition : on garde ce qui passe.
  const parsed = SiteSnapSchema.safeParse(snap);
  if (parsed.success) return parsed.data;
  return {
    identity: SiteSnapSchema.shape.identity.safeParse(snap.identity).data ?? { name: snap.identity.name.fr ? snap.identity.name : { fr: "Portfolio", en: "" }, role: L0, email: "", credit: L0 },
    nav: SiteSnapSchema.shape.nav.safeParse(snap.nav).data ?? [],
    // Un lien invalide ancien devient « à compléter » (gardé, non publié) plutôt que de disparaître.
    socials: socials.map((s) => (SiteSnapSchema.shape.socials.element.safeParse(s).success ? s : { label: s.label.slice(0, 40) || "Réseau", href: "#" })) as SiteSnap["socials"],
    ...(snap.styles ? { styles: snap.styles } : {}),
  };
}

export type SiteDraft = { pageId: number; snap: SiteSnap };

/** Brouillon du site en attente (lisible), ou null. */
export function readSiteDraft(): SiteDraft | null {
  const raw = setting("siteDraft") as { pageId?: unknown; snap?: unknown } | undefined;
  if (!raw || typeof raw !== "object") return null;
  const snap = SiteSnapSchema.safeParse(raw.snap);
  // Menu nettoyé à la lecture : une page supprimée depuis ne bloque jamais l'éditeur.
  return Number.isInteger(raw.pageId) && snap.success ? { pageId: raw.pageId as number, snap: { ...snap.data, nav: cleanNav(snap.data.nav) } } : null;
}

function pageTitle(id: number): string {
  return getDb().select({ title: schema.pages.title }).from(schema.pages).where(eq(schema.pages.id, id)).get()?.title.fr || `n° ${id}`;
}

/** Message de refus si une autre page tient le brouillon du site. */
export function siteLockedBy(pageId: number): string | null {
  const draft = readSiteDraft();
  return draft && draft.pageId !== pageId ? pageTitle(draft.pageId) : null;
}

const conflict = (rev: number): DraftRefusal => ({
  ok: false,
  message: "Cette page a été modifiée ailleurs (autre onglet, formulaire ou publication). Recharge pour reprendre la dernière version.",
  code: "conflict",
  rev,
});
class ConflictError extends Error {}
const pageRev = (id: number) => getDb().select({ rev: schema.pages.draftRev }).from(schema.pages).where(eq(schema.pages.id, id)).get()?.rev ?? null;

export type SiteResult = { before: SiteSnap; after: SiteSnap; rev: number; pending: boolean };

/**
 * Enregistre l'instantané du site comme brouillon de la page `pageId`
 * (version optimiste de la page). Identique à la version publiée : le
 * brouillon disparaît (rien à publier).
 */
export function saveSiteDraft(pageId: number, input: unknown, rev: unknown): ActionResult<SiteResult> | DraftRefusal {
  if (!Number.isInteger(rev) || (rev as number) < 0) return fail("Requête invalide (version manquante) : recharge l'éditeur.");
  const parsed = SiteSnapSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "En-tête invalide : recharge l'éditeur.");
  const current = pageRev(pageId);
  if (current === null) return fail("Cette page n'existe plus.");
  if (current !== rev) return conflict(current);
  // Image du logo (lot 26) : une image de la médiathèque, qui existe encore.
  const logoMediaId = parsed.data.styles?.logo?.mediaId;
  if (logoMediaId !== undefined) {
    const media = getDb().select({ kind: schema.media.kind, deletedAt: schema.media.deletedAt }).from(schema.media).where(eq(schema.media.id, logoMediaId)).get();
    if (media?.kind !== "image" || media.deletedAt) return fail("L'image du logo n'existe plus ou n'est pas une image : choisis-en une autre dans la médiathèque.");
  }
  const locked = siteLockedBy(pageId);
  if (locked) return fail(`L'en-tête est en cours de modification sur la page ${locked} : publie-la ou abandonne-la d'abord.`);
  // Autonettoyage : pages disparues (ou réservées) et doublons retirés, jamais de refus bloquant.
  const styles = cleanSiteStyles(parsed.data.styles);
  const { styles: _drop, ...rest } = parsed.data;
  void _drop;
  const snap: SiteSnap = canonicalSnap({ ...rest, nav: cleanNav(parsed.data.nav), ...(styles ? { styles } : {}) });
  const db = getDb();
  const before = readSiteDraft()?.snap ?? readPublishedSite();
  const same = JSON.stringify(snap) === JSON.stringify(canonicalSnap(readPublishedSite()));
  try {
    db.transaction(() => {
      if (!touchPage(pageId, rev as number)) throw new ConflictError();
      if (same) db.delete(schema.settings).where(eq(schema.settings.key, "siteDraft")).run();
      else writeSetting("siteDraft", { pageId, snap });
    });
  } catch (error) {
    if (error instanceof ConflictError) return conflict(pageRev(pageId) ?? (rev as number));
    throw error;
  }
  return done({ before, after: snap, rev: (rev as number) + 1, pending: !same });
}

/**
 * Publication de la page `pageId` : applique son brouillon du site (dans la
 * transaction de l'appelant). Renvoie true si le site a changé.
 */
export function applySiteDraft(pageId: number): boolean {
  const draft = readSiteDraft();
  if (!draft || draft.pageId !== pageId) return false;
  const site = (setting("site") ?? {}) as Record<string, unknown>;
  writeSetting("site", { ...site, ...draft.snap.identity });
  writeSetting("socials", draft.snap.socials);
  // Styles du site (lot 2) : absents = ceux du thème.
  if (draft.snap.styles && Object.keys(draft.snap.styles).length) writeSetting("styles", draft.snap.styles);
  else getDb().delete(schema.settings).where(eq(schema.settings.key, "styles")).run();
  // Le brouillon a suivi les changements faits ailleurs (nav.ts) ; les pages
  // dont l'appartenance au menu change ont leur brouillon mis à jour (case
  // « dans le menu »), sauf la page publiée (son brouillon est vidé).
  const before = new Set(readNav().flatMap((i) => (i.kind === "page" ? [i.pageId] : [])));
  writeNav(draft.snap.nav);
  const after = new Set(readNav().flatMap((i) => (i.kind === "page" ? [i.pageId] : [])));
  for (const id of new Set([...before, ...after])) {
    if (id === pageId || before.has(id) === after.has(id)) continue;
    const row = getDb().select({ draft: schema.pages.draft, rev: schema.pages.draftRev }).from(schema.pages).where(eq(schema.pages.id, id)).get();
    if (!row?.draft || typeof row.draft !== "object") continue;
    getDb()
      .update(schema.pages)
      .set({ draft: { ...(row.draft as Record<string, unknown>), inMenu: after.has(id) }, draftRev: row.rev + 1 })
      .where(eq(schema.pages.id, id))
      .run();
  }
  getDb().delete(schema.settings).where(eq(schema.settings.key, "siteDraft")).run();
  return true;
}

/**
 * Publication : la palette du brouillon du site (portée par cette page) ne doit laisser aucun texte
 * illisible (AA 4,5:1) avec le thème actif. Message, ou null. La saisie n'est jamais bloquée : seule
 * la mise en ligne l'est (comme l'accent d'une page).
 */
export function siteDraftPaletteProblem(pageId: number): string | null {
  const draft = readSiteDraft();
  const palette = draft && draft.pageId === pageId ? draft.snap.styles?.palette : undefined;
  if (!palette) return null;
  const theme = activeThemeForEdit();
  return sitePaletteProblem(theme.tokens.color as PaletteColors, theme.tokens.palette, palette);
}

/** Abandon (ou suppression) de la page `pageId` : son brouillon du site est effacé. */
export function discardSiteDraft(pageId: number): void {
  const raw = setting("siteDraft") as { pageId?: unknown } | undefined;
  if (raw && typeof raw === "object" && raw.pageId === pageId) getDb().delete(schema.settings).where(eq(schema.settings.key, "siteDraft")).run();
}

/** Pour l'éditeur : l'état du site vu depuis cette page. */
export function siteForEditor(pageId: number): { snap: SiteSnap; pending: boolean; lockedBy: string | null } {
  const draft = readSiteDraft();
  if (draft && draft.pageId === pageId) return { snap: draft.snap, pending: true, lockedBy: null };
  return { snap: readPublishedSite(), pending: false, lockedBy: draft ? pageTitle(draft.pageId) : null };
}
