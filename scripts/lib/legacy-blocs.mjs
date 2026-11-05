#!/usr/bin/env node
/**
 * Page « v0.19 » avec un « Formulaire de contact » (type contact-form), des champs facultatifs vides (Contact, Grille)
 * et un brouillon qui les porte aussi, pour tester la migration 0023 (lot 27) : publiée ET en brouillon. Écrit
 * directement dans la base, comme le faisaient les anciennes versions.
 *
 *   import { seedLegacyBlocs, FORM_ID } from "./lib/legacy-blocs.mjs"       (tests : base en mémoire / de test)
 *   node --import tsx scripts/lib/legacy-blocs.mjs <DATA_DIR> seed          ajoute la page
 *   node --import tsx scripts/lib/legacy-blocs.mjs <DATA_DIR> migrate       joue mergeBlocks (comme au démarrage)
 */
import Database from "better-sqlite3";

const T = (fr, en = fr) => ({ fr, en });
const E = T("", "");
export const FORM_ID = "fe2eblocs01";
export const SLUG = "ancien-contact";

const field = (id, type, required = false, extra = {}) => ({ id, type, label: T(id), required, ...extra });
const legacyForm = () => ({
  formId: FORM_ID,
  eyebrow: T("Écrire", "Write"),
  title: T("Un mot ?", "A word?"),
  intro: E,
  fields: [field("fname", "text"), field("femail", "email", true, { reply: true }), field("fmessage", "textarea", true)],
  submit: T("Envoyer", "Send"),
  success: T("Merci !", "Thanks!"),
  error: T("Oups", "Oops"),
  subject: T("Message du test", "Test message"),
});

/** Contenu : [type, props] dans l'ordre de la page ; `imgs` : ids de médias image. */
export function legacyBlocs(imgs) {
  const kid = (uid, mediaId) => ({ uid, type: "image", props: { mediaId, width: "wide" } });
  return [
    ["rich-text", { paragraphs: [T("Avant le contact.", "Before the contact.")] }],
    ["contact-form", legacyForm()],
    ["contact", { eyebrow: E, title: T("Écris-moi", "Write to me"), intro: E, cta: T("Me contacter", "Contact me") }],
    ["grid", { layout: "3", eyebrow: E, title: T("Trois images", "Three images"), ratio: "4:5", children: [kid("gi0", imgs[0]), kid("gi1", imgs[1] ?? imgs[0]), kid("gi2", imgs[0])] }],
  ];
}

export function seedLegacyBlocs(db) {
  const imgs = db.prepare("select id from media where kind = 'image' and status = 'ready' order by id limit 2").all().map((r) => r.id);
  if (!imgs.length) throw new Error("base sans image");
  const slug = T(SLUG, "legacy-contact");
  const id = Number(db.prepare("insert into pages (slug, title, meta, nav_order, published) values (?, ?, null, null, 1)").run(JSON.stringify(slug), JSON.stringify(T("Ancien contact", "Legacy contact"))).lastInsertRowid);
  const put = db.prepare("insert into blocks (page_id, position, type, props) values (?, ?, ?, ?)");
  const blocks = legacyBlocs(imgs);
  blocks.forEach(([type, props], i) => put.run(id, i, type, JSON.stringify(props)));
  // Brouillon : mêmes blocs avec leurs uid, plus un contact entièrement vide et un autre formulaire (champs vides).
  const draft = {
    title: T("Ancien contact", "Legacy contact"),
    slug,
    meta: { title: T(""), description: T("") },
    published: true,
    inMenu: false,
    accent: null,
    blocks: [
      ...blocks.map(([type, props], i) => ({ uid: `lb${i}`, type, props: JSON.parse(JSON.stringify(props)) })),
      { uid: "lb-empty", type: "contact", props: { eyebrow: E, title: E, intro: E, cta: E } },
      { uid: "lb-form2", type: "contact-form", props: { ...legacyForm(), formId: "fe2eblocs02", eyebrow: E, title: T("Second formulaire") } },
    ],
  };
  db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = 1 where id = ?").run(JSON.stringify(draft), id);
  return { id, slug: slug.fr, imgs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, action] = process.argv.slice(2);
  const db = new Database(`${dir}/portfolio.db`, { timeout: 10000 });
  db.pragma("busy_timeout = 10000");
  if (action === "seed") console.log(JSON.stringify(seedLegacyBlocs(db)));
  else if (action === "migrate") {
    const { mergeBlocks } = await import("../../src/lib/db/blocs.ts");
    console.log(JSON.stringify(mergeBlocks(db)));
  } else throw new Error("action : seed | migrate");
  db.close();
}
