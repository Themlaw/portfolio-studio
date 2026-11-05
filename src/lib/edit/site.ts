/**
 * En-tête, pied de page, réseaux, menu et styles du site édités sur la toile : UN SEUL brouillon du site, partagé
 * par toutes les pages (lot 96) : réglage `siteDraft` = { pageId, snap }.
 *
 * - Toutes les pages l'affichent dans l'éditeur ; `pageId` n'est plus qu'une information (la dernière page qui l'a
 *   modifié), écrite pour qu'un retour en v0.31.x retrouve un brouillon lisible. Plus de page détentrice, plus de verrou.
 * - Rien n'est public avant « Publier » : « Publier » de N'IMPORTE quelle page applique le brouillon du site dans la
 *   même transaction (applySiteDraft). « Abandonner » une page ne l'efface pas ; seul discardSiteDraft() le fait.
 * - Version propre au brouillon : réglage `siteDraftRev` (site-rev.ts), jamais remis à zéro ; chaque écriture, publication
 *   ou abandon l'incrémente, un onglet resté sur l'ancien état reçoit « modifié ailleurs ».
 * - L'éditeur envoie aussi la version de SA page (`pageRev`) : elle est contrôlée et incrémentée (sans créer de brouillon de page) pour que la
 *   toile sache quand son rendu a rattrapé l'écriture (`data-edit-rev`, edit/optimistic.ts) et qu'un onglet en retard sur la page soit refusé.
 */
import { and, eq, isNull, ne } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { cleanSiteStyles, SiteStylesSchema } from "@/lib/look";
import { asSiteName, canonicalSnap, navKeys, SiteSnapSchema, socialKeys, type SiteSnap } from "@/lib/site-schema";


import type { DraftRefusal } from "./drafts";
import { cleanNav, readNav, writeNav } from "./nav";
import { done, fail, type ActionResult } from "./result";
import { bumpSiteRev, readSiteRev } from "./site-rev";

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

/** Couleurs personnalisées du site publiées (lot 55) : surcharges posées par-dessus le thème, vides si aucune. */
export function publishedSitePalette(): NonNullable<NonNullable<SiteSnap["styles"]>["palette"]> {
  return readPublishedSite().styles?.palette ?? {};
}

/**
 * « Revenir aux couleurs du thème » (lot 55) : retire les couleurs personnalisées publiées du site. Refusé tant qu'un
 * brouillon du site (éditeur de page) est en attente : sa publication les remettrait.
 */
export function resetPublishedSitePalette(): ActionResult<null> {
  const draft = readSiteDraft();
  if (draft) return fail("Des changements du site sont en attente dans l'éditeur : publie une page (elle les publie) ou utilise « Annuler ces changements du site » d'abord.");
  const styles = (setting("styles") ?? {}) as Record<string, unknown>;
  if (!styles || typeof styles !== "object" || !("palette" in styles)) return done(null);
  const { palette: _palette, ...rest } = styles;
  if (Object.keys(rest).length) writeSetting("styles", rest);
  else getDb().delete(schema.settings).where(eq(schema.settings.key, "styles")).run();
  return done(null);
}

export type SiteDraft = { pageId: number; snap: SiteSnap; rev: number };

/** Brouillon du site en attente (lisible), ou null. */
export function readSiteDraft(): SiteDraft | null {
  const raw = setting("siteDraft") as { pageId?: unknown; snap?: unknown } | undefined;
  if (!raw || typeof raw !== "object") return null;
  const snap = SiteSnapSchema.safeParse(raw.snap);
  // Menu nettoyé à la lecture : une page supprimée depuis ne bloque jamais l'éditeur.
  // `pageId` (ancien brouillon rattaché à une page) n'est plus qu'indicatif : un brouillon sans lui reste lisible.
  return snap.success ? { pageId: Number.isInteger(raw.pageId) ? (raw.pageId as number) : 0, snap: { ...snap.data, nav: cleanNav(snap.data.nav) }, rev: readSiteRev() } : null;
}

const conflict = (rev: number, page = false): DraftRefusal => ({
  ok: false,
  message: page
    ? "Cette page a été modifiée ailleurs (autre onglet, formulaire ou publication). Recharge pour reprendre la dernière version."
    : "Les changements du site ont été modifiés ailleurs (autre onglet, autre page, Réglages ou publication). Recharge pour reprendre la dernière version.",
  code: "conflict",
  rev,
});
class ConflictError extends Error {}
class PageConflictError extends Error {}
const pageRevOf = (id: number) => getDb().select({ rev: schema.pages.draftRev }).from(schema.pages).where(eq(schema.pages.id, id)).get()?.rev ?? null;

export type SiteResult = { before: SiteSnap; after: SiteSnap; rev: number; pending: boolean; /** Nouvelle version de la page d'où vient l'écriture (si `pageRev` donnée). */ pageRev?: number };

/**
 * Enregistre l'instantané du site comme brouillon COMMUN (version optimiste `rev` = celle du brouillon du site, pas
 * celle d'une page). `pageId` : la page d'où vient la modification (indicatif). `pageRev` (l'éditeur la donne toujours) : version de la
 * page d'où vient l'écriture, contrôlée et incrémentée dans la même transaction, sans créer de brouillon de page. Identique à la version
 * publiée : le brouillon disparaît (rien à publier).
 */
export function saveSiteDraft(pageId: number, input: unknown, rev: unknown, pageRev?: unknown): ActionResult<SiteResult> | DraftRefusal {
  if (!Number.isInteger(rev) || (rev as number) < 0) return fail("Requête invalide (version manquante) : recharge l'éditeur.");
  const parsed = SiteSnapSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "En-tête invalide : recharge l'éditeur.");
  if (pageRev !== undefined && (!Number.isInteger(pageRev) || (pageRev as number) < 0)) return fail("Requête invalide (version de la page manquante) : recharge l'éditeur.");
  const pageNow = pageRevOf(pageId);
  if (pageNow === null) return fail("Cette page n'existe plus.");
  if (pageRev !== undefined && pageNow !== pageRev) return conflict(pageNow, true);
  const current = readSiteRev();
  if (current !== rev) return conflict(current);
  // Image du logo (lot 26) : une image de la médiathèque, qui existe encore.
  const logoMediaId = parsed.data.styles?.logo?.mediaId;
  if (logoMediaId !== undefined) {
    const media = getDb().select({ kind: schema.media.kind, deletedAt: schema.media.deletedAt }).from(schema.media).where(eq(schema.media.id, logoMediaId)).get();
    if (media?.kind !== "image" || media.deletedAt) return fail("L'image du logo n'existe plus ou n'est pas une image : choisis-en une autre dans la médiathèque.");
  }
  // Autonettoyage : pages disparues (ou réservées) et doublons retirés, jamais de refus bloquant.
  // Réglages de texte d'un lien du menu ou d'un réseau qui n'existent plus : retirés (le menu et les réseaux sont ceux de CE brouillon).
  const navKeyList = navKeys(cleanNav(parsed.data.nav).map((i) => (i.kind === "page" ? { pageId: i.pageId, href: "" } : { href: i.href })));
  const liveKeys = new Set(["brand", ...navKeyList.map((k) => `n:${k}`), ...navKeyList.map((k) => `f:n:${k}`), ...socialKeys(parsed.data.socials).map((k) => `f:s:${k}`)]);
  const fixed = (key: string) => key.startsWith("f:") && !key.startsWith("f:n:") && !key.startsWith("f:s:");
  const kept = parsed.data.styles?.texts ? Object.fromEntries(Object.entries(parsed.data.styles.texts).filter(([k]) => fixed(k) || liveKeys.has(k))) : undefined;
  const styles = cleanSiteStyles(parsed.data.styles ? { ...parsed.data.styles, ...(parsed.data.styles.texts ? { texts: kept } : {}) } : undefined);
  const { styles: _drop, ...rest } = parsed.data;
  void _drop;
  const snap: SiteSnap = canonicalSnap({ ...rest, nav: cleanNav(parsed.data.nav), ...(styles ? { styles } : {}) });
  const db = getDb();
  const before = readSiteDraft()?.snap ?? readPublishedSite();
  const same = JSON.stringify(snap) === JSON.stringify(canonicalSnap(readPublishedSite()));
  let next = current;
  try {
    db.transaction(() => {
      if (readSiteRev() !== current) throw new ConflictError();
      if (pageRev !== undefined) {
        const bumped = db.update(schema.pages).set({ draftRev: (pageRev as number) + 1 }).where(and(eq(schema.pages.id, pageId), eq(schema.pages.draftRev, pageRev as number))).run();
        if (bumped.changes !== 1) throw new PageConflictError();
      }
      if (same) db.delete(schema.settings).where(eq(schema.settings.key, "siteDraft")).run();
      else writeSetting("siteDraft", { pageId, snap });
      next = bumpSiteRev();
    });
  } catch (error) {
    if (error instanceof PageConflictError) return conflict(pageRevOf(pageId) ?? 0, true);
    if (error instanceof ConflictError) return conflict(readSiteRev());
    throw error;
  }
  return done({ before, after: snap, rev: next, pending: !same, ...(pageRev !== undefined ? { pageRev: (pageRev as number) + 1 } : {}) });
}

/**
 * Écran Réglages (lot 96) : il PUBLIE directement le nom, le métier, l'e-mail, le crédit et les réseaux. Pour que le brouillon commun ne les
 * ré-écrase pas à la prochaine publication, ces valeurs y sont reportées (menu, en-tête, styles et logo du brouillon sont gardés) ; devenu
 * identique au publié, le brouillon disparaît. À appeler dans la transaction de l'appelant, après l'écriture publiée.
 */
export function syncSiteDraftWithPublished(identity: Partial<SiteSnap["identity"]>, socials: SiteSnap["socials"]): void {
  const draft = readSiteDraft();
  if (!draft) return;
  const snap = canonicalSnap({ ...draft.snap, identity: { ...draft.snap.identity, ...identity }, socials });
  const db = getDb();
  if (JSON.stringify(snap) === JSON.stringify(canonicalSnap(readPublishedSite()))) db.delete(schema.settings).where(eq(schema.settings.key, "siteDraft")).run();
  else writeSetting("siteDraft", { pageId: draft.pageId, snap });
  bumpSiteRev();
}

/** Rien à reprendre : le brouillon est commun (lot 96). Gardée pour les appelants qui existeraient encore : ne change rien. */
export function adoptSiteDraft(_pageId: number, _rev: unknown): ActionResult<{ snap: SiteSnap; rev: unknown; from: string }> {
  void _pageId;
  return done({ snap: readSiteDraft()?.snap ?? readPublishedSite(), rev: _rev, from: "" });
}

/**
 * Publication de la page `pageId` (n'importe laquelle) : applique le brouillon commun du site (dans la
 * transaction de l'appelant). Renvoie true si le site a changé.
 */
export function applySiteDraft(pageId: number): boolean {
  const draft = readSiteDraft();
  if (!draft) return false;
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
  bumpSiteRev();
  return true;
}

/**
 * Page supprimée (corbeille) : le brouillon du site, commun, n'est pas touché, mais son `pageId` (indicatif) ne doit pas désigner une page
 * à la corbeille : une v0.31.x relancée verrouillerait alors TOUTES les pages sur une page introuvable. Il passe à la première page encore
 * en ligne dans l'éditeur (à appeler APRÈS la mise à la corbeille, dans la transaction de l'appelant). Ni version, ni contenu changés.
 */
export function rehomeSiteDraft(deletedPageId: number): void {
  const raw = setting("siteDraft") as { pageId?: unknown; snap?: unknown } | undefined;
  if (!raw || typeof raw !== "object" || raw.pageId !== deletedPageId) return;
  const next = getDb().select({ id: schema.pages.id }).from(schema.pages).where(and(isNull(schema.pages.deletedAt), ne(schema.pages.id, deletedPageId))).orderBy(schema.pages.id).get()?.id;
  if (next !== undefined) writeSetting("siteDraft", { ...raw, pageId: next });
}

/**
 * « Annuler ces changements du site » : efface le brouillon commun (version contrôlée). Abandonner ou supprimer une
 * page ne le fait PAS.
 */
export function discardSiteDraft(rev: unknown): ActionResult<{ rev: number; snap: SiteSnap }> | DraftRefusal {
  if (!Number.isInteger(rev) || (rev as number) < 0) return fail("Requête invalide (version manquante) : recharge l'éditeur.");
  const current = readSiteRev();
  if (current !== rev) return conflict(current);
  const db = getDb();
  let next = current;
  try {
    db.transaction(() => {
      if (readSiteRev() !== current) throw new ConflictError();
      db.delete(schema.settings).where(eq(schema.settings.key, "siteDraft")).run();
      next = bumpSiteRev();
    });
  } catch (error) {
    if (error instanceof ConflictError) return conflict(readSiteRev());
    throw error;
  }
  return done({ rev: next, snap: readPublishedSite() });
}

/** Pour l'éditeur : l'état du site (le même sur toutes les pages), sa version, et s'il a des changements en attente. */
export function siteForEditor(): { snap: SiteSnap; pending: boolean; rev: number } {
  const draft = readSiteDraft();
  return { snap: draft?.snap ?? readPublishedSite(), pending: Boolean(draft), rev: readSiteRev() };
}
