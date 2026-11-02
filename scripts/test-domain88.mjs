#!/usr/bin/env node
/**
 * Lot 88 : lecture de REDIRECT_FROM et décision de redirection (src/lib/domain.ts), sans serveur.
 * Usage : node --import tsx scripts/test-domain88.mjs
 */
import { hostOfHeader, parseRedirectFrom, redirectionFor } from "../src/lib/domain.ts";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const eq = (label, a, b) => ok(label, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
const BASE = "https://nouveau.example.test";

// Variable absente ou vide : rien.
for (const raw of [undefined, null, "", "   ", " , ,"]) {
  const c = parseRedirectFrom(raw, BASE);
  ok(`vide ${JSON.stringify(raw)} : aucun hôte, aucun message`, c.hosts.length === 0 && c.warnings.length === 0 && (raw === " , ," || c.errors.length === 0), JSON.stringify(c));
}
eq("liste simple", parseRedirectFrom("a.example.test,b.example.test", BASE).hosts, ["a.example.test", "b.example.test"]);
eq("espaces et majuscules", parseRedirectFrom("  A.Example.TEST ,  B.example.test  ", BASE).hosts, ["a.example.test", "b.example.test"]);
ok("espaces et majuscules : pas d'avertissement", parseRedirectFrom("  A.Example.TEST ", BASE).warnings.length === 0);
eq("doublons", parseRedirectFrom("a.example.test,A.example.test", BASE).hosts, ["a.example.test"]);
eq("point final", parseRedirectFrom("a.example.test.", BASE).hosts, ["a.example.test"]);
{
  const c = parseRedirectFrom("https://a.example.test/, http://b.example.test/chemin?x=1, c.example.test:8080", BASE);
  eq("schéma, barre, chemin, port retirés", c.hosts, ["a.example.test", "b.example.test", "c.example.test"]);
  ok("un avertissement par entrée corrigée", c.warnings.length === 3 && c.warnings.every((w) => w.startsWith("REDIRECT_FROM")), JSON.stringify(c.warnings));
}
{
  const c = parseRedirectFrom("bad host,*.example.test,a@b.test,,ok.example.test,-x.test,[::1]", BASE);
  eq("entrées invalides ignorées", c.hosts, ["ok.example.test"]);
  ok("une erreur par entrée invalide", c.errors.length === 5, JSON.stringify(c.errors));
}
{
  const c = parseRedirectFrom("Nouveau.example.test, vieux.example.test, https://nouveau.example.test/", BASE);
  eq("entrée identique au domaine principal ignorée", c.hosts, ["vieux.example.test"]);
  ok("…avec une erreur claire par entrée", c.errors.length === 2 && /domaine principal/.test(c.errors[0]), JSON.stringify(c.errors));
}
eq("même hôte avec un autre port que PUBLIC_BASE_URL : ignoré", parseRedirectFrom("localhost", "http://localhost:3000").hosts, []);
for (const base of [undefined, "", "pas une adresse", "ftp://x.example.test"]) {
  const c = parseRedirectFrom("a.example.test", base);
  ok(`PUBLIC_BASE_URL ${JSON.stringify(base)} : rien n'est redirigé, une erreur`, c.hosts.length === 0 && c.errors.length === 1, JSON.stringify(c));
}
eq("PUBLIC_BASE_URL avec barre finale", parseRedirectFrom("a.example.test", "https://nouveau.example.test/").base, BASE);

eq("hostOfHeader : port", hostOfHeader("Old.Example.TEST:3000"), "old.example.test");
eq("hostOfHeader : liste", hostOfHeader("a.test, b.test"), "a.test");
eq("hostOfHeader : point final", hostOfHeader("a.test."), "a.test");
eq("hostOfHeader : IPv6", hostOfHeader("[::1]:3000"), "[::1]");
eq("hostOfHeader : vide", [hostOfHeader(""), hostOfHeader(null), hostOfHeader(undefined)], [null, null, null]);

const cfg = parseRedirectFrom("old.example.test", BASE);
const r = (o) => redirectionFor(cfg, { method: "GET", pathAndQuery: "/fr/x?y=1", host: "old.example.test", ...o });
eq("GET : 301 vers le nouveau domaine, chemin et requête conservés", r({}), { status: 301, location: `${BASE}/fr/x?y=1` });
eq("HEAD : 301", r({ method: "head" })?.status, 301);
for (const m of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) eq(`${m} : 308`, r({ method: m })?.status, 308);
eq("X-Forwarded-Host seul", r({ host: "127.0.0.1:3000", forwardedHost: "old.example.test" })?.status, 301);
eq("X-Forwarded-Host l'emporte sur Host", r({ host: "old.example.test", forwardedHost: "nouveau.example.test" }), null);
eq("X-Forwarded-Host vide : Host compte", r({ forwardedHost: "" })?.status, 301);
eq("hôte principal : null", r({ host: "nouveau.example.test" }), null);
eq("localhost : null", r({ host: "localhost:3000" }), null);
eq("IP : null", r({ host: "192.0.2.1" }), null);
eq("pas d'hôte : null", r({ host: null }), null);
eq("sous-domaine d'un hôte listé : null", r({ host: "x.old.example.test" }), null);
eq("sans configuration : null", redirectionFor(parseRedirectFrom("", BASE), { method: "GET", pathAndQuery: "/", host: "old.example.test" }), null);

console.log(failures ? `\n${failures} test(s) en échec` : "\nTous les tests passent");
process.exit(failures ? 1 : 0);
