#!/usr/bin/env node
/**
 * Parité publique avant / après le lot 27 : page « parite » publiée avec des blocs aux champs TOUS remplis (Grille
 * d'images et de vidéos issues des anciens modèles, Contact, « Formulaire de contact » v0.19), pour comparer le HTML
 * servi par le code d'avant (21a8660) et celui d'après (migration 0023 jouée au démarrage). Un champ vide, lui, ne
 * rend plus rien : c'est voulu, hors de cette comparaison.
 *   node scripts/lib/parity-blocs27.mjs <DATA_DIR>      (serveur arrêté ; ajoute la page publiée « parite »)
 */
import Database from "better-sqlite3";

const T = (fr, en) => ({ fr, en: en ?? fr });
const kid = (uid, type, props) => ({ uid, type, props });
const field = (id, type, required = false, extra = {}) => ({ id, type, label: T(`Champ ${id}`, `Field ${id}`), required, ...extra });

const [dir] = process.argv.slice(2);
const db = new Database(`${dir}/portfolio.db`, { timeout: 10000 });
const imgs = db.prepare("select id from media where kind = 'image' and status = 'ready' order by id limit 3").all().map((r) => r.id);
if (!imgs.length) throw new Error("base sans image");
const img = (i) => imgs[i % imgs.length];
const slug = T("parite", "parity");
const id = Number(db.prepare("insert into pages (slug, title, meta, nav_order, published) values (?, ?, null, null, 1)").run(JSON.stringify(slug), JSON.stringify(T("Parité", "Parity"))).lastInsertRowid);
const put = db.prepare("insert into blocks (page_id, position, type, props) values (?, ?, ?, ?)");
[
  ["grid", { layout: "3", ratio: "4:5", eyebrow: T("Images", "Pictures"), title: T("Trois images", "Three images"), children: [0, 1, 2].map((i) => kid(`pi${i}`, "image", { mediaId: img(i), width: "wide", caption: T(`Image ${i}`, `Picture ${i}`) })) }],
  ["grid", { layout: "1+2", eyebrow: T("Vidéos", "Videos"), title: T("Trois vidéos", "Three videos"), children: [0, 1, 2].map((i) => kid(`pv${i}`, "video-single", { variant: "card", mode: "player" })) }],
  ["contact", { eyebrow: T("Contact", "Contact"), title: T("Écris-moi", "Write to me"), intro: T("Une phrase pour t'inviter.", "A sentence to invite you."), cta: T("Me contacter", "Contact me") }],
  [
    "contact-form",
    {
      formId: "fparite0001",
      eyebrow: T("Formulaire", "Form"),
      title: T("Un mot ?", "A word?"),
      intro: T("Dis-moi tout.", "Tell me everything."),
      fields: [field("fname", "text"), field("femail", "email", true, { reply: true }), field("fmessage", "textarea", true)],
      submit: T("Envoyer", "Send"),
      success: T("Merci !", "Thanks!"),
      error: T("Oups", "Oops"),
      subject: T("Message de parité", "Parity message"),
    },
  ],
].forEach(([type, props], i) => put.run(id, i, type, JSON.stringify(props)));
console.log(JSON.stringify({ id, slug: slug.fr }));
db.close();
