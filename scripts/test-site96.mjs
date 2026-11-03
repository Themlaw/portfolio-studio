#!/usr/bin/env node
/**
 * Lot 96 — brouillon COMMUN du site (src/lib/edit/site.ts, site-rev.ts), sur une VRAIE base (seed, dossier temporaire), sans serveur
 * (inclus dans npm test). Données synthétiques.
 *  1. Un seul brouillon : modifié depuis une page, lu à l'identique pour toutes (siteForEditor), version propre (`siteDraftRev`).
 *  2. « Publier » de N'IMPORTE quelle page (même sans brouillon de page) publie le brouillon du site ; la version avance.
 *  3. « Abandonner » une page et supprimer une page ne touchent pas au brouillon du site ; discardSiteDraft (version contrôlée) l'efface.
 *  4. Conflits : version périmée refusée (écriture, abandon), rien d'écrasé.
 *  5. Compatibilité : un siteDraft { pageId, snap } sans version (v0.31.1) est repris tel quel ; `pageId` reste écrit (dernière page) ;
 *     un siteDraft sans pageId reste lisible.
 *  6. Menu : un changement de menu reporté dans le brouillon du site avance la version du site, pas celle d'une page.
 *  7. Réglages : enregistre malgré le brouillon, le reporte dans le brouillon (menu et styles gardés), le brouillon identique au publié disparaît.
 * Usage : node --import tsx scripts/test-site96.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "pf-test-site96-"));
process.env.DATA_DIR = dir;
const log = console.log;
console.log = () => {};
const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
await bootstrap();
const { getDb, schema } = await import("../src/lib/db/index.ts");
const { eq } = await import("drizzle-orm");
const site = await import("../src/lib/edit/site.ts");
const { readSiteRev } = await import("../src/lib/edit/site-rev.ts");
const { publishDraft, discardDraft, readDraft } = await import("../src/lib/edit/drafts.ts");
const { saveSettings } = await import("../src/lib/edit/settings.ts");
const { createPage, deletePage } = await import("../src/lib/edit/pages.ts");
const { setPageInNav, readNav } = await import("../src/lib/edit/nav.ts");
console.log = log;

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const db = getDb();
const L = (s) => ({ fr: s, en: s });
const pages = db.select({ id: schema.pages.id, slug: schema.pages.slug }).from(schema.pages).all();
const idOf = (fr) => pages.find((p) => p.slug.fr === fr).id;
const HOME = idOf("");
const A = idOf("personnages");
const B = idOf("decors");
const C = idOf("animation");
const raw = (key) => {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row ? JSON.parse(row.value) : null;
};
const put = (key, value) => db.insert(schema.settings).values({ key, value: JSON.stringify(value) }).onConflictDoUpdate({ target: schema.settings.key, set: { value: JSON.stringify(value) } }).run();
const del = (key) => db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
const prev = () => site.readPublishedSite();
const withName = (name, over = {}) => ({ ...prev(), identity: { ...prev().identity, name: L(name) }, ...over });
const pageRev = (id) => readDraft(id).rev;
const ok = (r) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data;
};

await test("1. un seul brouillon, lu à l'identique par toutes les pages, version propre", () => {
  assert.equal(readSiteRev(), 0);
  assert.equal(site.siteForEditor().pending, false);
  const r = ok(site.saveSiteDraft(B, withName("Atelier Test96"), 0));
  assert.equal(r.rev, 1);
  assert.equal(r.pending, true);
  for (const id of [HOME, A, B, C]) {
    const v = site.siteForEditor(id);
    assert.equal(v.snap.identity.name.fr, "Atelier Test96", `page ${id}`);
    assert.equal(v.pending, true);
    assert.equal(v.rev, 1);
  }
  assert.equal(raw("site").name.fr !== "Atelier Test96", true, "rien de public");
  assert.equal(raw("siteDraft").pageId, B, "pageId = dernière page qui l'a modifié");
  assert.equal(raw("siteDraftRev"), 1);
  assert.equal(readDraft(B).hasDraft, false, "le brouillon de la page B n'est pas créé");
  // Une autre page modifie à son tour (plus de verrou) : pageId suit.
  const r2 = ok(site.saveSiteDraft(A, withName("Atelier Test96 bis"), 1));
  assert.equal(r2.rev, 2);
  assert.equal(raw("siteDraft").pageId, A);
  assert.equal(site.siteForEditor(C).snap.identity.name.fr, "Atelier Test96 bis");
  // Identique au publié : le brouillon disparaît.
  const r3 = ok(site.saveSiteDraft(A, prev(), 2));
  assert.equal(r3.pending, false);
  assert.equal(raw("siteDraft"), null);
  assert.equal(readSiteRev(), 3, "la version ne retombe jamais à zéro");
});

await test("2. « Publier » de n'importe quelle page publie le brouillon du site (même sans brouillon de page)", () => {
  const rev0 = readSiteRev();
  ok(site.saveSiteDraft(B, withName("Atelier Publié96"), rev0));
  assert.equal(readDraft(HOME).hasDraft, false);
  const res = publishDraft(HOME, pageRev(HOME), {});
  const data = ok(res);
  assert.equal(data.site, true);
  assert.equal(raw("site").name.fr, "Atelier Publié96");
  assert.equal(raw("siteDraft"), null, "le brouillon du site a disparu");
  assert.ok(readSiteRev() > rev0 + 1);
  assert.equal(site.siteForEditor(B).pending, false);
  // Rien à publier : refus comme avant.
  assert.equal(publishDraft(HOME, pageRev(HOME), {}).ok, false);
});

await test("3. abandonner / supprimer une page ne touche pas au brouillon du site ; discardSiteDraft l'efface", () => {
  const rev0 = readSiteRev();
  const D = ok(createPage({ title: { fr: "Page test96", en: "" }, slug: { fr: "page-test96", en: "" } })).id;
  ok(site.saveSiteDraft(D, withName("Atelier Abandon96"), rev0));
  const rev1 = readSiteRev();
  ok(discardDraft(D, pageRev(D)));
  assert.equal(raw("siteDraft").snap.identity.name.fr, "Atelier Abandon96", "« Abandonner » la page garde le site");
  assert.equal(readSiteRev(), rev1);
  // Page supprimée (corbeille) : le brouillon du site reste, même rattaché à elle.
  assert.equal(raw("siteDraft").pageId, D);
  ok(deletePage(D));
  assert.equal(raw("siteDraft").snap.identity.name.fr, "Atelier Abandon96", "page supprimée : rien de perdu");
  assert.ok(pages.some((p) => p.id === raw("siteDraft").pageId) && raw("siteDraft").pageId !== D, "pageId ne désigne plus la page supprimée (une v0.31.x ne verrouillerait pas tout)");
  assert.equal(raw("siteDraftRev"), rev1, "version inchangée");
  assert.equal(site.siteForEditor(A).pending, true);
  // Version périmée : refus ; bonne version : effacé.
  const stale = site.discardSiteDraft(rev1 - 1);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "conflict");
  assert.ok(raw("siteDraft"));
  const done = ok(site.discardSiteDraft(rev1));
  assert.equal(done.rev, rev1 + 1);
  assert.equal(raw("siteDraft"), null);
  assert.equal(site.discardSiteDraft("x").ok, false);
});

await test("4. conflits : version du brouillon du site périmée refusée, rien d'écrasé", () => {
  const rev0 = readSiteRev();
  ok(site.saveSiteDraft(A, withName("Premier"), rev0));
  const stale = site.saveSiteDraft(B, withName("Second"), rev0);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "conflict");
  assert.equal(stale.rev, rev0 + 1);
  assert.equal(raw("siteDraft").snap.identity.name.fr, "Premier");
  assert.equal(site.saveSiteDraft(B, withName("Second"), "1").ok, false, "version non entière");
  assert.equal(site.saveSiteDraft(B, withName("Second"), -1).ok, false);
  assert.equal(site.saveSiteDraft(99999, withName("Second"), rev0 + 1).ok, false, "page inexistante");
  // Version de la page (l'éditeur la donne toujours) : contrôlée et incrémentée, sans créer de brouillon de page.
  const pr = pageRev(B);
  const stalePage = site.saveSiteDraft(B, withName("Troisième"), rev0 + 1, pr + 2);
  assert.equal(stalePage.ok, false);
  assert.equal(stalePage.code, "conflict");
  assert.equal(stalePage.rev, pr);
  assert.match(stalePage.message, /Cette page a été modifiée ailleurs/);
  assert.equal(raw("siteDraft").snap.identity.name.fr, "Premier", "rien d'écrit");
  assert.equal(site.saveSiteDraft(B, withName("Troisième"), rev0 + 1, "x").ok, false, "version de page non entière");
  const withPage = ok(site.saveSiteDraft(B, withName("Troisième"), rev0 + 1, pr));
  assert.equal(withPage.pageRev, pr + 1);
  assert.equal(pageRev(B), pr + 1, "version de la page incrémentée (la toile s'en sert)");
  assert.equal(readDraft(B).hasDraft, false, "aucun brouillon de page créé");
  assert.equal(raw("siteDraft").pageId, B);
  ok(site.discardSiteDraft(readSiteRev()));
});

await test("5. compatibilité : siteDraft { pageId, snap } d'une v0.31.1 (sans version) repris tel quel ; sans pageId lisible", () => {
  const snap = withName("Atelier Repris96", { socials: [{ label: "Behance", href: "https://www.behance.net/test96", kind: "behance" }], nav: [...readNav(), { kind: "link", href: "https://example.test/x", label: L("Lien test96") }].map((i) => i) });
  del("siteDraftRev");
  put("siteDraft", { pageId: A, snap });
  assert.equal(readSiteRev(), 0, "pas de version : 0");
  for (const id of [HOME, A, B]) {
    const v = site.siteForEditor(id);
    assert.equal(v.pending, true, `page ${id}`);
    assert.equal(v.snap.identity.name.fr, "Atelier Repris96");
    assert.equal(v.snap.socials[0].href, "https://www.behance.net/test96");
    assert.ok(v.snap.nav.some((i) => i.kind === "link" && i.href === "https://example.test/x"));
  }
  // Une écriture depuis une AUTRE page garde tout le reste et réécrit pageId.
  const cur = site.siteForEditor(B).snap;
  ok(site.saveSiteDraft(B, { ...cur, identity: { ...cur.identity, role: L("Rôle test96") } }, 0));
  const d = raw("siteDraft");
  assert.equal(d.pageId, B);
  assert.equal(d.snap.identity.name.fr, "Atelier Repris96");
  assert.equal(d.snap.identity.role.fr, "Rôle test96");
  assert.equal(d.snap.socials.length, 1);
  // Forme lisible par une v0.31.1 : { pageId entier, snap valide } (rien d'autre n'est exigé).
  assert.ok(Number.isInteger(d.pageId) && d.snap && d.snap.identity && Array.isArray(d.snap.nav) && Array.isArray(d.snap.socials));
  // Brouillon sans pageId : lisible aussi.
  put("siteDraft", { snap });
  assert.equal(site.readSiteDraft().snap.identity.name.fr, "Atelier Repris96");
  // Publié par la page C (supprimée plus haut ? non : HOME) : tout est en ligne.
  put("siteDraft", { pageId: A, snap });
  ok(publishDraft(HOME, pageRev(HOME), {}));
  assert.equal(raw("site").name.fr, "Atelier Repris96");
  assert.equal(raw("socials")[0].href, "https://www.behance.net/test96");
  assert.ok(raw("nav").some((i) => i.kind === "link" && i.href === "https://example.test/x"));
  assert.equal(raw("siteDraft"), null);
});

await test("6. menu : un changement de menu reporté dans le brouillon avance la version du site, pas celle d'une page", () => {
  const rev0 = readSiteRev();
  ok(site.saveSiteDraft(A, withName("Menu test96"), rev0));
  const rev1 = readSiteRev();
  const aRev = pageRev(A);
  const bRev = pageRev(B);
  const inMenu = readNav().some((i) => i.kind === "page" && i.pageId === B);
  setPageInNav(B, !inMenu);
  assert.equal(readSiteRev(), rev1 + 1, "version du site avancée");
  assert.equal(pageRev(A), aRev, "page A intacte");
  assert.equal(pageRev(B), bRev, "page B intacte");
  assert.equal(site.siteForEditor(HOME).snap.nav.some((i) => i.kind === "page" && i.pageId === B), !inMenu, "le brouillon a suivi");
  setPageInNav(B, inMenu);
  ok(site.discardSiteDraft(readSiteRev()));
});

await test("7. Réglages : enregistre malgré le brouillon, le reporte (menu et styles gardés) ; identique au publié : le brouillon disparaît", () => {
  const base = prev();
  const styles = { roles: { menu: { case: "upper" } } };
  const nav = [...base.nav, { kind: "link", href: "https://example.test/menu", label: L("Menu test96") }];
  ok(site.saveSiteDraft(A, { ...base, identity: { ...base.identity, email: "avant@example.test" }, nav, styles }, readSiteRev()));
  const rev1 = readSiteRev();
  const input = { site: { ...raw("site"), email: "apres@example.test" }, socials: raw("socials") ?? [] };
  const r = saveSettings(input);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(raw("site").email, "apres@example.test", "publié tout de suite");
  const d = raw("siteDraft");
  assert.equal(d.snap.identity.email, "apres@example.test", "reporté dans le brouillon");
  assert.deepEqual(d.snap.styles, styles, "styles gardés");
  assert.ok(d.snap.nav.some((i) => i.kind === "link" && i.href === "https://example.test/menu"), "menu gardé");
  assert.equal(d.pageId, A);
  assert.ok(readSiteRev() > rev1);
  // Le brouillon n'a plus que le menu et les styles de différents. Retour au publié : il disparaît.
  ok(site.saveSiteDraft(A, prev(), readSiteRev()));
  assert.equal(raw("siteDraft"), null);
  const r2 = saveSettings({ site: { ...raw("site"), email: "autre@example.test" }, socials: raw("socials") ?? [] });
  assert.equal(r2.ok, true);
  assert.equal(raw("siteDraft"), null, "sans brouillon, Réglages n'en crée pas");
});

console.log(`\n${passed} tests passés`);
