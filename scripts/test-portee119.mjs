#!/usr/bin/env node
/**
 * Lots 119-120 : portée des réglages de texte — unités.
 * - `look.projectText` (portée « Tout le projet », rangée dans les props du bloc « planche de projet ») : clés permises, styles relus avec le schéma,
 *   une clé inconnue ou un style illisible ne fait pas perdre le reste, nettoyage des clés vides.
 * - Feuille `projectStylesCss` : limitée à la planche (`data-pscope`), plus spécifique que celle du site, même fabrication (taille des titres de section
 *   seulement, couleur choisie publiée, fond du texte), jamais d'injection.
 * - Légendes : le style du bloc passe devant l'ancien style rangé avec la suite du projet (lot 98), champ par champ ; anciennes données relues telles quelles.
 * Usage : node --import tsx scripts/test-portee119.mjs   (inclus dans npm test)
 */
import { projectCaptionStyles } from "../src/blocks/caption-style.ts";
import { cleanLook, LookSchema, PROJECT_TEXT_KEYS, projectStylesCss, pscopeId, readLook, siteStylesCss } from "../src/lib/look.ts";

let failures = 0;
let count = 0;
function ok(label, cond, detail = "") {
  count++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ---- Schéma ------------------------------------------------------------------------ */
for (const k of PROJECT_TEXT_KEYS) ok(`clé acceptée : ${k}`, LookSchema.safeParse({ projectText: { [k]: { color: "secondary" } } }).success, k);
ok("clé inconnue refusée", !LookSchema.safeParse({ projectText: { menu: { color: "secondary" } } }).success);
ok("style illisible refusé", !LookSchema.safeParse({ projectText: { eyebrow: { color: "rouge-vif" } } }).success);
ok("un bloc sans projectText se relit comme avant", readLook({ spaceTop: "m", text: { title: { bold: true } } })?.projectText === undefined);
const mixed = readLook({ projectText: { eyebrow: { color: "primary" }, menu: { color: "primary" } }, spaceTop: "m" });
ok("une clé inconnue ne fait pas perdre le reste du réglage", mixed?.spaceTop === "m" && !mixed.projectText);
ok("nettoyage : un type vidé disparaît", !("projectText" in (cleanLook({ spaceTop: "m", projectText: { eyebrow: undefined } }) ?? {})));
ok("nettoyage : un réglage de type est gardé", cleanLook({ projectText: { body: { color: "ink" } } })?.projectText?.body?.color === "ink");

/* ---- Feuille ------------------------------------------------------------------------ */
ok("aucun style : aucune règle", projectStylesCss("pb1", undefined) === "" && projectStylesCss("pb1", {}) === "");
const css = projectStylesCss("pb1", { eyebrow: { color: "secondary" }, h2: { weight: 700, size: "3xl" }, body: { italic: true } });
ok("limitée à la planche", css.split("\n").every((l) => l.includes('[data-pscope="pb1"]')), css);
ok("plus spécifique que le site (même préfixe + la planche)", css.includes(":root:root:root #contenu [data-pscope=\"pb1\"] .eyebrow{"), css);
ok("titres : la graisse vise tous les titres", /:is\(h1, h2, h3\)\{[^}]*font-weight:700/.test(css), css);
ok("titres : la taille ne vise que les titres de section", /:is\(h2, h3\)\{font-size:/.test(css) && !/:is\(h1, h2, h3\)\{[^}]*font-size/.test(css), css);
ok("textes : paragraphes et listes hors étiquettes et légendes", css.includes(":is(p, li):not(.eyebrow, .caption-text, .strip-caption)"), css);
ok("couleur choisie publiée (--user-ink)", css.includes("--user-ink:"), css);
ok("un identifiant dangereux est réduit", pscopeId('a"] *{x}/*') === "ax" && !projectStylesCss('a"]{}', { body: { color: "ink" } }).includes('"]{'));
ok("la feuille du site, elle, ne parle pas de planche", !siteStylesCss({ roles: { eyebrow: { color: "secondary" } } }).includes("data-pscope"));
ok("pas de balise dans la feuille", !projectStylesCss("pb1", { body: { font: "google:Test</style>" } }).includes("</style"));

/* ---- Légendes : bloc par-dessus l'ancien style du projet --------------------------------- */
const strip = { uid: "strip", type: "strip", props: {} };
const legacy = [{ ...strip, captionStyle: { title: { color: "tertiary" }, date: { italic: true } } }];
const legacyOnly = projectCaptionStyles(legacy, undefined);
ok("anciennes données : le style du projet est relu tel quel", legacyOnly?.title?.color === "tertiary" && legacyOnly?.date?.italic === true && !legacyOnly?.legend);
const merged = projectCaptionStyles(legacy, { "cap.title": { color: "primary" }, "cap.legend": { bold: true } });
ok("le style du bloc passe devant l'ancien, champ par champ", merged?.title?.color === "primary" && merged?.legend?.bold === true && merged?.date?.italic === true, JSON.stringify(merged));
ok("sans ancien style ni réglage de bloc : rien", projectCaptionStyles([strip], undefined) === undefined && projectCaptionStyles([strip], {}) === undefined);
ok("réglage de bloc seul", projectCaptionStyles([strip], { "cap.date": { color: "ink" } })?.date?.color === "ink");
ok("un champ de légende vide dans le bloc est ignoré", projectCaptionStyles(legacy, { "cap.title": {} })?.title?.color === "tertiary");

console.log(failures ? `ÉCHEC : ${failures} sur ${count}` : `OK : ${count} vérifications`);
process.exit(failures ? 1 : 0);
