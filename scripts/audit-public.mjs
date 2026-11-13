#!/usr/bin/env node
/**
 * Audit « le dépôt peut-il devenir public ? » (lot 103).
 *
 * Parcourt TOUS les blobs de l'historique (`git rev-list --objects --all` :
 * toutes les branches, tous les tags, les notes), plus les messages de commit,
 * les tags annotés et les identités d'auteur. Ne lit jamais un média binaire :
 * il les liste (chemin, taille, premier commit) sans les ouvrir ni les décoder.
 *
 * Classes de résultats
 *   BLOQUANT : secret (clé privée, jeton, mot de passe…), fichier interdit
 *              (.env réel, clé, base de données, liste --forbidden), motif confidentiel.
 *   A REVOIR : infrastructure (hôte, IP privée, domaine, chemin personnel),
 *              adresse e-mail, média binaire, identité d'auteur.
 * Les résultats ne contiennent JAMAIS le texte trouvé : type, règle, fichier, commit.
 * Seule exception, explicite : --show-infra affiche la valeur des résultats
 * d'infrastructure (hôtes, IP, domaines, e-mails), jamais celle des secrets ni des motifs.
 *
 * Usage : node scripts/audit-public.mjs [options]
 *   --repo <dossier>       dépôt à auditer (défaut : le dossier courant)
 *   --patterns <fichier>   motifs confidentiels, un par ligne (texte, insensible à la casse ;
 *                          « re:… » pour une expression). Ce fichier ne doit JAMAIS être
 *                          commité ni affiché ; la sortie dit « motif n° k », jamais son texte.
 *   --forbidden <fichier>  fichiers interdits : un chemin, un motif (* et **) ou « blob:<sha> » par ligne
 *   --allow <fichier>      faux positifs relus : « classe<espace>motif-de-chemin » ou « classe<espace>blob:<sha> »
 *                          par ligne, commentaire après « # » (classes : secret, forbidden, infra, email, media, author)
 *   --hosts <fichier>      noms de machines privées à chercher, un par ligne (fichier non commité)
 *   --tree                 n'audite que l'arbre de HEAD (pas l'historique, les messages ni les auteurs)
 *   --strict               les résultats « à revoir » comptent aussi dans le code de sortie
 *   --show-infra           affiche les valeurs d'infrastructure (jamais celles des secrets)
 *   --json <fichier>       écrit tous les résultats en JSON
 *   --max-blob <octets>    taille maximale d'un blob lu comme texte (défaut 2 Mo)
 * Code de sortie : 0 = rien à signaler, 1 = résultats (bloquants, ou à revoir avec --strict), 2 = usage.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name) => argv.includes(name);
if (flag("--help") || flag("-h")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^[/ *]+/gm, ""));
  process.exit(0);
}
const REPO = path.resolve(opt("--repo") ?? ".");
const MAX_BLOB = Number(opt("--max-blob") ?? 2 * 1024 * 1024);
const STRICT = flag("--strict");
const SHOW_INFRA = flag("--show-infra");
const TREE_ONLY = flag("--tree");

const git = (args, input) => execFileSync("git", ["-C", REPO, ...args], { maxBuffer: 1 << 30, input });
const gitText = (args) => git(args).toString("utf8");

/* ---------------------------------------------------------------- entrées */
const readLines = (f) =>
  readFileSync(f, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l && !l.startsWith("#"));

const patterns = (opt("--patterns") ? readLines(opt("--patterns")) : []).map((line, i) => {
  if (line.startsWith("re:")) {
    try {
      return { n: i + 1, re: new RegExp(line.slice(3), "i") };
    } catch {
      console.error(`motif n° ${i + 1} : expression invalide (ignoré)`);
      return null;
    }
  }
  return { n: i + 1, re: new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") };
}).filter(Boolean);

const globRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");
const forbiddenLines = opt("--forbidden") ? readLines(opt("--forbidden")) : [];
const forbiddenBlobs = new Set(forbiddenLines.filter((l) => l.startsWith("blob:")).map((l) => l.slice(5).trim()));
const forbiddenPaths = forbiddenLines.filter((l) => !l.startsWith("blob:") && !l.startsWith("old-versions:")).map((l) => (l.endsWith("/") ? globRe(l + "**") : globRe(l)));
const allow = (opt("--allow") ? readLines(opt("--allow")) : []).map((l) => {
  const [cls, ...rest] = l.split(/\s+#|\s+/).length ? l.replace(/\s+#.*$/, "").split(/\s+/) : [];
  const target = rest.join(" ");
  return target.startsWith("blob:") ? { cls, blob: target.slice(5) } : { cls, re: globRe(target) };
});
const allowed = (cls, file, sha) => allow.some((a) => a.cls === cls && (a.blob ? a.blob === sha : a.re.test(file)));

/* ------------------------------------------------------------------ règles */
const PLACEHOLDER = /(example|exemple|test|dummy|fake|factice|changeme|change-me|placeholder|xxxx|0123456789|abcdef|your[_-]|<[^>]+>|\$\{|\$\(|process\.env|env\.|secret-ci|ci-secret|redacted|\.\.\.|not-a-real|synthet|mem-secret|local-dev|dev-secret|aaaa|1234|mot-de-passe|synth|SYNTH)/i;

/** Secrets : [id, expression, (valeur) => faux positif ?]. */
const SECRET_RULES = [
  ["private-key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----/],
  ["github-token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["stripe-key", /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/],
  ["npm-token", /\bnpm_[A-Za-z0-9]{36}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["url-credentials", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"`]+:[^\s@/'"`]{4,}@[^\s/'"`]+/i, (m) => PLACEHOLDER.test(m) || /user:pass|:password@|:secret@|:\*+@/i.test(m)],
  [
    "secret-assignment",
    /\b[A-Za-z0-9_]*(?:secret|token|passw(?:or)?d|passwd|api[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?key)[A-Za-z0-9_]*["'`]?\s*[:=]\s*["'`]([A-Za-z0-9+/=_.~-]{16,})["'`]/i,
    (m, g1) => PLACEHOLDER.test(m) || PLACEHOLDER.test(g1 ?? "") || /^[a-z]+(?:-[a-z]+)+$/i.test(g1 ?? "") || /^(?:[A-Za-z]+\.){1,}[A-Za-z]+$/.test(g1 ?? ""),
  ],
  // .npmrc : interdit seulement s'il porte un jeton ou des identifiants (celui du dépôt ne contient que ignore-scripts=true).
  ["npmrc-auth", /^\s*(?:\/\/\S+:)?_(?:authToken|auth|password)\s*=\s*\S+/m],
  [
    "env-assignment",
    /^\s*(?:export\s+)?(?:BETTER_AUTH_SECRET|AUTH_SECRET|OIDC_CLIENT_SECRET|[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY))\s*=\s*["']?([^\s"'#$][^\s"'#]{11,})/m,
    (m, g1) => PLACEHOLDER.test(m) || PLACEHOLDER.test(g1 ?? ""),
  ],
];

/** Fichiers interdits quel que soit leur contenu. */
const FORBIDDEN_NAME = [
  ["env-file", /(^|\/)\.env(\.[^/]+)?$/, (p) => /\.(example|sample|template|dist)$/.test(p)],
  ["private-key-file", /(^|\/)(id_(rsa|dsa|ecdsa|ed25519)|[^/]+\.(pem|key|p12|pfx|jks|kdbx|ppk))$/, (p) => /(\.pub|-public\.pem)$/.test(p)],
  ["database-file", /\.(sqlite3?|db|db-wal|db-shm)$/, () => false],
  ["fichier-de-travail-d-artiste", /\.(psd|psb|xcf|kra|ai|clip|procreate)$/i, () => false],
  ["credentials-file", /(^|\/)(\.netrc|\.pgpass|kubeconfig|credentials\.json|service-account[^/]*\.json|wg[0-9]*\.conf|\.htpasswd)$/, () => false],
  ["infra-config", /(^|\/)(terraform\.tfstate[^/]*|[^/]+\.tfvars|ansible-vault[^/]*|komodo[^/]*\.toml|\.docker\/config\.json)$/, () => false],
];

const MEDIA_EXT = /\.(psd|psb|ai|xcf|kra|tiff?|png|jpe?g|gif|webp|avif|heic|bmp|ico|icns|svgz|mp4|m4v|mov|mkv|webm|avi|mp3|wav|flac|m4a|ogg|woff2?|ttf|otf|eot|pdf|zip|tar|gz|7z|raw|cr2|nef|arw|dng|exr|hdr)$/i;
const TEXTISH_MEDIA = /\.(svg)$/i; // lisible comme texte, mais listé aussi

/** Infrastructure. Les noms de machines privées viennent de --hosts (fichier non commité, un nom par ligne). */
const hostNames = opt("--hosts") ? readLines(opt("--hosts")) : [];
const HOSTS = new RegExp(`\\b(${(hostNames.length ? hostNames : ["\u0000aucun-hote"]).map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w-])`, "i");
const PRIVATE_IP = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/;
const HOME_PATH = /(?:\/home\/[a-z_][a-z0-9_-]{1,30}\/|\/Users\/[A-Za-z][\w.-]{1,30}\/|C:\\Users\\[\w.-]+\\)/;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const BENIGN_MAIL_DOMAIN = /(^|\.)([a-z]\.(fr|cc|zz)|exemple\.fr|domaine\.fr|adresse\.fr|domain\.com|example\.(com|org|net|test|invalid)|example|test|invalid|localhost|local|users\.noreply\.github\.com|noreply\.github\.com|github\.com|git)$/i;
const DOMAIN = /\b((?:[a-z0-9-]+\.)+(?:fr|com|net|org|io|dev|app|eu|me|xyz|cloud|art|studio|gallery|info|ovh|tk|ts\.net|duckdns\.org))\b/gi;
const BENIGN_DOMAIN =
  /(^|\.)(example\.(com|org|net)|github\.com|githubusercontent\.com|github\.io|ghcr\.io|npmjs\.(org|com)|nodejs\.org|w3\.org|whatwg\.org|mozilla\.org|google\.com|googleapis\.com|gstatic\.com|googletagmanager\.com|wikipedia\.org|schema\.org|ogp\.me|openstreetmap\.org|unpkg\.com|jsdelivr\.net|cloudflare\.com|vercel\.com|nextjs\.org|react\.dev|reactjs\.org|typescriptlang\.org|tailwindcss\.com|playwright\.dev|docker\.com|docker\.io|ubuntu\.com|debian\.org|apache\.org|opensource\.org|creativecommons\.org|sqlite\.org|fonts\.(google|bunny)\.com|fontsource\.org|adobe\.com|photoshop\.com|apple\.com|microsoft\.com|mozilla\.net|npmmirror\.com|yarnpkg\.com|nodesource\.com|ffmpeg\.org|poppler\.freedesktop\.org|freedesktop\.org|vips\.dev|libvips\.org|sharp\.pixelplumbing\.com|pixelplumbing\.com|better-auth\.com|drizzle\.team|orm\.drizzle\.team|zod\.dev|eslint\.org|prettier\.io|nodejs\.dev|youtube\.com|youtu\.be|vimeo\.com|instagram\.com|facebook\.com|twitter\.com|x\.com|linkedin\.com|behance\.net|pinterest\.com|tiktok\.com|bsky\.app|mastodon\.social|codeberg\.org|gitlab\.com|stackoverflow\.com|developer\.mozilla\.org|caniuse\.com|iana\.org|ietf\.org|rfc-editor\.org|unicode\.org|xn--[a-z0-9-]+|test|invalid|example|localhost|local)$/i;

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs|mts|cts|css)$/i;
/** Domaines de démonstration et de documentation. */
const PLACEHOLDER_DOMAIN = /(^|\.)(example\.(org|com|net)|exemple\.fr|domaine\.fr|adresse\.fr|domain\.com|nouveau-site\.fr|ancien\.fr|scripts\.sil\.org|openfontlicense\.org|gcr\.io|simpleicons\.org|youtube-nocookie\.com|ko-fi\.com|evilinstagram\.com|[a-z]\.(fr|info|cc|zz))$/i;
const SKIP_TEXT_EXT = /\.(lock|map|min\.js|min\.css|lockb)$|(^|\/)package-lock\.json$/i;

/* ---------------------------------------------------------------- inventaire */
const tipHead = (() => {
  try {
    return gitText(["rev-parse", "--verify", "-q", "HEAD"]).trim();
  } catch {
    return "";
  }
})();

// blobs : sha -> { paths:Set, size }
const objects = gitText(["rev-list", "--objects", "--all"]).split("\n");
const blobPaths = new Map();
for (const line of objects) {
  const sp = line.indexOf(" ");
  if (sp < 0) continue;
  const sha = line.slice(0, sp);
  const p = line.slice(sp + 1);
  if (!blobPaths.has(sha)) blobPaths.set(sha, new Set());
  blobPaths.get(sha).add(p);
}
// Types et tailles de tous les objets listés.
const allShas = [...new Set(objects.map((l) => l.split(" ")[0]).filter(Boolean))];
const checks = git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], allShas.join("\n") + "\n").toString("utf8").split("\n");
const blobs = new Map(); // sha -> {size, paths}
for (const c of checks) {
  const [sha, type, size] = c.split(" ");
  if (type !== "blob") continue;
  blobs.set(sha, { sha, size: Number(size), paths: [...(blobPaths.get(sha) ?? [])].filter(Boolean) });
}

// Premier commit de chaque blob (ordre chronologique inverse inversé : le plus ancien d'abord).
const firstCommit = new Map();
const firstOrder = new Map(); // sha de blob -> rang d'apparition (petit = ancien)
const commitInfo = new Map(); // sha -> date
{
  const out = gitText(["log", "--all", "--reverse", "--root", "--raw", "-r", "-m", "--no-renames", "--no-abbrev", "--format=%x01%H %cs"]);
  let cur = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("\x01")) {
      const [h, d] = line.slice(1).split(" ");
      cur = h;
      commitInfo.set(h, d);
    } else if (line.startsWith(":")) {
      const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) [A-Z]\t(.+)$/.exec(line);
      if (m && !/^0+$/.test(m[1]) && !firstCommit.has(m[1])) {
        firstCommit.set(m[1], cur);
        firstOrder.set(m[1], firstCommit.size);
      }
    }
  }
}
const where = (sha) => {
  const c = firstCommit.get(sha);
  return c ? `${c.slice(0, 8)} (${commitInfo.get(c)})` : "commit inconnu";
};
const inTree = new Set();
if (tipHead) {
  for (const l of gitText(["ls-tree", "-r", "HEAD"]).split("\n")) {
    const m = /^\d+ blob ([0-9a-f]+)\t/.exec(l);
    if (m) inTree.add(m[1]);
  }
}

if (TREE_ONLY) for (const [sha] of blobs) if (!inTree.has(sha)) blobs.delete(sha);

/* ------------------------------------------------------------------ analyse */
const findings = [];
const seen = new Set();
function add(f) {
  if (f.file && allowed(f.cls, f.file, f.sha)) return;
  const key = `${f.cls}|${f.rule}|${f.sha ?? ""}|${f.file ?? ""}|${f.value ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(f);
}
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

// 1. noms et tailles (sans lire le contenu).
for (const b of blobs.values()) {
  for (const p of b.paths) {
    const base = { file: p, sha: b.sha, size: b.size, commit: where(b.sha), inTree: inTree.has(b.sha) };
    if (forbiddenBlobs.has(b.sha)) add({ ...base, cls: "forbidden", blocking: true, rule: "liste interdite (blob)" });
    if (forbiddenPaths.some((r) => r.test(p))) add({ ...base, cls: "forbidden", blocking: true, rule: "liste interdite (chemin)" });
    for (const [id, re, skip] of FORBIDDEN_NAME) if (re.test(p) && !skip(p)) add({ ...base, cls: "forbidden", blocking: true, rule: id });
    if (MEDIA_EXT.test(p)) add({ ...base, cls: "media", blocking: false, rule: "média binaire (non ouvert)" });
    for (const pat of patterns) if (pat.re.test(p)) add({ ...base, cls: "pattern", blocking: true, rule: `motif n° ${pat.n} (dans le chemin)` });
  }
}

// 2. contenu des blobs texte.
const textShas = [];
let binaryFirstSeen = 0;
for (const b of blobs.values()) {
  if (b.size === 0 || b.size > MAX_BLOB) continue;
  if (b.paths.length && b.paths.every((p) => MEDIA_EXT.test(p) && !TEXTISH_MEDIA.test(p))) continue;
  if (b.paths.length && b.paths.every((p) => SKIP_TEXT_EXT.test(p))) continue;
  textShas.push(b.sha);
}
function scanText(text, base) {
  const isBinary = text.includes("\u0000");
  if (isBinary) {
    binaryFirstSeen++;
    return;
  }
  for (const [id, re, skip] of SECRET_RULES) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = g.exec(text))) {
      if (skip && skip(m[0], m[1])) continue;
      add({ ...base, cls: "secret", blocking: true, rule: id, line: lineOf(text, m.index) });
    }
  }
  for (const pat of patterns) {
    const g = new RegExp(pat.re.source, "gi");
    const m = g.exec(text);
    if (m) add({ ...base, cls: "pattern", blocking: true, rule: `motif n° ${pat.n}`, line: lineOf(text, m.index) });
  }
  // Infrastructure
  const infra = (rule, re, valueOf = (m) => m[0]) => {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = g.exec(text))) {
      const v = valueOf(m);
      if (v === null) continue;
      add({ ...base, cls: "infra", blocking: false, rule, line: lineOf(text, m.index), value: v });
    }
  };
  infra("nom de machine", HOSTS, (m) => m[1].toLowerCase());
  infra("IP privée", PRIVATE_IP);
  infra("chemin personnel", HOME_PATH, (m) => (/\/home\/(?:runner|node|app|user|appuser|nextjs|ubuntu)\/|\/Users\/(?:runner)\//.test(m[0]) ? null : m[0].replace(/[^/\\]+(?=[/\\]$)/, "…")));
  if (CODE_FILE.test(base.file)) {
    // Dans le code, « a.fr » est presque toujours une propriété d'objet : seules les URL comptent.
    const u = /\bhttps?:\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
    let um;
    while ((um = u.exec(text))) if (!BENIGN_DOMAIN.test(um[1]) && !PLACEHOLDER_DOMAIN.test(um[1])) add({ ...base, cls: "infra", blocking: false, rule: "domaine", line: lineOf(text, um.index), value: um[1].toLowerCase() });
  } else {
    infra("domaine", DOMAIN, (m) => (BENIGN_DOMAIN.test(m[1]) || PLACEHOLDER_DOMAIN.test(m[1]) ? null : m[1].toLowerCase()));
  }
  const mg = new RegExp(EMAIL.source, "g");
  let em;
  while ((em = mg.exec(text))) {
    if (BENIGN_MAIL_DOMAIN.test(em[1])) continue;
    add({ ...base, cls: "email", blocking: false, rule: "adresse e-mail", line: lineOf(text, em.index), value: em[0].toLowerCase() });
  }
}
if (textShas.length) {
  const buf = git(["cat-file", "--batch"], textShas.join("\n") + "\n");
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const [sha, , sizeStr] = buf.subarray(pos, nl).toString("utf8").split(" ");
    const size = Number(sizeStr);
    const body = buf.subarray(nl + 1, nl + 1 + size);
    pos = nl + 1 + size + 1;
    const b = blobs.get(sha);
    if (!b) continue;
    const text = body.toString("utf8");
    // Un blob présent sous plusieurs chemins : on le rapporte sous le premier.
    scanText(text, { file: b.paths[0] ?? "(sans chemin)", otherPaths: b.paths.length - 1, sha, size, commit: where(sha), inTree: inTree.has(sha) });
  }
}

// 3. messages de commit, tags annotés, identités.
const commitLog = TREE_ONLY ? [] : gitText(["log", "--all", "--format=%x01%H%x02%an%x02%ae%x02%cn%x02%ce%x02%B"]).split("\x01").filter(Boolean);
const identities = new Map();
for (const rec of commitLog) {
  const [h, an, ae, cn, ce, msg = ""] = rec.split("\x02");
  for (const id of [`${an} <${ae}>`, `${cn} <${ce}>`]) identities.set(id, (identities.get(id) ?? 0) + 1);
  const base = { file: `(message du commit)`, sha: h, commit: `${h.slice(0, 8)} (${commitInfo.get(h)})`, inTree: false };
  for (const [id, re, skip] of SECRET_RULES) {
    const m = re.exec(msg);
    if (m && !(skip && skip(m[0], m[1]))) add({ ...base, cls: "secret", blocking: true, rule: `${id} (message)` });
  }
  for (const pat of patterns) {
    if (pat.re.test(msg) || pat.re.test(`${an} ${ae} ${cn} ${ce}`)) add({ ...base, cls: "pattern", blocking: true, rule: `motif n° ${pat.n} (message ou identité)` });
  }
  for (const m of msg.matchAll(EMAIL)) if (!BENIGN_MAIL_DOMAIN.test(m[1])) add({ ...base, cls: "email", blocking: false, rule: "adresse e-mail (message)", value: m[0].toLowerCase() });
  for (const m of msg.matchAll(new RegExp(HOME_PATH.source, "g"))) add({ ...base, cls: "infra", blocking: false, rule: "chemin personnel (message)", value: m[0] });
  for (const m of msg.matchAll(new RegExp(HOSTS.source, "gi"))) add({ ...base, cls: "infra", blocking: false, rule: "nom de machine (message)", value: m[1].toLowerCase() });
}
for (const t of TREE_ONLY ? [] : gitText(["for-each-ref", "--format=%(refname)%09%(objecttype)", "refs/tags"]).split("\n").filter(Boolean)) {
  const [ref, type] = t.split("\t");
  if (type !== "tag") continue;
  const body = gitText(["cat-file", "tag", ref]);
  for (const [id, re, skip] of SECRET_RULES) {
    const m = re.exec(body);
    if (m && !(skip && skip(m[0], m[1]))) add({ cls: "secret", blocking: true, rule: `${id} (tag annoté)`, file: ref, commit: "tag" });
  }
  for (const pat of patterns) if (pat.re.test(body)) add({ cls: "pattern", blocking: true, rule: `motif n° ${pat.n} (tag annoté)`, file: ref, commit: "tag" });
}
const IDENTITY_OK = /(noreply|example\.invalid|@localhost|@x$|<t@x>)/i;
for (const [id, n] of identities) {
  if (IDENTITY_OK.test(id)) continue;
  add({ cls: "author", blocking: false, rule: "identité d'auteur", file: "(historique)", commit: `${n} commit(s)`, value: id });
}

/* ------------------------------------------------------------------- sortie */
const refs = gitText(["for-each-ref", "--format=%(refname)"]).split("\n").filter(Boolean);
const nCommits = gitText(["rev-list", "--all", "--count"]).trim();
console.log(`audit-public : ${REPO}`);
console.log(`  ${nCommits} commits, ${refs.length} références, ${blobs.size} blobs, ${textShas.length} lus comme texte, ${binaryFirstSeen} binaires ignorés au contenu`);
console.log(`  motifs confidentiels : ${patterns.length}, fichiers interdits : ${forbiddenPaths.length + forbiddenBlobs.size}, exceptions relues : ${allow.length}`);

const secret = (f) => f.cls === "secret" || f.cls === "pattern";
const order = ["secret", "pattern", "forbidden", "infra", "email", "media", "author"];
const titles = { secret: "SECRETS", pattern: "MOTIFS CONFIDENTIELS", forbidden: "FICHIERS INTERDITS", infra: "INFRASTRUCTURE", email: "ADRESSES E-MAIL", media: "MEDIAS BINAIRES (non ouverts)", author: "IDENTITES D'AUTEUR" };
for (const cls of order) {
  const list = findings.filter((f) => f.cls === cls);
  if (!list.length) continue;
  console.log(`\n## ${titles[cls]} : ${list.length}${list[0].blocking ? " [bloquant]" : ""}`);
  const grouped = new Map();
  for (const f of list) {
    const k = `${f.rule}|${f.file}|${cls === "author" ? f.value : ""}`;
    if (!grouped.has(k)) grouped.set(k, { ...f, lines: [], values: new Set(), versions: new Set(), tree: false, firstOrder: Infinity });
    const g = grouped.get(k);
    if (f.sha) g.versions.add(f.sha);
    if (f.line) g.lines.push(f.line);
    if (f.value) g.values.add(f.value);
    if (f.inTree) g.tree = true;
    const ord = f.sha && firstOrder.has(f.sha) ? firstOrder.get(f.sha) : Infinity;
    if (ord < g.firstOrder) {
      g.firstOrder = ord;
      g.commit = f.commit;
    }
  }
  for (const g of grouped.values()) {
    const size = g.size !== undefined && cls === "media" ? ` ${(g.size / 1024).toFixed(0)} Ko` : "";
    const ls = g.lines.length && g.versions.size === 1 ? ` l.${[...new Set(g.lines)].slice(0, 6).join(",")}` : "";
    const ver = g.versions.size > 1 ? `, ${g.versions.size} versions` : "";
    const val = SHOW_INFRA && !secret(g) && g.values.size ? `  -> ${[...g.values].slice(0, 5).join(", ")}` : g.values.size && cls !== "author" ? `  (${g.values.size} valeur(s) distincte(s))` : "";
    const val2 = cls === "author" && g.value ? `  ${SHOW_INFRA ? g.value : g.value.replace(/<.*>/, "<…>")}` : "";
    console.log(`  - ${g.rule} : ${g.file}${ls}${size}  [${g.tree ? "arbre+historique" : "historique seul"}${ver}, premier commit ${g.commit}]${val}${val2}`);
  }
}
const blocking = findings.filter((f) => f.blocking).length;
const review = findings.length - blocking;
console.log(`\nbilan : ${blocking} bloquant(s), ${review} à revoir`);
if (opt("--json")) writeFileSync(opt("--json"), JSON.stringify(findings.map(({ value, ...f }) => (SHOW_INFRA && !secret(f) ? { ...f, value } : f)), null, 1));
process.exit(blocking > 0 || (STRICT && review > 0) ? 1 : 0);
