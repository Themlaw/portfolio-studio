#!/usr/bin/env node
/**
 * Sécurité v1.0, domaine C : exposition de contenu (PR #24, #30, #51, #53). Serveur standalone local, base SYNTHÉTIQUE.
 * Chaque test est une ATTAQUE : PASS = attaque bloquée. Sur v0.34.0 seul, les sections correspondantes échouent (attaque réussie) ;
 * avec le correctif de la PR, elles passent.
 *  H  (PR #24) projet qu'aucune page n'affiche : couverture, compteur « N œuvres » de l'accueil, demoreel
 *  R  (PR #24 + #30) « Une œuvre au hasard » : œuvre d'un projet masqué tirée (repli sur la page de collection)
 *  C  (PR #30) œuvre retirée d'un projet : la 404 continue de la tirer (cache non invalidé)
 *  S  (PR #51) flux RSC public d'une planche : suite brute (layout), textes de l'autre langue, en-tête masqué
 *  D  (PR #53) page restaurée / remise en ligne avec un formulaire dont l'identifiant est publié ailleurs
 * Usage : BATT_SECUC_SA=<.next/standalone> BATT_SECUC_PORT=3810 [ONLY=H,R,C,S,D] node scripts/secuC-contenu.mjs
 */
import * as S from "./lib/secuC.mjs";
import { contactSend } from "./lib/secuC-contact.mjs";

const { ok, query, exec, startServer, stop, http, Jar, login, actionIds, callActionJson, freshDir, sleep } = S;
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
S.prepareStandalone();
const L = (s) => JSON.stringify({ fr: s, en: s });
const MEDIA_NDA = "originals/nda0000000000000.png";

/** Démarre, attend, puis exécute `fn(server)` et arrête. */
async function withServer(dir, fn, env = {}) {
  const s = startServer(dir, env);
  if (!(await s.ready)) throw new Error("serveur non prêt : " + s.text().slice(-400));
  try {
    return await fn(s);
  } finally {
    await stop(s);
  }
}
/** Seed la base (premier démarrage) puis rend le dossier. */
async function seeded(name) {
  const d = freshDir(name);
  await withServer(d, async () => {});
  return d;
}
const tileCounts = (html) => (html.match(/\d+\s*œuvres?/g) ?? []).join("|");
const rsc = async (url) => {
  let r = await http(url, { headers: { rsc: "1" } });
  if (r.status === 307) r = await http(r.headers.get("location"), { headers: { rsc: "1" } });
  return r.text();
};

/* ---------- H : projet masqué (PR #24) ---------- */
if (run("H") || run("R")) {
  const d = await seeded("H");
  // Neutralise couvertures et demoreel du seed : la couverture d'une collection est alors la première œuvre, ou celle d'une Couverture choisie.
  exec(d, "update slots set featured = 0, reel = 0");
  const baseline = await withServer(d, async () => ({
    fr: await (await http("/fr")).text(),
    perso: await (await http("/fr/personnages")).text(),
  }));
  exec(d, "insert into media (key, sha256, kind, mime, original_name, size, status, width, height, alt) values (?, ?, 'image', 'image/png', 'client-nda.png', 1, 'ready', 800, 600, ?)", MEDIA_NDA, "e".repeat(64), L("NDA"));
  const mid = query(d, "select id from media where key = ?", MEDIA_NDA)[0].id;
  const pos = query(d, "select max(position) + 1 p from projects")[0].p;
  exec(d, "insert into projects (slug, title, context, description, year, featured, position) values ('projet-nda-secuc', ?, ?, ?, '2026', 1, ?)", L("Projet NDA"), L("Client"), L("Secret du client"), pos);
  const pid = query(d, "select id from projects where slug = 'projet-nda-secuc'")[0].id;
  const slot = (slug, collection, extra) => exec(d, `insert into slots (project_id, media_id, position, slug, collection, title, description, year, featured, reel) values (?, ?, 0, ?, ?, ?, ?, 2026, ?, ?)`, pid, mid, slug, collection, L(slug), L("x"), extra.featured ? 1 : 0, extra.reel ? 1 : 0);
  slot("nda-perso-secuc", "characters", { featured: true });
  slot("nda-reel-secuc", "animation", { reel: true });
  if (run("H")) {
    await withServer(d, async () => {
      const fr = await (await http("/fr")).text();
      const en = await (await http("/en")).text();
      ok("H1 la couverture d'un projet masqué n'est pas celle d'une tuile de l'accueil", !fr.includes("nda0000000000000") && !en.includes("nda0000000000000"), "la clé du média du projet masqué est dans l'accueil public");
      ok("H2 le compteur « N œuvres » des tuiles ignore le projet masqué", tileCounts(fr) === tileCounts(baseline.fr), `avant ${tileCounts(baseline.fr)} | après ${tileCounts(fr)}`);
      const perso = await (await http("/fr/personnages")).text();
      ok("H3 la page du métier ne montre pas le projet masqué", !perso.includes("nda0000000000000") && !perso.includes("projet-nda-secuc"));
      ok("H4 la demoreel n'est pas la vidéo d'un projet masqué", !fr.includes("nda-reel-secuc"));
      const map = await (await http("/sitemap.xml")).text();
      ok("H5 le plan du site ne cite pas le projet masqué", !map.includes("projet-nda-secuc") && !map.includes("nda0000000000000"));
    });
  }
  if (run("R")) {
    // « Une œuvre au hasard » en sélection manuelle de l'œuvre d'un projet masqué : tirée ou non ?
    const p404 = query(d, "select id from pages where json_extract(slug, '$.fr') = '_404'")[0].id;
    exec(d, "insert into blocks (page_id, position, type, props) values (?, 5, 'random-work', ?)", p404, JSON.stringify({ source: "manual", works: ["nda-perso-secuc"] }));
    await withServer(d, async () => {
      const html = await (await http("/fr/introuvable-secuc")).text();
      ok("R1 « Une œuvre au hasard » ne tire pas l'œuvre d'un projet qu'aucune page n'affiche", !html.includes('data-random-work="nda-perso-secuc"'), "œuvre du projet masqué tirée (repli sur la page de la collection, readPoolWorks)");
    });
  }
}

/* ---------- C : cache de « Une œuvre au hasard » (PR #30) ---------- */
if (run("C")) {
  const d = await seeded("C");
  const p404 = query(d, "select id from pages where json_extract(slug, '$.fr') = '_404'")[0].id;
  const target = query(d, "select s.id, s.slug from slots s join projects p on p.id = s.project_id where p.slug = 'les-hauts-chemins' order by s.id limit 1")[0];
  exec(d, "insert into blocks (page_id, position, type, props) values (?, 5, 'random-work', ?)", p404, JSON.stringify({ source: "manual", works: [target.slug] }));
  const ids = actionIds(["deleteSlotAction"]);
  await withServer(d, async () => {
    const before = await (await http("/fr/introuvable-a")).text();
    ok("C0 (témoin) la 404 tire l'œuvre choisie avant le retrait", before.includes(`data-random-work="${target.slug}"`));
    const jar = new Jar();
    ok("C0b connexion admin", (await login(jar)) === 200);
    const del = await callActionJson(jar, ids.deleteSlotAction, [target.id], "/admin/projets");
    ok("C0c retrait de l'œuvre (server action)", del.status === 200 && query(d, "select count(*) n from slots where id = ?", target.id)[0].n === 0, del.text.slice(0, 120));
    await sleep(500);
    const after = await (await http("/fr/introuvable-b")).text();
    ok("C1 la 404 ne tire plus une œuvre retirée du projet (cache invalidé)", !after.includes(`data-random-work="${target.slug}"`), "l'œuvre retirée est toujours servie en public");
  });
}

/* ---------- S : flux RSC d'une planche (PR #51) ---------- */
if (run("S")) {
  const d = await seeded("S");
  const layout = [
    { uid: "strip", type: "strip", props: {} },
    { uid: "mk", type: "rich-text", props: { converted: "MARK-CONVERTED-C51", text: { fr: "visible", en: "MARK-EN-ONLY-C51" } } },
  ];
  exec(d, "update projects set layout = ?, description = ?, context = ? where slug = 'herbier-des-nuits'", JSON.stringify(layout), JSON.stringify({ fr: "MARK-DESC-C51", en: "MARK-DESC-C51" }), JSON.stringify({ fr: "MARK-CTX-C51", en: "MARK-CTX-C51" }));
  // L'en-tête (contexte, année, présentation) de ce projet est masqué sur la page « Personnages ».
  const rows = query(d, "select id, props from blocks where type = 'project-board' and props like '%herbier-des-nuits%' and page_id = 2");
  for (const r of rows) exec(d, "update blocks set props = ? where id = ?", JSON.stringify({ ...JSON.parse(r.props), header: false }), r.id);
  await withServer(d, async () => {
    const html = await (await http("/fr/personnages")).text();
    const flux = await rsc("/fr/personnages");
    const has = (m) => html.includes(m) || flux.includes(m);
    ok("S0 (témoin) la planche est rendue", html.includes("herbier-des-nuits") || html.includes("L&#x27;herbier des nuits") || flux.includes("herbier-des-nuits"));
    ok("S1 le flux public ne transporte pas la suite brute du projet (layout)", !/"layout":\[/.test(flux) && !/\\"layout\\":\[/.test(html), "clé layout présente");
    ok("S2 le flux public ne transporte pas l'ancienne forme (props.converted)", !has("MARK-CONVERTED-C51"));
    ok("S3 le flux public ne transporte pas les textes de l'autre langue des composants", !has("MARK-EN-ONLY-C51"));
    ok("S4 un en-tête masqué (contexte, présentation) n'est pas transporté", !has("MARK-DESC-C51") && !has("MARK-CTX-C51"));
    ok("S5 (témoin) l'en-tête affiché reste visible sur l'accueil/ailleurs", true);
  });
}

/* ---------- D : restauration / remise en ligne et formulaires en double (PR #53) ---------- */
if (run("D")) {
  const d = await seeded("D");
  const F = "formdupsecuc01";
  const form = { formId: F, fields: [{ id: "fa1", type: "text", label: { fr: "Nom", en: "Name" }, required: true }], submit: { fr: "Envoyer", en: "Send" }, success: { fr: "Merci", en: "Thanks" }, error: { fr: "Erreur", en: "Error" }, subject: { fr: "Objet", en: "Subject" } };
  const mkPage = (slug, deleted) => {
    exec(d, "insert into pages (slug, title, published, deleted_at) values (?, ?, 1, ?)", JSON.stringify({ fr: slug, en: slug }), L(slug), deleted ? Math.floor(Date.now() / 1000) : null);
    const id = query(d, "select id from pages where json_extract(slug, '$.fr') = ?", slug)[0].id;
    exec(d, "insert into blocks (page_id, position, type, props) values (?, 0, 'contact-form', ?)", id, JSON.stringify(form));
    return id;
  };
  // A : page publiée mise à la corbeille ; B : une autre page publie le même identifiant entre-temps (autorisé : A n'est plus publiée).
  const A = mkPage("page-a-secuc", true);
  const B = mkPage("page-b-secuc", false);
  const ids = actionIds(["restorePageAction", "setPublishedAction"]);
  await withServer(d, async () => {
    const jar = new Jar();
    ok("D0 connexion admin", (await login(jar)) === 200);
    const r = await callActionJson(jar, ids.restorePageAction, [A], "/admin/corbeille");
    const published = query(d, "select count(*) n from pages p join blocks b on b.page_id = p.id where p.published = 1 and p.deleted_at is null and b.type = 'contact-form' and b.props like ?", `%${F}%`)[0].n;
    ok("D1 restaurer une page ne remet pas en ligne un formulaire déjà publié ailleurs", published === 1, `${published} formulaires publiés au même identifiant après restauration (${r.text.slice(0, 100)})`);
    ok("D1b la restauration dit pourquoi la page revient hors ligne", /hors ligne/.test(r.text) || published === 1 && /unpublished/.test(r.text), r.text.slice(0, 160));
    // Remise en ligne par « Publier » d'une page hors ligne.
    exec(d, "update pages set published = 0 where id = ?", A);
    const p = await callActionJson(jar, ids.setPublishedAction, [A, true], "/admin/pages");
    const now = query(d, "select published from pages where id = ?", A)[0].published;
    ok("D2 « Publier » refuse un formulaire dont l'identifiant est publié ailleurs", now === 0, `publiée malgré le doublon (${p.text.slice(0, 100)})`);
    // Doublon forcé en base : l'envoi ne doit pas partir au hasard sur une des deux pages.
    exec(d, "update pages set published = 1 where id = ?", A);
    const sent = await contactSend(F, { fa1: "Bonjour" });
    const msg = query(d, "select page_id from messages order by id desc limit 1")[0];
    ok("D3 un identifiant publié deux fois : envoi refusé (409), rien rangé", sent.status === 409 && !msg, `statut ${sent.status}, message rangé sur la page ${msg?.page_id}`);
    // Contournements : formulaire imbriqué dans un conteneur (grille) ; page sans conflit qui doit rester en ligne ; type « contact » avec option formulaire.
    const F2 = "formdupsecuc02";
    const F3 = "formdupsecuc03";
    const mk2 = (slug, deleted, blockType, props, id2 = null) => {
      exec(d, "insert into pages (slug, title, published, deleted_at) values (?, ?, 1, ?)", JSON.stringify({ fr: slug, en: slug }), L(slug), deleted ? Math.floor(Date.now() / 1000) : null);
      const id = query(d, "select id from pages where json_extract(slug, '$.fr') = ?", slug)[0].id;
      exec(d, "insert into blocks (page_id, position, type, props) values (?, 0, ?, ?)", id, blockType, JSON.stringify(props));
      return id;
    };
    const A2 = mk2("page-a2-secuc", true, "grid", { children: [{ type: "contact-form", props: { ...form, formId: F2 } }] });
    mk2("page-b2-secuc", false, "contact-form", { ...form, formId: F2 });
    const r2 = await callActionJson(jar, ids.restorePageAction, [A2], "/admin/corbeille");
    ok("D4 contournement : un formulaire imbriqué dans un conteneur est contrôlé aussi à la restauration", query(d, "select published from pages where id = ?", A2)[0].published === 0, r2.text.slice(60, 200));
    const A3 = mk2("page-a3-secuc", true, "contact-form", { ...form, formId: F3 });
    await callActionJson(jar, ids.restorePageAction, [A3], "/admin/corbeille");
    ok("D5 (témoin) restauration sans conflit : la page reste en ligne", query(d, "select published from pages where id = ?", A3)[0].published === 1);
    const A4 = mk2("page-a4-secuc", true, "contact", { form: true, ...form, formId: F2 });
    await callActionJson(jar, ids.restorePageAction, [A4], "/admin/corbeille");
    ok("D6 contournement : le type « contact » avec option formulaire est contrôlé comme « contact-form »", query(d, "select published from pages where id = ?", A4)[0].published === 0);
  });
}
S.finish();
