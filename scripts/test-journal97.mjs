#!/usr/bin/env node
/**
 * Lot 97 « journal d'édition » : tests UNITAIRES (sans serveur), données synthétiques.
 *  - summary : masquage des secrets (e-mail, jeton, data:, suite opaque), valeurs à 80 caractères, différences par chemin, blocs par uid.
 *  - human : phrases lisibles par une non-développeuse.
 *  - store : écriture, filtres, rétention (lignes ET jours), purge automatique.
 *  - audit : enveloppe d'action (ok, refus, conflit, erreur, redirection, accès refusé), jamais de secret dans la table ni sur stdout, coût.
 *  - client : événements du navigateur validés, masqués, limités.
 *  - inventaire STATIQUE : toute server action d'écriture est enveloppée (audited) ou déclarée en lecture ; chaque nom est au catalogue.
 * Usage : node --import tsx scripts/test-journal97.mjs   (inclus dans npm test)
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(process.env.TEST_TMP ?? tmpdir(), "pf-journal97-"));
process.env.DATA_DIR = tmp;
process.env.PORTFOLIO_VERSION = "9.9.9-test";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${String(detail).slice(0, 600)}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label} : ${typeof v === "string" ? v : JSON.stringify(v)}`);

const { diffPaths, flattenValues, redact, shortValue, safeMessage } = await import("../src/lib/journal/summary.ts");
const { describeChanges, sentence, subjectOf } = await import("../src/lib/journal/human.ts");
const store = await import("../src/lib/journal/store.ts");
const { audited, auditedRoute, flushAudit } = await import("../src/lib/journal/audit.ts");
const { noteAuditUser } = await import("../src/lib/journal/context.ts");
const { SPECS } = await import("../src/lib/journal/catalog.ts");
const client = await import("../src/lib/journal/client-events.ts");

/* ---- summary ------------------------------------------------------------------------------------------------------------- */
const SECRETS = ["camille.synthetique@exemple.test", "sk-abcdefghijklmnop0123456789", "Bearer abcdef0123456789abcdef", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ", "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3A"];
for (const s of SECRETS.slice(0, 4)) ok(`redact masque « ${s.slice(0, 20)}… »`, !redact(`voici ${s} fin`).includes(s.slice(0, 18)), redact(s));
ok("redact : suite opaque seule masquée", redact(SECRETS[4]) === "[masqué]", redact(SECRETS[4]));
ok("redact : texte ordinaire intact", redact("Mon beau portfolio, été 2026") === "Mon beau portfolio, été 2026");
ok("shortValue tronque à 80 caractères", shortValue("é".repeat(200)).length === 80 && shortValue("é".repeat(200)).endsWith("…"));
ok("shortValue : e-mail masqué avant la troncature", shortValue(`écrire à ${SECRETS[0]}`) === "écrire à [e-mail]");
const d1 = diffPaths({ title: { fr: "A", en: "A" }, blocks: [{ uid: "b1", type: "hero", props: { name: "Ancien", email: "x@y.zz" } }, { uid: "b2", type: "rich-text", props: { t: "1" } }] }, { title: { fr: "B", en: "A" }, blocks: [{ uid: "b1", type: "hero", props: { name: "Nouveau", email: "a@b.cc" } }, { uid: "b3", type: "image", props: {} }] });
const paths1 = d1.changes.map((c) => c.p);
ok("diffPaths : champ simple", paths1.includes("title.fr") && !paths1.includes("title.en"), paths1.join());
ok("diffPaths : blocs reconnus par uid (modifié, ajouté, retiré)", paths1.includes("blocks[hero:b1].props.name") && paths1.includes("blocks[image:b3]") && paths1.includes("blocks[rich-text:b2]"), paths1.join());
const mail = d1.changes.find((c) => c.p.endsWith("email"));
ok("diffPaths : la valeur d'une clé « email » est masquée, le chemin reste", mail && mail.a === "[masqué]" && mail.b === "[masqué]", JSON.stringify(mail));
const big = diffPaths({ a: "x" }, { a: "y".repeat(500) });
ok("diffPaths : valeur longue tronquée à 80", big.changes[0].b.length <= 80);
ok("diffPaths : rien ne change = aucun chemin", diffPaths({ a: [1, 2] }, { a: [1, 2] }).total === 0);
const fl = flattenValues({ name: "Camille", password: "hunter2", nested: { token: "abc", note: "ok" }, tags: ["a", "b"] });
ok("flattenValues : mot de passe et jeton masqués", fl.find((c) => c.p === "password").b === "[masqué]" && fl.find((c) => c.p === "nested.token").b === "[masqué]" && fl.find((c) => c.p === "nested.note").b === "ok");
ok("safeMessage masque les e-mails", !safeMessage(`échec pour ${SECRETS[0]}`).includes("@"));

/* ---- human --------------------------------------------------------------------------------------------------------------- */
ok("phrase : Nom du site modifié depuis la page Décors : brouillon", sentence({ what: describeChanges([{ p: "identity.name.fr", a: "A", b: "B" }]), page: "Décors", state: "brouillon", result: "ok" }) === "Nom du site modifié depuis la page Décors : brouillon", sentence({ what: describeChanges([{ p: "identity.name.fr" }]), page: "Décors", state: "brouillon", result: "ok" }));
ok("accord au féminin", describeChanges([{ p: "slug.fr" }]) === "Adresse de la page modifiée");
ok("plusieurs champs, pluriel", describeChanges([{ p: "title.fr" }, { p: "slug.fr" }]) === "Titre de la page, Adresse de la page modifiés");
ok("bloc : nom français du type", subjectOf("blocks[hero:b1].props.name").label === "Bloc « Ouverture »");
ok("conflit : phrase explicite", /refusé, la page avait été modifiée ailleurs/.test(sentence({ what: "Brouillon modifié", page: "X", state: "brouillon", result: "conflit" })));

/* ---- store : écriture, filtres, rétention ------------------------------------------------------------------------------------ */
const base = { kind: "action", action: "t", type: "modification", user: "u1", pageId: 1, page: "Accueil", target: null, revFrom: 1, revTo: 2, result: "ok", ms: 1.234, version: "9.9.9-test", label: "essai", summary: { changes: [], total: 0 } };
const t0 = Date.now();
store.writeEntry({ ...base, label: "vieux" }, t0 - 40 * 86_400_000);
store.writeEntry({ ...base, label: "récent", type: "publication", result: "conflit", pageId: 2, page: "Décors" }, t0 - 1000);
ok("purge par ancienneté (30 jours)", store.purgeLog(t0) === 1 && store.listEntries().total === 1);
ok("filtres : type, résultat, page", store.listEntries({ type: "publication" }).total === 1 && store.listEntries({ result: "ok" }).total === 0 && store.listEntries({ pageId: 2 }).total === 1 && store.listEntries({ pageId: 1 }).total === 0);
ok("filtre de dates", store.listEntries({ from: t0 - 5000, to: t0 }).total === 1 && store.listEntries({ from: t0 + 1 }).total === 0);
for (let i = 0; i < 300; i++) store.writeEntry({ ...base, label: `ligne ${i}` }, t0);
ok("purge par nombre de lignes (garde les plus récentes)", store.purgeLog(t0, { rows: 100 }) === 201 && store.listEntries().total === 100 && store.listEntries({}, 1).rows[0].label === "ligne 299");
ok("facettes : pages et types", store.facets().pages.length >= 1 && store.facets().types.includes("modification"));
ok("la rétention par défaut est 30 jours / 20 000 lignes", store.MAX_DAYS === 30 && store.MAX_ROWS === 20000);
// Purge automatique : toutes les 500 écritures, sans appel explicite (limite abaissée par l'environnement).
process.env.EDIT_LOG_MAX_ROWS = "50";
for (let i = 0; i < 600; i++) store.writeEntry({ ...base, label: `auto ${i}` }, Date.now());
// 100 lignes avant, 600 écrites : sans purge il y en aurait 700 ; la purge tombe à la 500ᵉ écriture du processus et ne garde que 50 lignes + les écritures suivantes.
const afterAuto = store.listEntries().total;
ok("purge automatique pendant les écritures (limite 50 lignes, sans appel explicite)", afterAuto < 700 && afterAuto >= 50, String(afterAuto));
delete process.env.EDIT_LOG_MAX_ROWS;
store.purgeLog(Date.now(), { rows: 0 });
ok("le fichier du journal est à part (edit-log.db), portfolio.db n'est pas créé par lui", readdirSync(tmp).includes("edit-log.db") && !readdirSync(tmp).includes("portfolio.db"), readdirSync(tmp).join());

/* ---- audit : enveloppe -------------------------------------------------------------------------------------------------------- */
const lines = [];
const origLog = console.log;
console.log = (...a) => (typeof a[0] === "string" && a[0].startsWith('{"t":') ? lines.push(a[0]) : origLog(...a));
const SECRET_ARGS = { email: SECRETS[0], password: "hunter2-synthetique", token: SECRETS[1], note: "texte public", image: SECRETS[3] };
const act = (fn) => audited("reorderMenuAction", fn);
const okAct = act(async function reorderMenuAction(input) {
  noteAuditUser("user-interne-1");
  return { ok: true, data: null, input };
});
await okAct(SECRET_ARGS);
await act(async function reorderMenuAction() { return { ok: false, message: `Refus pour ${SECRETS[0]}` }; })(1);
await audited("saveDraftAction", async function saveDraftAction() { return { ok: false, message: "Cette page a été modifiée ailleurs.", code: "conflict", rev: 7 }; })(null, {}, 3);
let thrown = null;
try {
  await act(async function reorderMenuAction() { throw new Error(`boum ${SECRETS[1]} ${SECRETS[0]}`); })();
} catch (e) {
  thrown = e;
}
ok("une exception de l'action est relancée telle quelle", thrown && /boum/.test(thrown.message));
await act(async function reorderMenuAction() { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/admin/connexion;307;" }); })().catch(() => {});
await act(async function reorderMenuAction() { throw Object.assign(new Error("forbidden"), { digest: "NEXT_HTTP_ERROR_FALLBACK;403" }); })().catch(() => {});
await auditedRoute("upload", async function POST() { return new Response(JSON.stringify({ ok: false, message: "Fichier trop gros." }), { status: 413, headers: { "content-type": "application/json" } }); })(new Request("http://localhost/admin/api/upload?x=1", { method: "POST" }));
await flushAudit();
console.log = origLog;
const rows = store.listEntries({}, 20).rows.reverse();
const byAction = (a, r) => rows.find((x) => x.action === a && (!r || x.result === r));
ok("ok : entrée avec utilisateur interne, type, version de l'application", byAction("reorderMenuAction", "ok")?.user === "user-interne-1" && byAction("reorderMenuAction", "ok").version === "9.9.9-test" && byAction("reorderMenuAction", "ok").type === "modification");
ok("refus : résultat « refus » avec la raison", byAction("reorderMenuAction", "refus")?.label.includes("refusé"));
const conf = byAction("saveDraftAction", "conflit");
ok("conflit : résultat « conflit », version avant → après", conf && conf.revFrom === 3 && conf.revTo === 7 && /refusé, la page avait été modifiée ailleurs/.test(conf.label), JSON.stringify(conf));
ok("erreur : résultat « erreur »", rows.some((x) => x.result === "erreur" && x.action === "reorderMenuAction"));
ok("redirection : pas une panne (ok) ; accès refusé : refus", rows.filter((x) => x.action === "reorderMenuAction").some((x) => x.result === "ok" && /redirection/.test(JSON.stringify(x.summary))) && rows.some((x) => /accès refusé/.test(x.label)));
const route = byAction("route:upload");
ok("route : résultat d'après le statut HTTP, chemin sans requête", route?.result === "refus" && /POST \/admin\/api\/upload"/.test(JSON.stringify(route.summary)) && !JSON.stringify(route.summary).includes("x=1") && /Fichier trop gros/.test(JSON.stringify(route.summary)), JSON.stringify(route));
ok("durée mesurée (ms) sur chaque entrée", rows.every((x) => typeof x.ms === "number"));
const dump = JSON.stringify(store.listEntries({}, 1000).rows) + lines.join("\n");
const leaks = [...SECRETS, "hunter2"].filter((s) => dump.includes(s.slice(0, 22)));
ok("aucun secret (e-mail, jeton, mot de passe, data:) dans la table ni sur stdout", leaks.length === 0, leaks.join(" | "));
const edit = lines.map((l) => JSON.parse(l)).filter((l) => l.t === "edit");
ok("stdout : une ligne JSON {\"t\":\"edit\"} par écriture", edit.length === 7 && lines.every((l) => l.length < 400), `${edit.length} lignes`);
ok("stdout : porte action, résultat, version, durée, coût du journal (chemin de la requête et différé)", edit.every((l) => l.a && l.r && l.v === "9.9.9-test" && typeof l.ms === "number" && typeof l.aud === "number" && typeof l.bg === "number"), lines[0]);
// Coût : enveloppe seule (action vide), 1 000 appels. Chemin de la requête = ce que l'artiste attend ; total = avec l'écriture différée.
console.log = () => {};
const noop = audited("reorderMenuAction", async function reorderMenuAction() { return { ok: true, data: null }; });
const b0 = performance.now();
for (let i = 0; i < 1000; i++) await noop(i);
const requestPath = (performance.now() - b0) / 1000;
await flushAudit();
const total = (performance.now() - b0) / 1000;
console.log = origLog;
info("coût moyen de l'enveloppe (action vide, 1 000 appels)", `chemin de la requête ${requestPath.toFixed(3)} ms, avec l'écriture SQLite différée ${total.toFixed(3)} ms`);
ok("coût de l'enveloppe sur le chemin de la requête < 2 ms par action (et total < 2 ms)", requestPath < 2 && total < 2, `${requestPath} / ${total} ms`);
ok("les 1 000 entrées différées sont bien écrites", store.listEntries({ type: "modification" }, 1).total >= 1000);

/* ---- événements du navigateur ------------------------------------------------------------------------------------------------------ */
console.log = (...a) => (typeof a[0] === "string" && a[0].startsWith('{"t":') ? lines.push(a[0]) : origLog(...a));
ok("événement invalide refusé (forme, genre inconnu, sans message)", !client.ingestClientEvent("u", null) && !client.ingestClientEvent("u", { kind: "x", message: "a" }) && !client.ingestClientEvent("u", { kind: "error" }));
ok("erreur JS enregistrée", client.ingestClientEvent("user-interne-1", { kind: "error", message: `Boum ${SECRETS[0]} ${SECRETS[1]}`, stack: "at x (http://localhost/_next/a.js?v=1:1:1)", path: "/admin/pages/3/editer?langue=fr", clientVersion: "0.31.1", line: 12 }));
ok("échec d'enregistrement (conflit) enregistré avec son résultat", client.ingestClientEvent("user-interne-1", { kind: "save", reason: "conflit", action: "saveDraftAction", message: "Page modifiée ailleurs", path: "/admin/pages/3/editer", clientVersion: "9.9.9-test" }));
console.log = origLog;
const cl = store.listEntries({ kind: "client" }, 10).rows;
ok("événements : type « erreur », version du client, chemin sans requête", cl.length === 2 && cl.every((x) => x.type === "erreur" && x.kind === "client") && cl.some((x) => x.version === "0.31.1") && !JSON.stringify(cl).includes("langue=fr"), JSON.stringify(cl).slice(0, 300));
ok("événements : secrets masqués", !JSON.stringify(cl).includes("camille.synthetique") && !JSON.stringify(cl).includes("sk-abcdefghijklmnop"));
ok("événement de sauvegarde : résultat « conflit »", cl.some((x) => x.result === "conflit"));
client.resetClientLimit();
let allowed = 0;
for (let i = 0; i < 100; i++) if (client.allowClientEvent("spam", 1000)) allowed++;
ok("limite de débit : 40 événements par minute et par utilisateur", allowed === 40, String(allowed));
ok("limite de débit : la minute suivante repart", client.allowClientEvent("spam", 62_000));
ok("taille bornée (8 Ko)", client.MAX_BODY_BYTES === 8192);

/* ---- inventaire statique ------------------------------------------------------------------------------------------------------------ */
const READS = new Set(["frameUsesAction", "listFramesAction", "mediaStatusAction", "backfillTakenAction", "mediaUsesAction", "pendingUploadsAction", "listTagsAction", "wallpaperUsesAction", "listWallpapersAction", "previewFaviconAction", "backupStatusAction"]);
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
const wrapped = new Set();
const bare = [];
const routes = new Set();
for (const file of walk(path.join(ROOT, "src/app/admin"))) {
  const src = readFileSync(file, "utf8");
  if (/^\s*["']use server["']/.test(src)) {
    for (const m of src.matchAll(/export\s+const\s+(\w+)\s*=\s*audited\(\s*"(\w+)"/g)) { wrapped.add(m[2]); if (m[1] !== m[2]) bare.push(`${m[1]} ≠ ${m[2]}`); }
    for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)/g)) if (!READS.has(m[1])) bare.push(m[1]);
  }
  if (/\/route\.ts$/.test(file)) {
    for (const m of src.matchAll(/export\s+const\s+(POST|PUT|PATCH|DELETE)\s*=\s*auditedRoute\(\s*"([\w-]+)"/g)) routes.add(`route:${m[2]}`);
    for (const m of src.matchAll(/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/g)) {
      // Écritures sans journal : seulement celles déclarées ici (aperçu : cookies de vue, envoi par morceaux : une entrée à la fin, police récente : préférence).
      const allowed = ["apercu/route.ts", "apercu/quitter/route.ts", "upload/init/route.ts", "chunk/route.ts", "fonts/recent/route.ts", "theme-kit/[id]/route.ts"];
      if (!allowed.some((a) => file.endsWith(a))) bare.push(`${path.relative(ROOT, file)} ${m[1]}`);
    }
  }
}
ok("toute server action d'écriture est enveloppée (audited) ou déclarée en lecture", bare.length === 0, bare.join(", "));
ok("74 actions enveloppées au moins (inventaire non vide)", wrapped.size >= 70, String(wrapped.size));
const missing = [...wrapped, ...routes].filter((n) => !SPECS[n]);
ok("chaque action et route enveloppée a une entrée au catalogue (libellé, type)", missing.length === 0, missing.join(", "));
const stale = Object.keys(SPECS).filter((n) => !wrapped.has(n) && !routes.has(n));
ok("le catalogue ne cite aucune action disparue", stale.length === 0, stale.join(", "));
ok("lecture : aucune lecture n'est enveloppée", [...READS].every((n) => !wrapped.has(n)));

store.closeLog();
rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `${failures} échec(s)` : "Tout est vert");
process.exit(failures ? 1 : 0);
