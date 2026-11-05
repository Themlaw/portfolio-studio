#!/usr/bin/env node
/**
 * Lot 125 « Me contacter » : tests UNITAIRES (sans serveur), données synthétiques.
 *  - réglage « Au clic » : absent / inconnu = formulaire (anciennes données), « mail » = ancien comportement ;
 *  - schémas Contact et Profil : réglage facultatif, valeurs inconnues refusées, anciennes données lues telles quelles ;
 *  - formulaire intégré : valide, identifiant réservé, accepte un envoi correct, refuse champ inconnu / obligatoire manquant ;
 *  - ancre du bloc formulaire stable.
 * Usage : node --import tsx scripts/test-contact125.mjs   (inclus dans npm test)
 */
import { builtinContactForm, ContactFormSchema, contactActionOf, CONTACT_ACTIONS, DEFAULT_FORM_ID, validateSubmission } from "../src/lib/contact-form.ts";
import { contactSchema } from "../src/blocks/ContactBlock.tsx";
import { profileSchema } from "../src/blocks/ProfileBlock.tsx";
import { formAnchor } from "../src/blocks/contact-target.ts";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

ok("réglage absent -> formulaire", contactActionOf(undefined) === "form");
ok("réglage « form » -> formulaire", contactActionOf("form") === "form");
ok("réglage « mail » -> e-mail", contactActionOf("mail") === "mail");
ok("valeur inconnue -> formulaire", contactActionOf("autre") === "form" && contactActionOf(3) === "form" && contactActionOf(null) === "form");
ok("deux réglages possibles", CONTACT_ACTIONS.join() === "form,mail");

const T = (fr, en) => ({ fr, en });
const oldContact = { title: T("Écris-moi", "Write to me"), cta: T("Me contacter", "Contact me") };
ok("Contact : ancienne donnée (sans réglage) toujours valide, aucune clé ajoutée", contactSchema.safeParse(oldContact).success && !("ctaAction" in contactSchema.parse(oldContact)));
ok("Contact : ctaAction mail / form acceptés", contactSchema.safeParse({ ...oldContact, ctaAction: "mail" }).success && contactSchema.safeParse({ ...oldContact, ctaAction: "form" }).success);
ok("Contact : ctaAction inconnu refusé", !contactSchema.safeParse({ ...oldContact, ctaAction: "tel" }).success);
const oldProfile = { paragraphs: [T("Texte", "Text")], contactLabel: T("Me contacter", "Contact me") };
ok("Profil : ancienne donnée valide sans clé ajoutée", profileSchema.safeParse(oldProfile).success && !("contactAction" in profileSchema.parse(oldProfile)));
ok("Profil : contactAction mail accepté, inconnu refusé", profileSchema.safeParse({ ...oldProfile, contactAction: "mail" }).success && !profileSchema.safeParse({ ...oldProfile, contactAction: "x" }).success);

const form = builtinContactForm();
ok("formulaire intégré : conforme au schéma, identifiant réservé", ContactFormSchema.safeParse(form).success && form.formId === DEFAULT_FORM_ID && /^[a-z0-9]{6,32}$/.test(DEFAULT_FORM_ID));
const good = validateSubmission(form, { femail: "lou@example.test", fmessage: "Bonjour" }, "fr");
ok("formulaire intégré : envoi correct (réponse à renseigné)", good.ok && good.replyTo === "lou@example.test");
ok("formulaire intégré : message obligatoire", !validateSubmission(form, { femail: "lou@example.test" }, "fr").ok);
ok("formulaire intégré : e-mail invalide refusé", !validateSubmission(form, { femail: "pas-un-mail", fmessage: "x" }, "fr").ok);
ok("formulaire intégré : champ inconnu refusé", !validateSubmission(form, { femail: "lou@example.test", fmessage: "x", fautre: "y" }, "fr").ok);
ok("ancre du bloc formulaire stable et valide comme id", formAnchor("abc123") === "formulaire-abc123" && /^[a-z][a-z0-9-]*$/.test(formAnchor("abc123")));

console.log(failures ? `${failures} ÉCHEC(S)` : "TOUT PASSE");
process.exit(failures ? 1 : 0);
