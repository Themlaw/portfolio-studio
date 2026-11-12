#!/usr/bin/env node
/**
 * Lot 130 : interface d'administration en FR / EN (sans serveur, inclus dans npm test).
 *  A  catalogues : messages/admin.fr.json et admin.en.json ont exactement les mêmes clés, les mêmes arguments ICU, aucune valeur vide ;
 *     l'anglais n'est jamais une copie du français (sauf liste d'exceptions justifiées) ; pluriels ICU bien formés.
 *  B  module de langue : défaut FR, cookie lu, valeur inconnue ignorée, traducteur (pluriels, nombres, dates Intl).
 *  C  garde : aucune chaîne française en dur dans le périmètre (scripts/adminlang130.scope.json ; `exclude` : préfixe ou *suffixe), hors exceptions justifiées ;
 *     chaque exception doit encore servir (sinon retirée).
 *  D  fichiers : réglage de langue dans « Sécurité du compte », fournisseur dans le layout de l'admin, action journalisée.
 * Usage : node --import tsx scripts/test-adminlang130.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { scanFile, walk } from "./lib/i18n-scan.mjs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const frRaw = JSON.parse(read("messages/admin.fr.json"));
const enRaw = JSON.parse(read("messages/admin.en.json"));
const flat = (o, pre = "", out = {}) => {
  for (const [k, v] of Object.entries(o)) typeof v === "object" && v !== null ? flat(v, `${pre}${k}.`, out) : (out[`${pre}${k}`] = v);
  return out;
};
/** Arguments ICU d'un message : noms de tête des {…} de premier niveau, plus ceux des corps de branches (select / plural), jamais le texte des branches. */
const args = (s) => {
  const out = new Set();
  const groups = (str) => {
    const res = [];
    let depth = 0, start = -1;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === "{") { if (depth++ === 0) start = i; }
      else if (str[i] === "}" && depth > 0 && --depth === 0) res.push(str.slice(start + 1, i));
    }
    return res;
  };
  const walk = (str) => {
    for (const inner of groups(str)) {
      const m = /^\s*(\w+)\s*(?:,\s*(select|plural|selectordinal)\s*,([\s\S]*)|,[\s\S]*|\|[^{}]*)?$/.exec(inner);
      if (!m) continue;
      out.add(m[1]);
      if (m[3]) for (const body of groups(m[3])) walk(body);
    }
  };
  walk(String(s));
  return [...out].sort().join(",");
};

/* ---- A. catalogues ---- */
const fr = existsSync(path.join(ROOT, "messages/admin.fr.json")) ? flat(JSON.parse(read("messages/admin.fr.json"))) : null;
const en = existsSync(path.join(ROOT, "messages/admin.en.json")) ? flat(JSON.parse(read("messages/admin.en.json"))) : null;
ok("A1 messages/admin.fr.json et admin.en.json existent", Boolean(fr && en));
if (fr && en) {
  const kf = Object.keys(fr), ke = Object.keys(en);
  ok("A2 mêmes clés FR / EN", kf.length === ke.length && kf.every((k) => k in en), `FR seul : ${kf.filter((k) => !(k in en)).slice(0, 5)} ; EN seul : ${ke.filter((k) => !(k in fr)).slice(0, 5)}`);
  ok("A3 aucune valeur vide", kf.every((k) => String(fr[k]).trim()) && ke.every((k) => String(en[k]).trim()));
  const bad = kf.filter((k) => k in en && args(fr[k]) !== args(en[k]));
  ok("A4 mêmes arguments ICU dans les deux langues", bad.length === 0, bad.slice(0, 5).join(", "));
  const sameFile = path.join(ROOT, "messages/admin.same.json");
  const allow = new Set(existsSync(sameFile) ? (JSON.parse(readFileSync(sameFile, "utf8")).keys ?? []) : []);
  // Exceptions par espace de noms (lots 130b, 130c) : messages/admin-parts/<espace>.same.json = { "keys": ["cle.relative", ...] } (clés relatives à l'espace).
  for (const f of readdirSync(path.join(ROOT, "messages/admin-parts")).filter((n) => n.endsWith(".same.json"))) {
    for (const k of JSON.parse(readFileSync(path.join(ROOT, "messages/admin-parts", f), "utf8")).keys ?? []) allow.add(`${f.slice(0, -".same.json".length)}.${k}`);
  }
  const copies = kf.filter((k) => k in en && fr[k] === en[k] && /[a-zà-ÿ]{3}/i.test(fr[k]) && !allow.has(k));
  ok("A5 l'anglais n'est pas une copie du français (exceptions : messages/admin.same.json)", copies.length === 0, copies.slice(0, 8).join(", "));
  const stale = [...allow].filter((k) => !(k in fr) || fr[k] !== en[k]);
  ok("A6 chaque exception de admin.same.json est encore une copie", stale.length === 0, stale.slice(0, 5).join(", "));
  ok("A7 le catalogue contient du contenu (compte, menu)", kf.some((k) => k.startsWith("account.")) && kf.some((k) => k.startsWith("shell.")));
}

{
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/admin-messages.mjs"), "--check"], { encoding: "utf8" });
  ok("A8 catalogues assemblés à jour (messages/admin-parts -> admin.*.json)", r.status === 0, r.stderr.trim());
}

/* ---- B. module de langue ---- */
{
  const m = await import("../src/i18n/admin-lang.ts").catch(() => null);
  ok("B1 src/i18n/admin-lang.ts existe", Boolean(m));
  if (m) {
    ok("B2 défaut FR, cookie portfolio-admin-lang", m.DEFAULT_ADMIN_LANG === "fr" && m.ADMIN_LANG_COOKIE === "portfolio-admin-lang");
    ok("B3 valeur inconnue ignorée", m.parseAdminLang("de") === null && m.parseAdminLang(undefined) === null && m.parseAdminLang("en") === "en" && m.parseAdminLang("fr") === "fr");
    const msgs = { x: { n: "{count, plural, one {# file} other {# files}}", d: "{when, date, long}" } };
    const t = m.makeAdminTranslator("en", msgs, "x");
    ok("B4 pluriel ICU (en)", t("n", { count: 1 }) === "1 file" && t("n", { count: 3 }) === "3 files");
    const tf = m.makeAdminTranslator("fr", { x: { n: "{count, plural, one {# fichier} other {# fichiers}}", d: "{when, date, long}" } }, "x");
    ok("B5 pluriel ICU (fr : 0 et 1 au singulier)", tf("n", { count: 0 }) === "0 fichier" && tf("n", { count: 2 }) === "2 fichiers");
    const d = new Date("2026-11-10T12:00:00Z");
    ok("B6 dates en Intl selon la langue", /November/.test(t("d", { when: d })) && /novembre/.test(tf("d", { when: d })));
  }
}

/* ---- C. garde ---- */
{
  const scope = JSON.parse(read("scripts/adminlang130.scope.json"));
  const norm = (p) => p.split(path.sep).join("/");
  const files = scope.include
    .flatMap((d) => walk(path.join(ROOT, d)))
    .map((f) => norm(path.relative(ROOT, f)))
    .filter((f) => !scope.exclude.some((x) => (x.startsWith("*") ? f.endsWith(x.slice(1)) : f.startsWith(x))));
  ok("C1 périmètre non vide", files.length > 20, String(files.length));
  const used = new Set();
  const left = [];
  for (const f of files) {
    const allow = scope.allow[f] ?? {};
    for (const hit of scanFile(path.join(ROOT, f))) {
      const key = Object.keys(allow).find((a) => hit.text.includes(a));
      if (key) used.add(`${f}::${key}`);
      else left.push(`${f}:${hit.line} « ${hit.text.slice(0, 60)} »`);
    }
  }
  ok(`C2 aucune chaîne française en dur dans le périmètre (${files.length} fichiers)`, left.length === 0, `${left.length} restantes, p. ex. ${left.slice(0, 6).join(" | ")}`);
  const unusedAllow = Object.entries(scope.allow).flatMap(([f, a]) => Object.keys(a).map((k) => `${f}::${k}`)).filter((k) => !used.has(k));
  ok("C3 chaque exception justifiée sert encore", unusedAllow.length === 0, unusedAllow.slice(0, 4).join(" | "));
  ok("C4 chaque exception a une raison", Object.values(scope.allow).every((a) => Object.values(a).every((r) => typeof r === "string" && r.length > 8)));
  const probe = scanFile("probe.tsx", 'export const A = () => <p title="Supprimer la page">Enregistrer les modifications</p>;');
  const probeOk = scanFile("probe.tsx", 'export const A = () => <p className="a-btn" title={t("x")}>{t("y")}</p>;');
  ok("C5 la garde détecte du français en dur dans le JSX et les attributs", probe.length === 2 && probeOk.length === 0, JSON.stringify(probe));
}

/* ---- D. fichiers ---- */
{
  const layout = read("src/app/admin/layout.tsx");
  ok("D1 layout de l'admin : fournisseur de messages, lang selon la langue d'interface", /NextIntlClientProvider/.test(layout) && /lang=\{/.test(layout) && !/lang="fr"/.test(layout));
  ok("D2 Sécurité du compte : sélecteur de langue de l'interface", /data-testid="langue-interface"/.test(read("src/components/admin/AccountSecurity.tsx")));
  ok("D3 action setAdminLangAction journalisée", /audited\("setAdminLangAction"/.test(read("src/app/admin/(espace)/compte/actions.ts")) && /setAdminLangAction/.test(read("src/lib/journal/catalog.ts")));
}

/* ---- E. toile de l'éditeur (130b) : la page publique en vue brouillon parle la langue de l'interface d'admin ---- */
{
  const banner = read("src/components/PreviewBanner.tsx");
  ok("E1 PreviewBanner : couche d'édition et pont dans un AdminIntlProvider (catalogue d'admin, langue du compte)", /<AdminIntlProvider/.test(banner) && /getAdminMessages/.test(banner) && /isAdminPreview/.test(banner));
  ok("E2 EditOnly : commandes d'édition dans AdminIntlBoundary", /AdminIntlBoundary/.test(read("src/components/EditOnly.tsx")));
  const layout = read("src/app/[locale]/layout.tsx");
  ok("E3 le layout public n'embarque jamais le catalogue d'admin", !/admin\.(fr|en)\.json|admin-server|getAdminMessages/.test(layout));
  const intl = read("src/components/AdminIntl.tsx");
  ok("E4 AdminIntl : fournisseur imbriqué + magasin de module", /NextIntlClientProvider/.test(intl) && /useSyncExternalStore/.test(intl));
}

/* ---- F. messages serveur synchrones (130c) : langue posée par la garde, français hors requête ---- */
{
  const guard = read("src/lib/auth/guard.ts");
  ok("F1 la garde (requireAdmin, assertAdmin) pose la langue du compte pour les messages serveur", (guard.match(/primeAdminLang\(/g) ?? []).length >= 2);
  const m = await import("../src/i18n/admin-msg.ts").catch(() => null);
  ok("F2 src/i18n/admin-msg.ts : français hors requête, anglais sur demande", Boolean(m) && m.currentAdminLang() === "fr" && m.adminT("sortable")("theItem") === "l'élément" && m.adminT("sortable", "en")("theItem") !== "l'élément");
}


/* ---- G. clés plates et résolution des appels t(...) (lot 130c, bug next-intl) ---- */
{
  const badKeys = [];
  const checkKeyNames = (obj, prefix = "") => {
    for (const k of Object.keys(obj)) {
      if (!/^[A-Za-z0-9_-]+$/.test(k)) badKeys.push(`${prefix}${k}`);
      if (obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k])) checkKeyNames(obj[k], `${prefix}${k}.`);
    }
  };
  checkKeyNames(frRaw);
  checkKeyNames(enRaw);
  ok("G1 chaque nom de clé respecte /^[A-Za-z0-9_-]+$/ (pas de point, d'espace ni d'accent)", badKeys.length === 0, `${badKeys.length} invalides, p. ex. ${badKeys.slice(0, 6).join(", ")}`);
}

{
  const scope = JSON.parse(read("scripts/adminlang130.scope.json"));
  const norm = (p) => p.split(path.sep).join("/");
  const files = scope.include
    .flatMap((d) => walk(path.join(ROOT, d)))
    .map((f) => norm(path.relative(ROOT, f)))
    .filter((f) => !scope.exclude.some((x) => (x.startsWith("*") ? f.endsWith(x.slice(1)) : f.startsWith(x))));
  const resolveMsg = (messages, key) => {
    const parts = String(key).split(".");
    let cur = messages;
    for (const part of parts) {
      if (!part) return false;
      if (!cur || typeof cur !== "object" || Array.isArray(cur) || !(part in cur)) return false;
      cur = cur[part];
    }
    return typeof cur === "string";
  };
  const declRe = /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getAdminT|adminT)\s*\(\s*["']([^"']+)["']\s*\)/g;
  const declRe2 = /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?makeAdminTranslator\s*\([^)]*["']([^"']+)["']\s*\)/g;
  const callRe = /(\w+)\s*\(\s*(?:"([^"]*)"|`([^`]*)`)\s*\)/g;
  const unresolved = [];
  for (const f of files) {
    const src = read(f);
    const nsByVar = new Map();
    for (const m of src.matchAll(declRe)) nsByVar.set(m[1], m[2]);
    for (const m of src.matchAll(declRe2)) nsByVar.set(m[1], m[2]);
    for (const m of src.matchAll(callRe)) {
      const ns = nsByVar.get(m[1]);
      if (!ns || !(ns in frRaw)) continue;
      let key = m[2] !== undefined ? m[2] : m[3];
      if (key.includes("${")) {
        const prefix = key.split("${")[0].replace(/\.$/, "");
        if (!prefix) continue;
        // Vérifie qu'au moins une clé du catalogue commence par ce préfixe fixe.
        const allKeys = [];
        const collect = (obj, pre = "") => {
          for (const k of Object.keys(obj)) {
            const pth = pre ? `${pre}.${k}` : k;
            allKeys.push(pth);
            if (obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k])) collect(obj[k], pth);
          }
        };
        collect(frRaw[ns]);
        let okPrefix = allKeys.some((k) => k === prefix || k.startsWith(prefix) || k.startsWith(`${prefix}.`));
        if (!okPrefix) {
          // try all namespaces
          for (const nsn of Object.keys(frRaw)) {
            const ks = [];
            const coll = (o, pre="") => { for (const k of Object.keys(o)) { const pth = pre?`${pre}.${k}`:k; ks.push(pth); if (o[k]&&typeof o[k]==="object"&&!Array.isArray(o[k])) coll(o[k],pth); } };
            coll(frRaw[nsn]);
            if (ks.some((k)=>k===prefix||k.startsWith(prefix)||k.startsWith(`${prefix}.`))) { okPrefix=true; break; }
          }
        }
        if (!okPrefix) {
          const line = src.slice(0, m.index).split("\n").length;
          unresolved.push(`${f}:${line} ${ns}::${prefix}`);
        }
        continue;
      }
      let resolved = resolveMsg(frRaw[ns], key);
      if (!resolved) for (const nsn of Object.keys(frRaw)) if (resolveMsg(frRaw[nsn], key)) { resolved = true; break; }
      if (!resolved) {
        const line = src.slice(0, m.index).split("\n").length;
        unresolved.push(`${f}:${line} ${ns}::${key}`);
      }
    }
  }
  ok("G2 chaque appel t(...) se résout dans le catalogue (points = niveaux)", unresolved.length === 0, `${unresolved.length} non résolus, p. ex. ${unresolved.slice(0, 6).join(" | ")}`);
}

console.log(failures === 0 ? "\nTout est vert." : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
