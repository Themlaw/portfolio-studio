#!/usr/bin/env node
/**
 * Sécurité v1.0, domaine C : formulaire de contact (PR #23) — jeton signé, délai minimal, plafonds par réseau (IPv4 /24, IPv6 /64,
 * IPv4 mappée), rejeu, jeton d'un autre formulaire, nettoyage des valeurs. Serveur local, base SYNTHÉTIQUE, adresses de documentation
 * (RFC 5737, RFC 3849). Chaque test est une ATTAQUE : PASS = attaque bloquée. Les lignes INFO donnent une mesure sans verdict.
 * Usage : BATT_SECUC_SA=<.next/standalone> BATT_SECUC_PORT=3812 node scripts/secuC-contact-spam.mjs
 */
import * as S from "./lib/secuC.mjs";
import { contactSend, contactToken } from "./lib/secuC-contact.mjs";

const { ok, query, exec, startServer, stop, freshDir, sleep } = S;
S.prepareStandalone();
const info = (m) => console.log(`INFO  ${m}`);
const L = (s) => JSON.stringify({ fr: s, en: s });
const mkForm = (formId) => ({ formId, fields: [{ id: "fa1", type: "text", label: { fr: "Nom", en: "Name" }, required: true }, { id: "fa2", type: "email", label: { fr: "E-mail", en: "Email" }, reply: true }], submit: { fr: "Envoyer", en: "Send" }, success: { fr: "Merci", en: "Thanks" }, error: { fr: "Erreur", en: "Error" }, subject: { fr: "Objet", en: "Subject" } });
const F1 = "formspamsecuc01";
const F2 = "formspamsecuc02";

// Seed, puis deux formulaires publiés sur deux pages.
{
  const s0 = startServer(freshDir("contact"));
  await s0.ready;
  await stop(s0);
}
const d = `${S.TMP}/contact`;
for (const [slug, id] of [["form-un-secuc", F1], ["form-deux-secuc", F2]]) {
  exec(d, "insert into pages (slug, title, published) values (?, ?, 1)", JSON.stringify({ fr: slug, en: slug }), L(slug));
  const pid = query(d, "select id from pages where json_extract(slug, '$.fr') = ?", slug)[0].id;
  exec(d, "insert into blocks (page_id, position, type, props) values (?, 0, 'contact-form', ?)", pid, JSON.stringify(mkForm(id)));
}
const s = startServer(d, { AUTH_TRUSTED_PROXY_HOPS: "1" });
await s.ready;
const count = () => query(d, "select count(*) n from messages")[0].n;
const V = (n = "Bonjour") => ({ fa1: n, fa2: "visiteur@example.test" });
const hasTokens = (await contactToken(F1)) !== null;
info(`route de jeton /api/contact/token : ${hasTokens ? "présente" : "absente (v0.34.0 sans correctif)"}`);

// T1 : envoi sans jeton (script qui n'affiche jamais la page).
const t1 = await contactSend(F1, V(), { xff: "203.0.113.1", token: null });
ok("T1 un envoi sans jeton est refusé (403)", t1.status === 403, `statut ${t1.status}`);

// T2 : délai minimal : jeton neuf, envoi immédiat.
const tok2 = await contactToken(F1);
const t2 = await contactSend(F1, V(), { xff: "203.0.113.2", token: tok2, wait: false });
ok("T2 un envoi immédiat après le jeton est refusé (délai minimal 429)", t2.status === 429 || t2.status === 403, `statut ${t2.status}`);

// T3 : rejeu d'un jeton valable ; T4 : jeton d'un autre formulaire ; T5 : jeton falsifié ; T9 : course.
const tokA = await contactToken(F1);
const tokOther = await contactToken(F2);
const tokForged = await contactToken(F1);
const tokRace = await contactToken(F1);
await sleep(3300);
const first = await contactSend(F1, V("rejeu"), { xff: "203.0.113.3", token: tokA, wait: false });
const again = await contactSend(F1, V("rejeu"), { xff: "203.0.113.3", token: tokA, wait: false });
ok("T3 (témoin) le premier envoi avec jeton valable est accepté", first.status === 200 || (!hasTokens && first.status === 200), `statut ${first.status}`);
ok("T3b le rejeu du même jeton est refusé", again.status === 403, `statut ${again.status}`);
const other = await contactSend(F1, V("autre"), { xff: "203.0.113.4", token: tokOther, wait: false });
ok("T4 le jeton d'un autre formulaire est refusé", other.status === 403, `statut ${other.status}`);
const bad = tokForged ? tokForged.slice(0, -1) + (tokForged.endsWith("A") ? "B" : "A") : null;
const forged = await contactSend(F1, V("forge"), { xff: "203.0.113.5", token: bad, wait: false });
ok("T5 un jeton falsifié est refusé", forged.status === 403, `statut ${forged.status}`);
const race = await Promise.all(Array.from({ length: 20 }, () => contactSend(F1, V("course"), { xff: "203.0.113.6", token: tokRace, wait: false })));
const okRace = race.filter((r) => r.status === 200).length;
ok("T9 20 envois simultanés avec le même jeton : au plus un accepté (pas de course)", okRace <= 1, `${okRace} acceptés`);

// Plafonds par réseau : on récolte N jetons d'avance (un seul délai d'attente), puis on envoie depuis N adresses voisines.
async function wave(label, addrs, form = F1) {
  const toks = [];
  for (const _ of addrs) toks.push(await contactToken(form));
  await sleep(3300);
  const out = [];
  for (let i = 0; i < addrs.length; i++) out.push(await contactSend(form, V(`${label}${i}`), { xff: addrs[i], token: toks[i], wait: false }));
  return out;
}
const v4 = (n) => `198.51.100.${n}`;
const w4 = await wave("n", Array.from({ length: 14 }, (_, i) => v4(10 + i)));
const acc4 = w4.filter((r) => r.status === 200).length;
ok("T6 14 envois depuis 14 adresses du même /24 : au plus 10 acceptés (plafond par préfixe)", acc4 <= 10, `${acc4} acceptés (${w4.map((r) => r.status).join(",")})`);
const w4m = await wave("m", [`::ffff:198.51.100.200`, `::ffff:198.51.100.201`]);
ok("T6b contournement : la même plage présentée en IPv4 mappée (::ffff:a.b.c.d) tombe dans le même seau /24", w4m.every((r) => r.status !== 200), `statuts ${w4m.map((r) => r.status).join(",")}`);
const w6 = await wave("s", Array.from({ length: 14 }, (_, i) => `2001:db8:1:2::${(10 + i).toString(16)}`));
const acc6 = w6.filter((r) => r.status === 200).length;
ok("T7 14 envois depuis 14 adresses du même /64 IPv6 : au plus 10 acceptés", acc6 <= 10, `${acc6} acceptés (${w6.map((r) => r.status).join(",")})`);
const w6u = await wave("u", ["2001:DB8:1:2:0:0:0:99", "2001:db8:1:2:ffff:ffff:ffff:ffff"]);
ok("T7b contournement : majuscules, forme développée, autre hôte du /64 : même seau", w6u.every((r) => r.status !== 200), `statuts ${w6u.map((r) => r.status).join(",")}`);
const w6n = await wave("v", ["2001:db8:1:3::1"]);
ok("T7c (témoin) un autre /64 n'est pas pénalisé", w6n[0].status === 200 || !hasTokens, `statut ${w6n[0].status}`);
const wh = await wave("h", ["::ffff:c633:64f0"]);
ok("T6c contournement : la même plage présentée en IPv4 mappée HEXADÉCIMALE (::ffff:c633:64f0) tombe dans le même seau /24", wh[0].status !== 200, `statut ${wh[0].status}`);

// Nettoyage des valeurs.
const toks = [await contactToken(F2), await contactToken(F2), await contactToken(F2)];
await sleep(3300);
const cyr = await contactSend(F2, { fa1: "x", fa2: "visiteur@exаmple.test" }, { xff: "192.0.2.21", token: toks[0], wait: false });
ok("T10 une adresse e-mail à homoglyphe (« а » cyrillique) est refusée", cyr.status === 400, `statut ${cyr.status}`);
const kel = await contactSend(F2, { fa1: "x", fa2: "visiteur@example.test" }, { xff: "192.0.2.22", token: toks[1], wait: false });
const bidi = await contactSend(F2, { fa1: "a‮b​c", fa2: "visiteur@example.test" }, { xff: "192.0.2.23", token: toks[2], wait: false });
const row = query(d, "select fields from messages order by id desc limit 1")[0];
ok("T11 les caractères de format (U+202E, U+200B) sont retirés des valeurs rangées", bidi.status === 200 && row && !/[‮​]/.test(row.fields) && !row.fields.includes("\\u202e") && !row.fields.includes("\\u200b"), `statut ${bidi.status} ${row?.fields?.slice(0, 120)}`);
info(`message légitime (témoin, e-mail ASCII) : statut ${kel.status}`);

// Mesures sans verdict : jeton non lié à l'IP, saturation du plafond global (60/h) par plusieurs préfixes.
const tx = await contactToken(F2);
await sleep(3300);
const xip = await contactSend(F2, V("autre-ip"), { xff: "192.0.2.77", token: tx, wait: false });
info(`jeton réutilisé depuis une autre IP que celle qui l'a demandé : statut ${xip.status} (le jeton n'est pas lié à l'IP)`);
const total = count();
info(`messages rangés pendant les essais : ${total}`);
const addrs = Array.from({ length: 70 }, (_, i) => `192.0.${2 + Math.floor(i / 10)}.${(i % 10) + 1}`.replace(/^192\.0\.(\d+)/, (_, a) => `10.${a}`));
const wave60 = await wave("g", addrs.map((a, i) => `10.${60 + Math.floor(i / 10)}.0.${(i % 10) + 1}`));
const accG = wave60.filter((r) => r.status === 200).length;
const legit = await wave("l", ["172.16.1.1"]);
info(`70 envois depuis 7 /24 distincts : ${accG} acceptés ; un visiteur légitime juste après : statut ${legit[0].status} (${legit[0].status === 429 ? "plafond global de 60/h atteint : saturation encore possible avec ~6 /24" : "accepté"})`);
await stop(s);
S.finish();
