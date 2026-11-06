#!/usr/bin/env node
/**
 * Lot 103 : l'outil d'audit (scripts/audit-public.mjs) détecte des secrets, des fichiers
 * interdits et des motifs confidentiels PLANTÉS dans un dépôt jetable, y compris dans
 * l'historique seul, une branche annexe, un tag annoté et un message de commit ; il ne
 * réaffiche jamais le texte trouvé ; un dépôt propre sort en 0.
 * Toutes les valeurs sont synthétiques et assemblées ici à l'exécution (aucune ne figure
 * telle quelle dans ce fichier, qui passe donc lui-même l'audit).
 * Usage : node scripts/test-audit103.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const AUDIT = new URL("./audit-public.mjs", import.meta.url).pathname;
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? " — " + detail : ""}`);
};

const tmp = mkdtempSync(path.join(os.tmpdir(), "audit103-"));
const repo = path.join(tmp, "repo");
mkdirSync(repo);
const git = (...a) => execFileSync("git", ["-C", repo, "-c", "user.name=Testeur", "-c", "user.email=testeur@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...a], { encoding: "utf8" });
const put = (rel, content) => {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  writeFileSync(path.join(repo, rel), content);
};
const audit = (...args) => spawnSync(process.execPath, [AUDIT, "--repo", repo, ...args], { encoding: "utf8" });

// Valeurs synthétiques, assemblées à l'exécution.
const PRIVATE_KEY = ["-----BEGIN ", "OPENSSH PRIVATE", " KEY-----\nAAAAfaux\n-----END ", "OPENSSH PRIVATE KEY-----\n"].join("");
const GH_TOKEN = "ghp" + "_" + "Qx7Lm2Zk9Rt4Vb8Nc3Hd6Jf1Ws5Ya0PeUgTi";
const ENV_SECRET = "Zm9vYmFy" + "Qk5ob3J0ZW5zaWE" + "1Mzc0OTI4MTA2";
const NAME = "Zorg" + "lub Machin";
const MAIL = "jane.doe" + "@" + "mon-domaine-perso.fr";
const IP = [10, 20, 30, 40].join(".");
const HOME = "/home/" + "jdoe" + "/projets/x";

git("init", "-q", "-b", "main");
put("README.md", "# Projet jetable\nRien à signaler.\n");
put("src/a.ts", "export const a = 1;\n");
git("add", "-A");
git("commit", "-q", "-m", "départ propre");

// Un dépôt propre : code 0.
const clean = audit("--strict");
ok("dépôt propre : code 0, aucun résultat", clean.status === 0 && /0 bloquant\(s\), 0 à revoir/.test(clean.stdout), clean.stdout + clean.stderr);

// Secrets dans l'historique seul (ajoutés puis retirés).
put("deploy/id_key.txt", PRIVATE_KEY);
put("src/conf.ts", `export const token = "${GH_TOKEN}";\n`);
put(".env", `BETTER_AUTH_SECRET=${ENV_SECRET}\n`);
git("add", "-A");
git("commit", "-q", "-m", "ajout de fichiers de config");
git("rm", "-q", "-r", "deploy", "src/conf.ts", ".env");
git("commit", "-q", "-m", "retrait (le secret reste dans l'historique)");

// Fichier réel (en-tête PSD factice) + média, une branche annexe, un tag annoté, un message.
put("tests/fixtures/photo-reelle.psd", Buffer.concat([Buffer.from("8BPS"), Buffer.alloc(2048, 7)]));
put("img/a.png", Buffer.concat([Buffer.from("\x89PNG"), Buffer.alloc(512, 1)]));
git("add", "-A");
git("commit", "-q", "-m", "médias");
git("checkout", "-q", "-b", "lot/annexe");
put("notes.md", `Contact : ${MAIL}, machine ${IP}, dossier ${HOME}\nLe client s'appelle ${NAME}.\n`);
git("add", "-A");
git("commit", "-q", "-m", `note sur ${NAME}`);
git("checkout", "-q", "main");
git("tag", "-a", "v9.9.9", "-m", `version avec jeton ${GH_TOKEN}`);

writeFileSync(path.join(tmp, "motifs.txt"), `# commentaire\n${NAME.toLowerCase()}\nre:client\\s+s'appelle\n`);
const hosts = path.join(tmp, "hosts.txt");
writeFileSync(hosts, "serveur-prive\n");
put("infra.md", "ssh serveur-prive depuis le poste\n");
git("add", "-A");
git("commit", "-q", "-m", "infra");
const forbidden = path.join(tmp, "interdits.txt");
writeFileSync(forbidden, "tests/fixtures/*.psd\n");

const r = audit("--patterns", path.join(tmp, "motifs.txt"), "--forbidden", forbidden, "--hosts", hosts, "--json", path.join(tmp, "out.json"));
const out = r.stdout;
ok("dépôt piégé : code 1", r.status === 1, String(r.status));
ok("clé privée retrouvée dans l historique (retirée de l arbre)", /private-key : deploy\/id_key\.txt.*historique seul/.test(out), out);
ok("jeton GitHub retrouvé (fichier retiré, historique seul)", /github-token : src\/conf\.ts.*historique seul/.test(out), out);
ok("fichier .env réel interdit, même retiré", /env-file : \.env\b/.test(out));
ok("secret de BETTER_AUTH_SECRET dans le .env détecté par son contenu", /env-assignment : \.env/.test(out), out);
ok("jeton dans un tag annoté retrouvé", /github-token \(tag annoté\) : refs\/tags\/v9\.9\.9/.test(out), out);
ok("fichier de la liste interdite (glob)", /liste interdite \(chemin\) : tests\/fixtures\/photo-reelle\.psd/.test(out));
ok("média listé avec sa taille, non ouvert (png, psd)", /média binaire \(non ouvert\) : img\/a\.png/.test(out) && /média binaire \(non ouvert\) : tests\/fixtures\/photo-reelle\.psd/.test(out));
ok("motifs confidentiels : n° 1 et n° 2 dans le fichier de la branche annexe et dans le message", /motif n° 1 : notes\.md/.test(out) && /motif n° 2 : notes\.md/.test(out) && /motif n° 1 \(message ou identité\)/.test(out), out);
ok("branche annexe auditée (e-mail, IP privée, chemin personnel)", /adresse e-mail : notes\.md/.test(out) && /IP privée : notes\.md/.test(out) && /chemin personnel : notes\.md/.test(out), out);
ok("nom de machine privée (--hosts) retrouvé", /nom de machine : infra\.md/.test(out), out);
const leaks = [PRIVATE_KEY.split("\n")[1], GH_TOKEN, ENV_SECRET, NAME, NAME.toLowerCase(), "client s'appelle"].filter((x) => out.includes(x) || r.stderr.includes(x));
ok("la sortie ne réaffiche jamais le texte trouvé (secrets, motifs)", leaks.length === 0, leaks.join(" | "));
ok("sans --show-infra, aucune valeur d'infrastructure (e-mail, IP, chemin)", !out.includes(MAIL) && !out.includes(IP) && !out.includes(HOME));
const json = readJson(path.join(tmp, "out.json"));
ok("export JSON : ni secret ni motif", !JSON.stringify(json).includes(GH_TOKEN) && !JSON.stringify(json).includes(NAME) && json.length > 5);
const shown = audit("--show-infra", "--hosts", hosts);
ok("--show-infra : valeurs d'infrastructure affichées, jamais les secrets", shown.stdout.includes(MAIL) && shown.stdout.includes(IP) && !shown.stdout.includes(GH_TOKEN) && !shown.stdout.includes(ENV_SECRET));

// Liste de faux positifs relus.
const allowFile = path.join(tmp, "allow.txt");
writeFileSync(allowFile, ["secret src/conf.ts", "secret deploy/*", "secret .env", "email notes.md", "infra notes.md", "infra infra.md", "media img/*", "media tests/fixtures/*", "author (historique)"].join("\n") + "\n");
const al = audit("--allow", allowFile, "--forbidden", path.join(tmp, "vide.txt").replace("vide", "interdits"), "--strict");
ok("--allow : les exceptions relues disparaissent des résultats", !/src\/conf\.ts|deploy\/id_key|notes\.md.*e-mail/.test(al.stdout.split("## FICHIERS INTERDITS")[0]), al.stdout);

function readJson(f) {
  return JSON.parse(execFileSync("cat", [f], { encoding: "utf8" }));
}
rmSync(tmp, { recursive: true, force: true });
if (failures) {
  console.error(`test-audit103 : ${failures} échec(s)`);
  process.exit(1);
}
console.log("test-audit103 : OK");
