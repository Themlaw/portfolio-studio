#!/usr/bin/env node
/**
 * v0.13 — publication, menu et formulaire sur une VRAIE base (seed, dans un
 * dossier temporaire), sans serveur (inclus dans npm test, léger) :
 *  1. Correction I1 : la surcouche d'une planche qui n'est plus sur la page
 *     (bloc retiré, conteneur supprimé) n'est JAMAIS appliquée ; celle d'une
 *     planche imbriquée présente l'est. (Tue le mutant « applySlotDrafts sans
 *     l'ensemble des projets affichés ».)
 *  2. Menu et brouillon de l'en-tête : changements faits ailleurs (liste des
 *     pages, ordre, page supprimée, case « dans le menu ») jamais défaits par
 *     la publication de l'en-tête ; jamais de blocage de l'éditeur.
 *  3. POST /api/contact : IP calculée derrière les proxys de confiance (XFF
 *     inventé ignoré), corps lu en flux et coupé (RSS stable), formulaire
 *     désigné par un identifiant stable entre deux publications.
 * Usage : node --import tsx scripts/test-publish.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "pf-test-publish-"));
process.env.DATA_DIR = dir;
process.env.AUTH_TRUSTED_PROXY_HOPS = "1";
const log = console.log;
console.log = () => {}; // journaux du démarrage
const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
await bootstrap();
console.log = log;
const { getDb, schema } = await import("../src/lib/db/index.ts");
const { eq } = await import("drizzle-orm");
const { readDraft, saveDraft, publishDraft, discardDraft } = await import("../src/lib/edit/drafts.ts");
const { createPage, deletePage, setInMenu, reorderMenu } = await import("../src/lib/edit/pages.ts");
const { saveSiteDraft, readPublishedSite, readSiteDraft, siteForEditor } = await import("../src/lib/edit/site.ts");
const { boardOp } = await import("../src/lib/edit/boards.ts");
const { POST } = await import("../src/app/api/contact/route.ts");
const { withFreshUids } = await import("../src/blocks/tree.ts");
const { defaultContactForm } = await import("../src/lib/contact-form.ts");

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const db = getDb();
const L = (s) => ({ fr: s, en: s });
const rev = (id) => readDraft(id).rev;
const base = (id) => readDraft(id).draft;
const k = (uid, type, props = {}) => ({ uid, type, props });
const newPage = (slug) => createPage({ title: L(slug), slug: L(slug) }).data.id;
const slotsOf = (pid) => db.select().from(schema.slots).where(eq(schema.slots.projectId, pid)).all().map((s) => [s.id, s.mediaId, s.position]);
const navIds = () => readPublishedSite().nav.flatMap((i) => (i.kind === "page" ? [i.pageId] : []));
const [P, Q] = db.select().from(schema.projects).all();

/* ---- 1. Correction I1 --------------------------------------------------------- */

await test("I1 : planche retirée (bloc supprimé) → surcouche jamais appliquée, images en ligne intactes", () => {
  const page = newPage("t-i1a");
  const before = JSON.stringify(slotsOf(Q.id));
  assert.equal(saveDraft(page, { ...base(page), blocks: [k("b", "project-board", { project: Q.slug })] }, rev(page)).ok, true);
  const first = db.select().from(schema.slots).where(eq(schema.slots.projectId, Q.id)).all()[0];
  assert.equal(boardOp(page, Q.id, { op: "retire", key: `s${first.id}` }, rev(page)).ok, true);
  assert.equal(saveDraft(page, { ...base(page), blocks: [] }, rev(page)).ok, true);
  assert.equal(publishDraft(page, rev(page)).ok, true);
  assert.equal(JSON.stringify(slotsOf(Q.id)), before);
  assert.equal(db.select().from(schema.slots).where(eq(schema.slots.draftPageId, page)).all().length, 0, "surcouche effacée");
});
await test("I1 : conteneur supprimé (planche héritée) → rien d'appliqué", () => {
  const page = newPage("t-i1b");
  const before = JSON.stringify(slotsOf(P.id));
  saveDraft(page, { ...base(page), blocks: [k("c", "featured-project", { project: P.slug, children: [k("g", "grid", { children: [k("b", "project-board")] })] })] }, rev(page));
  const first = db.select().from(schema.slots).where(eq(schema.slots.projectId, P.id)).all()[0];
  assert.equal(boardOp(page, P.id, { op: "retire", key: `s${first.id}` }, rev(page)).ok, true, "planche imbriquée modifiable depuis la toile");
  // Le conteneur garde le projet mais n'en montre plus la planche : pas affiché.
  saveDraft(page, { ...base(page), blocks: [k("c", "featured-project", { project: P.slug, children: [k("t", "section-title", { linked: true })] })] }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, true);
  assert.equal(JSON.stringify(slotsOf(P.id)), before);
});
await test("I1 : planche imbriquée présente → sa surcouche est appliquée", () => {
  const page = newPage("t-i1c");
  const count = slotsOf(P.id).length;
  saveDraft(page, { ...base(page), blocks: [k("c", "featured-project", { project: P.slug, children: [k("g", "grid", { children: [k("b", "project-board")] })] })] }, rev(page));
  const first = db.select().from(schema.slots).where(eq(schema.slots.projectId, P.id)).all()[0];
  boardOp(page, P.id, { op: "retire", key: `s${first.id}` }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, true);
  assert.equal(slotsOf(P.id).length, count - 1);
});
await test("I1 : clé inconnue dans les props (non publiée) n'ouvre pas l'application d'une surcouche", () => {
  const page = newPage("t-i1d");
  const before = JSON.stringify(slotsOf(Q.id));
  saveDraft(page, { ...base(page), blocks: [k("b", "project-board", { project: Q.slug })] }, rev(page));
  const first = db.select().from(schema.slots).where(eq(schema.slots.projectId, Q.id)).all()[0];
  boardOp(page, Q.id, { op: "retire", key: `s${first.id}` }, rev(page));
  // Une clé `children` glissée dans un bloc simple : refusée par la forme ; une clé
  // inconnue d'un Titre (« project ») est retirée par le schéma et ne compte pas.
  saveDraft(page, { ...base(page), blocks: [k("t", "section-title", { project: Q.slug })] }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, true);
  assert.equal(JSON.stringify(slotsOf(Q.id)), before);
});

/* ---- 2. Menu et brouillon de l'en-tête (scénarios D4–D12, E1–E2 de l'audit) ---- */

const A = newPage("t-nav-a");
const B = newPage("t-nav-b");
const C = newPage("t-nav-c");
const about = db.select().from(schema.pages).all().find((p) => p.slug.fr === "a-propos").id;
await test("D4–D5 page mise au menu depuis la liste pendant un brouillon d'en-tête : reportée dans le brouillon", () => {
  const pub = readPublishedSite();
  assert.equal(saveSiteDraft(A, { ...pub, identity: { ...pub.identity, name: "Nom brouillon" } }, rev(A)).ok, true);
  assert.equal(setInMenu(B, true).ok, true);
  assert.ok(navIds().includes(B), "menu publié");
  assert.ok(readSiteDraft().snap.nav.some((i) => i.kind === "page" && i.pageId === B), "brouillon de l'en-tête");
});
await test("D6 page supprimée : retirée du menu publié ET du brouillon de l'en-tête", () => {
  assert.equal(deletePage(about).ok, true);
  assert.ok(!navIds().includes(about));
  assert.ok(!readSiteDraft().snap.nav.some((i) => i.kind === "page" && i.pageId === about));
});
await test("D7–D10 publier l'en-tête : la page supprimée ne revient pas, la page ajoutée ailleurs reste", () => {
  assert.equal(publishDraft(A, rev(A)).ok, true);
  assert.ok(!navIds().includes(about));
  assert.ok(navIds().includes(B));
  assert.equal(db.select({ n: schema.pages.navOrder }).from(schema.pages).where(eq(schema.pages.id, B)).get().n !== null, true);
  assert.equal(readPublishedSite().identity.name, "Nom brouillon");
});
await test("D11–D12 l'éditeur n'est jamais bloqué : une page disparue est retirée en silence", () => {
  const pub = readPublishedSite();
  const res = saveSiteDraft(A, { ...pub, nav: [...pub.nav, { kind: "page", pageId: 99999 }], identity: { ...pub.identity, name: "Encore" } }, rev(A));
  assert.equal(res.ok, true);
  assert.ok(!readSiteDraft().snap.nav.some((i) => i.kind === "page" && i.pageId === 99999));
  assert.ok(siteForEditor(A).snap.nav.every((i) => i.kind !== "page" || i.pageId !== 99999));
  discardDraft(A, rev(A));
});
await test("ordre du menu changé depuis la liste pendant un brouillon d'en-tête : reporté", () => {
  const pub = readPublishedSite();
  saveSiteDraft(C, { ...pub, identity: { ...pub.identity, name: "C" } }, rev(C));
  const pages = navIds();
  const reversed = [...pages].reverse();
  assert.equal(reorderMenu(reversed).ok, true);
  assert.deepEqual(readSiteDraft().snap.nav.flatMap((i) => (i.kind === "page" ? [i.pageId] : [])), reversed);
  publishDraft(C, rev(C));
  assert.deepEqual(navIds(), reversed);
});
await test("E1–E2 case « dans le menu » cochée dans le brouillon de la page + en-tête modifié : la page entre au menu", () => {
  const pub = readPublishedSite();
  saveDraft(A, { ...base(A), published: true, inMenu: true, blocks: [] }, rev(A));
  saveSiteDraft(A, { ...pub, identity: { ...pub.identity, name: "X" } }, rev(A));
  assert.equal(publishDraft(A, rev(A)).ok, true);
  assert.ok(navIds().includes(A));
});
await test("retirer une page par l'en-tête n'est pas défait à la publication suivante d'une autre page", () => {
  saveDraft(B, { ...base(B), blocks: [] }, rev(B));
  assert.equal(base(B).inMenu, true);
  const pub = readPublishedSite();
  saveSiteDraft(C, { ...pub, nav: pub.nav.filter((i) => !(i.kind === "page" && i.pageId === B)) }, rev(C));
  publishDraft(C, rev(C));
  assert.ok(!navIds().includes(B));
  assert.equal(base(B).inMenu, false, "le brouillon de B a suivi");
  publishDraft(B, rev(B));
  assert.ok(!navIds().includes(B));
});

await test("G1–G8 éditeur resté ouvert : un changement du menu fait ailleurs rend son instantané périmé (conflit), B reste au menu", () => {
  const GA = newPage("t-g-a");
  const GB = newPage("t-g-b");
  saveDraft(GB, { ...base(GB), published: true, blocks: [] }, rev(GB));
  publishDraft(GB, rev(GB));
  const snap = siteForEditor(GA).snap;
  const r1 = saveSiteDraft(GA, { ...snap, identity: { ...snap.identity, name: "N1" } }, rev(GA));
  assert.equal(r1.ok, true);
  const { after, rev: revA } = r1.data;
  assert.equal(setInMenu(GB, true).ok, true);
  assert.ok(readSiteDraft().snap.nav.some((i) => i.kind === "page" && i.pageId === GB), "reporté dans le brouillon");
  assert.equal(rev(GA), revA + 1, "version de la page porteuse incrémentée");
  const stale = saveSiteDraft(GA, { ...after, identity: { ...after.identity, name: "N2" } }, revA);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "conflict", "l'éditeur périmé reçoit « Modifié ailleurs »");
  assert.equal(publishDraft(GA, rev(GA)).ok, true);
  assert.ok(navIds().includes(GB), "B toujours au menu après la publication");
});

/* ---- 3. POST /api/contact ------------------------------------------------------ */

const F = newPage("t-form");
const form = withFreshUids({ uid: "", type: "contact-form", props: defaultContactForm() }, () => "fx");
saveDraft(F, { ...base(F), published: true, blocks: [{ ...form, uid: "f1" }] }, rev(F));
assert.equal(publishDraft(F, rev(F)).ok, true);
const formId = form.props.formId;
const send = async (body, headers = {}) => {
  const res = await POST(new Request("http://localhost/api/contact", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
  return res.status;
};
const ok = { form: formId, locale: "fr", values: { fname: "Lou", femail: "a@b.fr", fmessage: "salut" } };
await test("contact : XFF dont la partie gauche tourne = même client réel → 429 au 6e (AUTH_TRUSTED_PROXY_HOPS=1)", async () => {
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push(await send(ok, { "x-forwarded-for": `10.9.${i}.1, 198.51.100.7` }));
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
  assert.equal(await send(ok, { "x-forwarded-for": "10.9.9.9, 198.51.100.8" }), 200, "un autre client n'est pas bloqué");
});
await test("contact : identifiant stable — après une republication, le formulaire répond toujours", async () => {
  saveDraft(F, { ...base(F), title: L("t-form bis") }, rev(F));
  assert.equal(publishDraft(F, rev(F)).ok, true);
  assert.equal(await send(ok, { "x-forwarded-for": "198.51.100.20" }), 200);
  assert.equal(await send({ ...ok, form: "inconnu123" }, { "x-forwarded-for": "198.51.100.21" }), 404);
});
await test("formId en double : refusé au brouillon et à la publication (même page, autre page publiée)", () => {
  const G = newPage("t-form-dup");
  const r1 = saveDraft(G, { ...base(G), published: true, blocks: [{ ...form, uid: "c1" }] }, rev(G));
  assert.equal(r1.ok, false, "même identifiant qu'un formulaire publié d'une autre page (brouillon)");
  assert.match(r1.message, /autre page/);
  const other = withFreshUids({ uid: "", type: "contact-form", props: defaultContactForm() }, () => "gx");
  const r2 = saveDraft(G, { ...base(G), published: true, blocks: [{ ...other, uid: "c1" }, { ...other, uid: "c2" }] }, rev(G));
  assert.equal(r2.ok, false, "deux fois le même identifiant sur la page");
  assert.match(r2.message, /même identifiant/);
  // Publication : le contrôle tient aussi dans la transaction (brouillon écrit sans passer par saveDraft).
  db.update(schema.pages).set({ draft: { ...base(G), published: true, blocks: [{ ...form, uid: "c1" }] } }).where(eq(schema.pages.id, G)).run();
  const pub = publishDraft(G, rev(G));
  assert.equal(pub.ok, false);
  assert.ok(Object.values(pub.fieldErrors ?? {}).some((m) => /autre page/.test(m)), JSON.stringify(pub.fieldErrors));
  assert.equal(saveDraft(G, { ...base(G), blocks: [{ ...other, uid: "c1" }] }, rev(G)).ok, true, "un identifiant neuf passe");
});
await test("contact : Content-Length trop grand → 413 sans lecture ; corps énorme sans longueur (flux) → 413, RSS stable", async () => {
  assert.equal(await send(JSON.stringify(ok), { "content-length": String(10 * 1024 * 1024) }), 413);
  const chunk = new TextEncoder().encode("a".repeat(64 * 1024));
  let sent = 0;
  const stream = new ReadableStream({
    pull(c) {
      if (sent++ > 400) c.close(); // ~25 Mo si tout était lu
      else c.enqueue(chunk);
    },
  });
  const rss0 = process.memoryUsage().rss;
  const res = await POST(new Request("http://localhost/api/contact", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: stream, duplex: "half" }));
  assert.equal(res.status, 413);
  assert.ok(sent < 5, `lecture coupée tôt (${sent} morceaux lus)`);
  assert.ok(process.memoryUsage().rss - rss0 < 20e6, "RSS stable");
});

console.log(`\n${passed} test(s) OK`);
rmSync(dir, { recursive: true, force: true });
process.exit(0);
