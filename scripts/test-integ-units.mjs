#!/usr/bin/env node
/**
 * Tests unitaires de l'intégration v0.14 (audit) — inclus dans npm test :
 *  1. syncPresets : ajoute un thème livré absent, met à jour un livré modifié,
 *     n'écrase JAMAIS un thème personnel au même identifiant ; idempotent.
 *  2. cssValue du schéma de thème : url() refusé (y compris « url(//hôte) »).
 *  3. Polices Google (fetch simulé, aucun réseau) : toutes les requêtes en
 *     `redirect: "error"` ; quota ne comptant que les polices utilisées
 *     (ramasse-miettes), refus clair si toutes servent ; fichiers d'une
 *     installation ratée effacés ; suppression refusée pour une police utilisée.
 *  4. Import de thème : deux imports simultanés du même nom → deux thèmes.
 * Usage : node --import tsx scripts/test-integ-units.mjs
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const DIR = mkdtempSync(path.join(process.env.TEST_TMP ?? tmpdir(), "pf-integ-units-"));
process.env.DATA_DIR = DIR;

let failures = 0;
let count = 0;
const ok = (label, pass, detail = "") => {
  count++;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
};
const migrations = new URL("../drizzle/", import.meta.url).pathname;
function migrate(db) {
  for (const f of readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(migrations + f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }
}

try {
  /* ---- 1. syncPresets -------------------------------------------------------- */
  {
    const schema = await import("../src/lib/db/schema.ts");
    const { syncPresets } = await import("../src/lib/db/seed.ts");
    const { PRESETS } = await import("../src/themes/presets/index.ts");
    const sqlite = new Database(":memory:");
    migrate(sqlite);
    const db = drizzle(sqlite, { schema });
    const n = Object.keys(PRESETS).length;
    const row = (id) => sqlite.prepare("select * from themes where id = ?").get(id);
    sqlite.prepare("insert into themes (id, name, preset, data) values ('studio', 'Mon studio', 0, '{\"perso\":true}')").run();
    const [added] = syncPresets(db);
    ok("syncPresets : thèmes livrés absents ajoutés", added === n - 1 && row("pro")?.preset === 1, String(added));
    ok("syncPresets : thème PERSONNEL au même identifiant jamais écrasé", row("studio").preset === 0 && row("studio").data === '{"perso":true}' && row("studio").name === "Mon studio");
    sqlite.prepare("update themes set data = '{}', name = 'vieux' where id = 'galerie-lumineuse'").run();
    sqlite.prepare("delete from themes where id = 'pro'").run();
    const [a2, u2] = syncPresets(db);
    ok("syncPresets : livré modifié mis à jour (données et nom), livré supprimé rajouté", a2 === 1 && u2 === 1 && row("galerie-lumineuse").data === JSON.stringify(PRESETS["galerie-lumineuse"]) && row("galerie-lumineuse").name === PRESETS["galerie-lumineuse"].name, `${a2} ${u2}`);
    const [a3, u3] = syncPresets(db);
    ok("syncPresets : idempotent", a3 === 0 && u3 === 0 && row("studio").data === '{"perso":true}');
  }

  /* ---- 2. cssValue ------------------------------------------------------------ */
  {
    const { ThemeSchema } = await import("../src/themes/schema.ts");
    const { PRESETS } = await import("../src/themes/presets/index.ts");
    const pro = PRESETS.pro;
    const radius = (sm) => ThemeSchema.safeParse({ ...pro, tokens: { ...pro.tokens, radius: { ...pro.tokens.radius, sm } } }).success;
    ok("cssValue : valeur simple acceptée", radius("6px") && radius("clamp(1rem, 2vw, 3rem)"));
    for (const v of ["url(//evil.example/x.png)", "URL(x)", "1px/*", "a\\\\75 rl(x)", "expression(alert(1))", "@import x"]) ok(`cssValue refuse « ${v} »`, !radius(v));
  }

  /* ---- 3. Polices Google ------------------------------------------------------- */
  {
    const fileDb = new Database(path.join(DIR, "portfolio.db"));
    migrate(fileDb);
    fileDb.close();
    const { GOOGLE_FONTS } = await import("../src/themes/google-fonts.ts");
    const lib = await import("../src/lib/fonts/library.ts");
    const { getSqlite } = await import("../src/lib/db/index.ts");
    const families = GOOGLE_FONTS.filter((g) => g.weights.includes(400)).slice(0, 14).map((g) => g.family);
    const calls = [];
    let failFiles = false;
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), redirect: init.redirect });
      const u = String(url);
      if (u.startsWith("https://fonts.googleapis.com/")) {
        const fam = decodeURIComponent(/family=([^:&]+)/.exec(u)[1].replace(/\+/g, " "));
        const slug = fam.toLowerCase().replace(/[^a-z0-9]/g, "");
        const css = ["latin", "latin-ext"].map((s) => `/* ${s} */ @font-face { font-family: '${fam}'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/${slug}/v1/${s}.woff2) format('woff2'); unicode-range: U+0000-00FF; }`).join("\n");
        return new Response(css, { status: 200 });
      }
      if (failFiles && u.includes("latin-ext")) throw new Error("réseau coupé");
      const body = Buffer.concat([Buffer.from("wOF2"), Buffer.from(u.padEnd(80, "#"))]);
      return new Response(body, { status: 200 });
    };
    // Horloge décalable : le délai de grâce des polices tout juste choisies se franchit sans attendre.
    let skew = 0;
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + skew;
    const pastGrace = () => (skew += lib.FONT_GRACE_MS + 1000);
    const fontFiles = () => (existsSync(path.join(DIR, "fonts")) ? readdirSync(path.join(DIR, "fonts")).filter((f) => f.endsWith(".woff2")) : []);
    const markUsed = (list) => {
      const styles = { roles: Object.fromEntries(list.map((f, i) => [["h1", "h2", "eyebrow", "body", "caption", "menu", "brand"][i % 7] + i, { font: `g:${f}` }])) };
      getSqlite().prepare("insert into settings (key, value) values ('styles', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify(styles));
    };

    let r = await lib.installGoogleFont(families[0], 400, false);
    ok("polices : installation (fetch simulé)", r.ok && r.data.installed && fontFiles().length === 2, JSON.stringify(r).slice(0, 200));
    ok("polices : TOUTES les requêtes vers Google en redirect: \"error\"", calls.length > 0 && calls.every((c) => c.redirect === "error"), JSON.stringify(calls.map((c) => c.redirect)));
    // 12 familles installées, aucune utilisée : la 13e passe (les inutilisées sont retirées).
    for (const f of families.slice(1, 12)) await lib.installGoogleFont(f, 400, false);
    ok("polices : 12 familles installées", Object.keys(lib.readFontLibrary()).length === 12);
    // Impasse évitée : tant que les baux courent, les 12 sont retenues (refus clair) ; passé le délai, la 13e passe.
    r = await lib.installGoogleFont(families[12], 400, false);
    ok("polices : 12 inutilisées mais choisies à l'instant (bail en cours) → refus, rien n'est retiré", !r.ok && Object.keys(lib.readFontLibrary()).length === 12 && fontFiles().length === 24, r.ok ? "accepté" : r.message);
    pastGrace();
    r = await lib.installGoogleFont(families[12], 400, false);
    ok("polices : quota plein de polices INUTILISÉES → ramasse-miettes, la nouvelle passe, fichiers orphelins effacés", r.ok && Object.keys(lib.readFontLibrary()).length === 1 && fontFiles().length === 2, `${r.ok ? "" : r.message} ${Object.keys(lib.readFontLibrary()).length} ${fontFiles().length}`);
    // Course au ramasse-miettes : police installée mais pas encore enregistrée par l'autosave (citée par aucun brouillon).
    let gc = await lib.collectFonts();
    ok("polices : GC entre l'installation et l'enregistrement → la police fraîchement choisie survit (bail)", Object.keys(lib.readFontLibrary()).join() === families[12] && gc.removed.length === 0 && fontFiles().length === 2, JSON.stringify(gc.removed));
    pastGrace();
    gc = await lib.collectFonts();
    ok("polices : bail échu et toujours inutilisée → retirée par le GC, fichiers effacés", gc.removed.join() === families[12] && fontFiles().length === 0, JSON.stringify(gc.removed));
    ok("polices : baux échus oubliés", !JSON.parse(getSqlite().prepare("select value from settings where key = 'fontLeases'").get().value)[families[12]]);
    // Baux douteux : daté du futur (horloge reculée, base trafiquée) = ignoré ; « toString » n'est pas une police de la bibliothèque.
    await lib.installGoogleFont(families[12], 400, false);
    const putLeases = (o) => getSqlite().prepare("insert into settings (key, value) values ('fontLeases', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify(o));
    putLeases({ [families[12]]: Date.now() + 3_600_000, toString: Date.now(), constructor: Date.now() });
    gc = await lib.collectFonts();
    ok("polices : bail daté du futur ignoré (la police inutilisée est retirée)", gc.removed.join() === families[12], JSON.stringify(gc.removed));
    ok("polices : baux sans police propre (toString, constructor) et baux du futur oubliés", Object.keys(JSON.parse(getSqlite().prepare("select value from settings where key = 'fontLeases'").get().value)).length === 0, getSqlite().prepare("select value from settings where key = 'fontLeases'").get().value);
    await lib.installGoogleFont(families[12], 400, false);
    pastGrace();
    // Toutes utilisées : refus clair, rien d'écrit.
    markUsed(families.slice(0, 12));
    for (const f of families.slice(0, 12)) await lib.installGoogleFont(f, 400, false);
    ok("polices : 12 familles UTILISÉES installées (l'inutilisée retirée pour faire place)", Object.keys(lib.readFontLibrary()).sort().join() === families.slice(0, 12).sort().join(), Object.keys(lib.readFontLibrary()).join());
    const before = fontFiles().length;
    r = await lib.installGoogleFont(families[13], 400, false);
    ok("polices : quota plein de polices UTILISÉES → refus clair (où elles servent), aucun fichier ajouté", !r.ok && /toutes servent encore/.test(r.message) && /styles du site/.test(r.message) && fontFiles().length === before, r.ok ? "accepté" : r.message);
    // Suppression : refusée si utilisée, acceptée sinon (fichiers effacés).
    const used = Object.keys(lib.readFontLibrary())[0];
    r = await lib.deleteFont(used);
    ok("polices : suppression d'une police utilisée refusée", !r.ok && /utilisée/.test(r.message));
    markUsed(Object.keys(lib.readFontLibrary()).slice(1));
    r = await lib.deleteFont(used);
    ok("polices : suppression d'une police inutilisée, ses fichiers effacés", r.ok && !(used in lib.readFontLibrary()) && fontFiles().length === before - 2, `${fontFiles().length} / ${before - 2}`);
    // Installation ratée en cours de route : fichiers déjà écrits effacés, bibliothèque inchangée.
    failFiles = true;
    const n0 = fontFiles().length;
    r = await lib.installGoogleFont(families[13], 400, false);
    ok("polices : échec réseau au 2e fichier → fichier déjà écrit effacé, rien enregistré", !r.ok && fontFiles().length === n0 && !(families[13] in lib.readFontLibrary()), `${fontFiles().length} / ${n0}`);
    failFiles = false;
    // Deux installations simultanées sur la dernière place : une seule passe.
    markUsed([...Object.keys(lib.readFontLibrary()), families[12], families[13]]);
    const [x, y] = await Promise.all([lib.installGoogleFont(families[12], 400, false), lib.installGoogleFont(families[13], 400, false)]);
    ok("polices : deux installations simultanées sur la dernière place → une seule passe, borne tenue", [x, y].filter((v) => v.ok).length === 1 && Object.keys(lib.readFontLibrary()).length === 12, `${x.ok} ${y.ok} ${Object.keys(lib.readFontLibrary()).length}`);

    /* ---- 4. Import de thème simultané -------------------------------------------- */
    const { importThemePackage } = await import("../src/lib/themes/transfer.ts");
    const { validPackage } = await import("./lib/theme-packages.mjs");
    const { loadPreset } = await import("./lib/presets.mjs");
    const pkg = validPackage(await loadPreset("galerie-lumineuse"), "Thème jumeau");
    const both = await Promise.allSettled([importThemePackage(pkg.zip), importThemePackage(pkg.zip)]);
    const ids = both.filter((b) => b.status === "fulfilled").map((b) => b.value.id);
    ok("import de thème : deux imports simultanés du même nom → deux thèmes, identifiants et noms distincts", ids.length === 2 && ids[0] !== ids[1], JSON.stringify(both.map((b) => b.status === "fulfilled" ? b.value : String(b.reason))));
  }
} finally {
  rmSync(DIR, { recursive: true, force: true });
}

if (failures) {
  console.error(`test-integ-units : ${failures} échec(s) sur ${count}`);
  process.exit(1);
}
console.log(`test-integ-units : OK (${count} contrôles)`);
