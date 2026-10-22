#!/usr/bin/env node
/**
 * Tests unitaires du lot 60 « Mon thème, modèles et versions » (inclus dans npm test) :
 *  1. résumés de version (kit : logo, cadre ; couleurs changées…) et noms (« Studio (kit 2) » → « Studio ») ;
 *  2. migration 0028 sur une base v0.28 réaliste : thème en ligne personnalisé → Mon thème v1 ; modèle en ligne → rien ; thèmes « (kit) »,
 *     « (copie) », « (importé) » intacts ; idempotente ; un seul Mon thème (index unique) ;
 *  3. versions : création à partir d'un modèle, enregistrements de l'éditeur regroupés par séance, kit, retour à une version, copie à part,
 *     marquage, rétention (30 dernières + marquées + en cours + publiée), publication (version publiée figée dans live_data), ancien thème → version.
 * Usage : node --import tsx scripts/test-themes60.mjs
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

const DIR = mkdtempSync(path.join(process.env.TEST_TMP ?? tmpdir(), "pf-themes60-"));
process.env.DATA_DIR = DIR;

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
};
const migrations = new URL("../drizzle/", import.meta.url).pathname;
function migrate(db, upTo = "9999", from = "0000") {
  for (const f of readdirSync(migrations).filter((x) => x.endsWith(".sql") && x.slice(0, 4) <= upTo && x.slice(0, 4) >= from).sort()) {
    for (const stmt of readFileSync(migrations + f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }
}

try {
  const { PRESETS } = await import("../src/themes/presets/index.ts");
  const { ThemeSchema } = await import("../src/themes/schema.ts");
  const { cleanThemeName, isMachineName, kitChanges, summarizeVersion, themeChanges } = await import("../src/lib/themes/summary.ts");
  const studio = PRESETS.studio;
  const withKit = (t, kit) => ThemeSchema.parse({ ...t, assets: { ...t.assets, kit: { ...(t.assets.kit ?? {}), ...kit } } });
  const SIG = { signature: { svg: "/media/kit/0123456789abcdef.svg", w: 100, h: 60 } };
  const FRAME = { frame: { image: { svg: "/media/kit/fedcba9876543210.svg", w: 100, h: 100 }, slice: [10, 10, 10, 10] } };
  const recolor = (t, bg) => ThemeSchema.parse({ ...t, tokens: { ...t.tokens, color: { ...t.tokens.color, bg } } });

  /* ---- 1. résumés et noms ---------------------------------------------------- */
  {
    ok("cleanThemeName : suffixes de l'ancien système retirés", cleanThemeName("Studio (kit 2) (importé)") === "Studio" && cleanThemeName("Studio (copie)") === "Studio" && cleanThemeName("Mon portfolio") === "Mon portfolio");
    ok("isMachineName : « Studio (kit) » oui, « Mon portfolio » non", isMachineName("Studio (kit)") && !isMachineName("Mon portfolio"));
    const a = withKit(studio, SIG);
    const b = withKit(a, FRAME);
    ok("kitChanges : logo, puis cadre", JSON.stringify(kitChanges(studio, a)) === '["logo"]' && JSON.stringify(kitChanges(a, b)) === '["cadre"]' && kitChanges(b, b).length === 0);
    ok("résumé d'un kit : « kit : logo, cadre »", summarizeVersion("kit", studio, withKit(studio, { ...SIG, ...FRAME })) === "kit : logo, cadre");
    ok("résumé de l'éditeur : « couleurs changées »", summarizeVersion("editor", studio, recolor(studio, "#fafafa")) === "couleurs changées" && themeChanges(studio, studio).length === 0);
    ok("résumé d'un retour et d'un modèle", summarizeVersion("revert", studio, studio, "2") === "Retour à la version 2" && /Modèle « Studio »/.test(summarizeVersion("model", studio, studio, "Studio")));
  }

  /* ---- 2. migration 0028 sur une base v0.28 réaliste -------------------------- */
  {
    const { migrateMonTheme } = await import("../src/lib/db/mon-theme.ts");
    const build = (liveId, extra = () => {}) => {
      const db = new Database(":memory:");
      migrate(db, "0027");
      for (const p of Object.values(PRESETS)) db.prepare("insert into themes (id, name, preset, data) values (?, ?, 1, ?)").run(p.id, p.name, JSON.stringify(p));
      const custom = (id, name, t) => db.prepare("insert into themes (id, name, preset, data) values (?, ?, 0, ?)").run(id, name, JSON.stringify({ ...t, id, name, preset: false }));
      custom("studio-copie", "Studio (copie)", recolor(studio, "#101010"));
      custom("studio-kit", "Studio (kit)", withKit(studio, SIG));
      custom("studio-kit-2", "Studio (kit 2)", withKit(studio, { ...SIG, ...FRAME }));
      custom("studio-kit-2-import", "Studio (kit 2) (importé)", withKit(studio, FRAME));
      custom("mon-portfolio", "Mon portfolio d'été", recolor(PRESETS.pro, "#fff8e6"));
      db.prepare("insert into settings (key, value) values ('activeThemeId', ?)").run(JSON.stringify(liveId));
      extra(db);
      const before = db.prepare("select * from themes order by id").all();
      migrate(db, "9999", "0028"); // le SQL 0028 s'applique sur la base v0.28 (le migrateur ne le joue qu'une fois)
      return { db, before };
    };
    const rows = (db) => db.prepare("select * from themes order by id").all();
    const untouched = (before, after, skip) =>
      before.filter((r) => !skip.includes(r.id)).every((r) => {
        const a = after.find((x) => x.id === r.id);
        return a && a.name === r.name && a.data === r.data && a.preset === r.preset && a.mine === 0 && a.version === 0 && a.live_data === null;
      });

    // a. thème en ligne = « Studio (kit 2) » (nom fabriqué par l'ancien système)
    {
      const { db, before } = build("studio-kit-2");
      const report = migrateMonTheme(db);
      const after = rows(db);
      const mine = after.filter((r) => r.mine === 1);
      const live = after.find((r) => r.id === "studio-kit-2");
      ok("migration : le thème en ligne personnalisé devient Mon thème (même ligne, même identifiant)", report.converted === "studio-kit-2" && mine.length === 1 && mine[0].id === "studio-kit-2");
      ok("migration : nom fabriqué (« Studio (kit 2) ») remplacé par « Mon thème », basé sur « Studio »", live.name === "Mon thème" && live.based_on === "Studio" && JSON.parse(live.data).name === "Mon thème");
      ok("migration : version 1, publiée, sans live_data", live.version === 1 && live.published_version === 1 && live.live_data === null);
      const { name: _n1, ...liveBefore } = JSON.parse(before.find((r) => r.id === "studio-kit-2").data);
      const { name: _n2, ...liveAfter } = JSON.parse(live.data);
      ok("migration : AUCUNE donnée de rendu du thème en ligne ne change (hors le nom)", JSON.stringify(liveBefore) === JSON.stringify(liveAfter));
      const v = db.prepare("select * from theme_versions where theme_id = 'studio-kit-2'").all();
      ok("migration : une version 1 gardée (« Reprise de … »), marquée", v.length === 1 && v[0].n === 1 && v[0].pinned === 1 && /Reprise de « Studio \(kit 2\) »/.test(v[0].summary) && v[0].data === live.data);
      ok("migration : les autres thèmes personnalisés et les modèles sont intacts (rien perdu, rien modifié)", after.length === before.length && untouched(before, after, ["studio-kit-2"]));
      ok("migration : tous les thèmes « (kit) », « (copie) », « (importé) » sont toujours là", ["studio-copie", "studio-kit", "studio-kit-2-import", "mon-portfolio"].every((id) => after.some((r) => r.id === id)));
      const again = migrateMonTheme(db);
      ok("migration : idempotente (second passage sans effet)", again.converted === null && JSON.stringify(rows(db)) === JSON.stringify(after) && db.prepare("select count(*) c from theme_versions").get().c === 1);
      ok("migration : un seul Mon thème (index unique)", (() => { try { db.prepare("update themes set mine = 1 where id = 'studio-copie'").run(); return false; } catch { return true; } })());
    }
    // b. nom choisi gardé
    {
      const { db } = build("mon-portfolio");
      migrateMonTheme(db);
      const r = db.prepare("select * from themes where mine = 1").get();
      ok("migration : un nom choisi (« Mon portfolio d'été ») est gardé", r?.id === "mon-portfolio" && r.name === "Mon portfolio d'été" && r.based_on === "Mon portfolio d'été");
    }
    // c. thème en ligne = modèle : rien n'est créé ici
    {
      const { db, before } = build("studio");
      const report = migrateMonTheme(db);
      const after = rows(db);
      ok("migration : thème en ligne = modèle : Mon thème naît au premier passage (rien créé, rien modifié)", report.converted === null && after.every((r) => r.mine === 0) && untouched(before, after, []) && db.prepare("select count(*) c from theme_versions").get().c === 0);
    }
    // d. réglage absent / thème en ligne illisible / base neuve
    {
      const { db } = build("studio-copie", (d) => d.prepare("update themes set data = '{pas du json' where id = 'studio-copie'").run());
      const report = migrateMonTheme(db);
      ok("migration : thème en ligne illisible : laissé tel quel", report.converted === null && db.prepare("select count(*) c from themes where mine = 1").get().c === 0);
      const empty = new Database(":memory:");
      migrate(empty);
      ok("migration : base neuve (aucun réglage) : sans effet", migrateMonTheme(empty).converted === null);
    }
    // e. les colonnes ajoutées valent leurs défauts sur les lignes existantes
    {
      const { db } = build("studio");
      const r = db.prepare("select mine, based_on, version, published_version, live_data from themes where id = 'pro'").get();
      ok("SQL 0028 : lignes existantes = défauts (mine 0, version 0, rien de publié)", r.mine === 0 && r.based_on === null && r.version === 0 && r.published_version === null && r.live_data === null);
    }
  }

  /* ---- 3. versions ------------------------------------------------------------ */
  {
    const fileDb = new Database(path.join(DIR, "portfolio.db"));
    migrate(fileDb);
    fileDb.close();
    const { getDb, getSqlite } = await import("../src/lib/db/index.ts");
    const { syncPresets } = await import("../src/lib/db/seed.ts");
    const V = await import("../src/lib/themes/versions.ts");
    const E = await import("../src/lib/edit/themes.ts");
    syncPresets(getDb());
    const sql = getSqlite();
    const setActive = (id) => sql.prepare("insert into settings (key, value) values ('activeThemeId', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify(id));
    const row = (id) => sql.prepare("select * from themes where id = ?").get(id);
    const nVersions = (id) => sql.prepare("select count(*) c from theme_versions where theme_id = ?").get(id).c;
    setActive("galerie-lumineuse");

    // a. premier usage : « Utiliser ce modèle » crée Mon thème, version 1
    const first = V.applyModel("studio");
    ok("modèle : sans Mon thème, « Utiliser ce modèle » crée Mon thème (version 1), pas en ligne", first.ok && first.data.created && first.data.version === 1 && !first.data.published && row(first.data.id).mine === 1 && row(first.data.id).published_version === null);
    const ID = first.data.id;
    ok("modèle : le modèle reste intact, le thème en ligne n'a pas changé", row("studio").mine === 0 && row("studio").preset === 1 && JSON.parse(row(ID).data).id === ID && JSON.parse(row(ID).data).name === "Mon thème" && V.activeThemeId() === "galerie-lumineuse");
    ok("modèle : basé sur « Studio », version 1 = copie du modèle", row(ID).based_on === studio.name && JSON.stringify({ ...JSON.parse(row(ID).data), id: "studio", name: studio.name, preset: true }) === JSON.stringify(studio));
    ok("modèle : un seul Mon thème (deuxième « Utiliser » exige un choix)", V.applyModel("pro").ok === false && row(ID).version === 1);
    const liveModel = (() => {
      // le modèle déjà en ligne : Mon thème en prend aussitôt la place (rien ne change pour les visiteurs)
      sql.prepare("update themes set mine = 0 where id = ?").run(ID);
      setActive("pro");
      const r = V.applyModel("pro");
      const res = r.ok && r.data.published && V.activeThemeId() === r.data.id && row(r.data.id).published_version === 1 && row(r.data.id).live_data === null;
      sql.prepare("update themes set mine = 0 where id = ?").run(r.data.id);
      sql.prepare("update themes set mine = 1 where id = ?").run(ID);
      setActive("galerie-lumineuse");
      return res;
    })();
    ok("modèle déjà en ligne : Mon thème est créé ET publié aussitôt (même rendu)", liveModel);

    // b. remplacer / second thème
    const rep = V.applyModel("pro", "replace");
    ok("remplacer : nouvelle version 2 de Mon thème, aucun nouveau thème", rep.ok && rep.data.version === 2 && rep.data.id === ID && nVersions(ID) === 2 && row(ID).based_on === PRESETS.pro.name);
    const themesBefore = sql.prepare("select count(*) c from themes").get().c;
    const second = V.applyModel("carnet-d-atelier", "second");
    ok("second thème : un thème à part (ancien thème), Mon thème inchangé", second.ok && second.data.second && sql.prepare("select count(*) c from themes").get().c === themesBefore + 1 && row(ID).version === 2 && row(second.data.id).mine === 0 && row(second.data.id).preset === 0);

    // c. kit ×3 : versions 3, 4, 5 sans nouveau thème
    const count = () => sql.prepare("select count(*) c from themes").get().c;
    const c0 = count();
    const cur = () => ThemeSchema.parse(JSON.parse(row(ID).data));
    const k1 = V.addKitVersion(withKit(cur(), SIG), cur());
    const k2 = V.addKitVersion(withKit(cur(), FRAME), cur());
    const k3 = V.addKitVersion(withKit(cur(), { paper: { image: { svg: "/media/kit/aaaaaaaaaaaaaaaa.svg", w: 10, h: 10 } } }), cur());
    ok("kit ×3 : versions 3, 4, 5 de Mon thème, aucun nouveau thème", [k1.version, k2.version, k3.version].join() === "3,4,5" && count() === c0 && k1.id === ID);
    const sums = V.listVersions(ID).map((v) => v.summary);
    ok("kit : résumés d'une ligne générés", sums[2] === "kit : logo" && sums[1] === "kit : cadre" && sums[0] === "kit : papier", JSON.stringify(sums));

    // d. éditeur : une version par séance
    const T0 = new Date("2026-10-22T10:00:00Z");
    const edit = (bg, at) => V.saveMine(ID, recolor(cur(), bg), at);
    const e1 = edit("#101010", T0);
    const e2 = edit("#202020", new Date(T0.getTime() + 3 * 60_000));
    ok("éditeur : deux enregistrements à 3 min d'écart = UNE version (6)", e1.ok && e2.ok && e1.data.version === 6 && e2.data.version === 6 && nVersions(ID) === 6);
    const e2b = edit("#202020", new Date(T0.getTime() + 4 * 60_000));
    ok("éditeur : enregistrer sans rien changer ne crée rien", e2b.ok && e2b.data.version === 6 && e2b.data.created === false && nVersions(ID) === 6);
    const e3 = edit("#303030", new Date(T0.getTime() + 20 * 60_000));
    ok("éditeur : après 10 min sans modification, nouvelle version (7)", e3.ok && e3.data.version === 7 && nVersions(ID) === 7);
    V.sealEditorSession(ID);
    const e4 = edit("#404040", new Date(T0.getTime() + 21 * 60_000));
    ok("éditeur : séance close à la sortie → nouvelle version (8)", e4.ok && e4.data.version === 8);
    ok("éditeur : résumé « couleurs changées »", V.listVersions(ID)[0].summary === "couleurs changées" && V.listVersions(ID)[0].source === "editor");
    ok("éditeur : Mon thème garde son identité (id, preset faux)", cur().id === ID && cur().preset === false);
    ok("éditeur : refuse un réglage invalide", V.saveMine(ID, { nimporte: "quoi" }).ok === false && row(ID).version === 8);

    // e. publication : la version publiée est figée, le site lit live_data ?? data
    setActive("galerie-lumineuse");
    const act = E.activateTheme(ID);
    ok("publier : Mon thème en ligne, version publiée = version en cours (8), live_data vide", act.ok && V.activeThemeId() === ID && row(ID).published_version === 8 && row(ID).live_data === null);
    ok("publier : la version publiée est marquée (jamais supprimée)", sql.prepare("select pinned from theme_versions where theme_id = ? and n = 8").get(ID).pinned === 1);
    const liveBefore = row(ID).data;
    const e5 = edit("#505050", new Date(T0.getTime() + 60 * 60_000));
    ok("brouillon : enregistrer ne publie rien — la version publiée (8) est figée dans live_data, le brouillon est la 9", e5.ok && e5.data.version === 9 && row(ID).live_data === liveBefore && row(ID).published_version === 8 && row(ID).data !== liveBefore);
    const e6 = edit("#606060", new Date(T0.getTime() + 62 * 60_000));
    ok("brouillon : enregistrements suivants regroupés (brouillon 9), la publiée reste 8", e6.data.version === 9 && row(ID).live_data === liveBefore);
    E.activateTheme(ID);
    ok("publier le brouillon : publiée = 9, live_data vidé", row(ID).published_version === 9 && row(ID).live_data === null);

    // f. revenir à une version = nouvelle version identique, rien de perdu
    const before = nVersions(ID);
    const old = V.getVersionTheme(ID, 2);
    const rv = V.revertToVersion(ID, 2);
    ok("revenir à la v2 : nouvelle version 10 identique à la 2, rien de perdu", rv.ok && rv.data.version === 10 && nVersions(ID) === before + 1 && JSON.stringify({ ...cur(), name: "" }) === JSON.stringify({ ...old, name: "" }) && V.getVersionTheme(ID, 9) !== null);
    ok("revenir : résumé « Retour à la version 2 »", V.listVersions(ID)[0].summary === "Retour à la version 2");
    ok("revenir : la version publiée (9) reste en ligne tant qu'on ne publie pas", row(ID).published_version === 9 && row(ID).live_data !== null);
    ok("revenir : version inconnue refusée", V.revertToVersion(ID, 999).ok === false);

    // g. copie à part, marquage
    const copy = V.keepVersionCopy(ID, 4);
    ok("copie à part : un ancien thème « (version 4) », Mon thème inchangé", copy.ok && /version 4/.test(copy.data.name) && row(copy.data.id).mine === 0 && row(ID).version === 10);
    ok("copie à part : contenu identique à la version 4", JSON.stringify({ ...JSON.parse(row(copy.data.id).data), id: "", name: "" }) === JSON.stringify({ ...V.getVersionTheme(ID, 4), id: "", name: "" }));
    ok("marquer une version", V.pinVersion(ID, 3, true).ok && V.listVersions(ID).find((v) => v.n === 3).pinned);

    // h. rétention : 30 dernières + marquées + en cours + publiée
    for (let i = 0; i < 45; i++) V.revertToVersion(ID, 1); // 45 versions de plus
    const pruned = 45 + 11 - V.listVersions(ID).length; // le nettoyage a eu lieu à chaque nouvelle version
    const left = V.listVersions(ID).map((v) => v.n);
    const top = row(ID).version;
    const expected = new Set([...Array.from({ length: 30 }, (_, i) => top - i), 3, 8, 9, top]);
    ok("rétention : les 30 dernières gardées", Array.from({ length: 30 }, (_, i) => top - i).every((n) => left.includes(n)), left.join());
    ok("rétention : la version marquée (3) est gardée", left.includes(3));
    ok("rétention : la version publiée (9) est gardée, même ancienne ; la 8 aussi (elle a été en ligne)", left.includes(9) && left.includes(8));
    ok("rétention : le reste est supprimé (ni plus ni moins), automatiquement à chaque nouvelle version", pruned > 0 && left.length === expected.size && V.pruneVersions(ID) === 0, `${left.length} gardées, ${expected.size} attendues`);
    ok("rétention : jamais la version en cours", left.includes(top));

    // i. ancien thème → version de Mon thème
    const oldId = V.applyModel("fanzine-riso", "second").data.id;
    const ad = V.adoptOldTheme(oldId);
    ok("ancien thème : « En faire mon thème » = nouvelle version de Mon thème, l'ancien thème reste", ad.ok && ad.data.id === ID && !ad.data.created && row(oldId) !== undefined && V.listVersions(ID)[0].source === "adopt");
    ok("ancien thème : un modèle ou Mon thème n'est pas un ancien thème", V.adoptOldTheme("studio").ok === false && V.adoptOldTheme(ID).ok === false);

    // j. garde-fous
    ok("suppression : Mon thème ne se supprime pas", E.deleteTheme(ID).ok === false && row(ID) !== undefined);
    ok("suppression : un ancien thème se supprime", E.deleteTheme(oldId).ok === true && row(oldId) === undefined);
    ok("enregistrement : un modèle ne se modifie pas", E.saveTheme("studio", studio).ok === false);
    ok("enregistrement via saveTheme : Mon thème → version, aucun refus « en ligne »", (() => { const r = E.saveTheme(ID, recolor(cur(), "#707070")); return r.ok && r.data.version >= 1 && V.activeThemeId() === ID; })());
    // sans Mon thème : kit, import créent Mon thème
    sql.prepare("update themes set mine = 0 where id = ?").run(ID);
    const k = V.addKitVersion(withKit(studio, SIG), studio);
    ok("kit sans Mon thème : Mon thème créé (v1 depuis le thème de départ) puis le kit en fait la v2", k.created && k.version === 2 && row(k.id).mine === 1 && row(k.id).based_on === studio.name);
    ok("import sans Mon thème : créé depuis l'archive (v1)", (() => { sql.prepare("update themes set mine = 0 where id = ?").run(k.id); const i = V.addImportedVersion(recolor(studio, "#abcdef"), "theme.zip"); return i.created && i.version === 1 && /Importé \(theme.zip\)/.test(V.listVersions(i.id)[0].summary); })());
  }
} finally {
  rmSync(DIR, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
