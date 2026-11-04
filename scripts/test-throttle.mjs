#!/usr/bin/env node
/**
 * Frein des connexions (docs/SECURITE.md §2.4, P4, N13), sans serveur ni base :
 *  - IPv6 regroupée par /64 (`ipBucket`), IPv4 et IPv4 écrite en IPv6 inchangées ;
 *  - chemin de Better Auth normalisé (`authEndpoint`) : barre finale, barres doublées, encodage, casse ;
 *  - délai par compte, toutes IP : progressif, BORNÉ, levé pour une IP qui a déjà réussi ;
 *  - mémoire des comptes bornée (plus ancien évincé) ;
 *  - mot de passe : 12 caractères pour un nouveau mot de passe.
 * Usage : node --import tsx scripts/test-throttle.mjs   (inclus dans npm test)
 */
import { ipBucket } from "../src/lib/auth/client-ip.ts";
import { MIN_PASSWORD_LENGTH } from "../src/lib/auth/config.ts";
import {
  ACCOUNT_FREE_FAILURES,
  ACCOUNT_MAX_DELAY_S,
  accountDelaySeconds,
  accountWaitSeconds,
  authEndpoint,
  MAX_TRACKED_ACCOUNTS,
  noteAccountFailure,
  noteAccountSuccess,
  trackedAccounts,
} from "../src/lib/auth/throttle.ts";

let failures = 0;
const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};

// IPv6 par /64.
const same64 = ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::1", "2001:0db8:0001:0002:ffff::", "2001:DB8:1:2:aaaa:bbbb:cccc:dddd"].map(ipBucket);
ok("T1 IPv6 : toutes les adresses d'un même /64 → une seule clé", new Set(same64).size === 1 && same64[0] === "2001:db8:1:2::/64", same64.join(" | "));
ok("T1b IPv6 : un autre /64 → une autre clé", ipBucket("2001:db8:1:3::1") !== same64[0], ipBucket("2001:db8:1:3::1"));
ok("T1c IPv4 et IPv4 écrite en IPv6 : l'IPv4", ipBucket("198.51.100.7") === "198.51.100.7" && ipBucket("::ffff:198.51.100.7") === "198.51.100.7");
ok("T1d formes courtes (::1, fe80::1, ::)", ipBucket("::1") === "0:0:0:0::/64" && ipBucket("fe80::1") === "fe80:0:0:0::/64" && ipBucket("::") === "0:0:0:0::/64");
ok("T1e forme illisible : rendue telle quelle, sans exception", ipBucket("1::2::3") === "1::2::3" && ipBucket("zz::1") === "zz::1" && ipBucket("0.0.0.0") === "0.0.0.0");

// Chemins.
const variants = ["/api/auth/sign-in/email", "/api/auth/sign-in/email/", "/api/auth//sign-in//email", "/api/auth/sign-in/%65mail", "/api/auth/SIGN-IN/Email", "/api/auth/sign-in%2Femail"];
ok("T2 chemin normalisé : toutes les variantes → /sign-in/email", variants.every((v) => authEndpoint(v) === "/sign-in/email"), variants.map(authEndpoint).join(" | "));
ok("T2b /change-password reconnu, hors /api/auth et encodage invalide → null", authEndpoint("/api/auth/change-password/") === "/change-password" && authEndpoint("/api/autre/sign-in/email") === null && authEndpoint("/api/auth/%E0") === null);

// Délai par compte.
ok("T3 délai du compte : nul sous le seuil, progressif, borné", accountDelaySeconds(ACCOUNT_FREE_FAILURES - 1) === 0 && accountDelaySeconds(ACCOUNT_FREE_FAILURES) === 2 && accountDelaySeconds(ACCOUNT_FREE_FAILURES + 1) === 4 && accountDelaySeconds(1000) === ACCOUNT_MAX_DELAY_S && ACCOUNT_MAX_DELAY_S <= 30);
const t0 = 1_700_000_000_000;
const email = "artiste@example.test";
noteAccountSuccess(email, "192.0.2.1", t0 - 1000);
// Un botnet : chaque échec vient d'une IP différente (aucune ne se voit freinée par la limite par IP ni par couple).
for (let i = 0; i < 40; i++) noteAccountFailure(email, t0 + i * 10);
const now = t0 + 400;
const wait = accountWaitSeconds(email, "203.0.113.99", now);
ok("T4 40 échecs depuis 40 IP : une nouvelle IP attend, au plus la borne", wait > 0 && wait <= ACCOUNT_MAX_DELAY_S, `${wait} s`);
ok("T4b l'IP qui a déjà réussi sur ce compte n'attend pas", accountWaitSeconds(email, "192.0.2.1", now) === 0);
ok("T4c après la borne, plus d'attente (l'artiste n'est jamais enfermée dehors)", accountWaitSeconds(email, "203.0.113.99", t0 + 390 + ACCOUNT_MAX_DELAY_S * 1000 + 1) === 0);
ok("T4d un autre compte n'est pas freiné", accountWaitSeconds("autre@example.test", "203.0.113.99", now) === 0);
ok("T4e échecs anciens (> 15 min) oubliés", accountWaitSeconds(email, "203.0.113.99", t0 + 16 * 60_000) === 0);

// Mémoire bornée (N13) : e-mails tous différents.
const t1 = performance.now();
for (let i = 0; i < MAX_TRACKED_ACCOUNTS + 5000; i++) noteAccountFailure(`x${i}@example.test`, t0 + i);
ok("T5 mémoire des comptes bornée (e-mails tous différents)", trackedAccounts() === MAX_TRACKED_ACCOUNTS, `${trackedAccounts()} comptes, ${Math.round(performance.now() - t1)} ms`);
// Un même compte martelé longtemps : la liste de ses échecs reste courte.
const warn = console.warn;
let alerts = 0;
console.warn = () => alerts++;
for (let i = 0; i < 100_000; i++) noteAccountFailure("cible@example.test", t0 + i);
console.warn = warn;
ok("T5b un compte martelé (100 000 échecs) : délai toujours borné", accountWaitSeconds("cible@example.test", "203.0.113.5", t0 + 100_000) <= ACCOUNT_MAX_DELAY_S && alerts > 0, `${alerts} alertes`);

ok("T6 nouveau mot de passe : 12 caractères au moins", MIN_PASSWORD_LENGTH === 12);

if (failures) {
  console.error(`test-throttle : ${failures} échec(s)`);
  process.exit(1);
}
console.log("test-throttle : OK");
