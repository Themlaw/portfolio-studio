#!/usr/bin/env node
/**
 * Page « v0.18 » avec des conteneurs « Projet mis en avant » (v0.13 à v0.18), pour tester la migration 0021 :
 * publiée ET en brouillon, avec les cas réalistes (Titre lié + Planche + lien « voir plus », images + texte avec
 * espacement et carte, grille dedans, conteneur sans projet). Écrit directement dans la base, comme le faisaient
 * les anciennes versions.
 *
 *   import { seedLegacyPage } from "./lib/legacy-containers.mjs"     (test-composants : base en mémoire / de test)
 *   node --import tsx scripts/lib/legacy-containers.mjs <DATA_DIR> seed      ajoute la page
 *   node --import tsx scripts/lib/legacy-containers.mjs <DATA_DIR> migrate   joue unwrapContainers (comme au démarrage)
 */
import Database from "better-sqlite3";

const T = (fr, en = fr) => ({ fr, en });
const kid = (uid, type, props = {}) => ({ uid, type, props });

/** Contenu des trois conteneurs ; `p1`, `p2` : slugs de deux projets existants, `imgs` : ids de médias image, `linkPage` : page du lien. */
export function legacyContainers({ p1, p2, imgs, linkPage }) {
  return {
    // Titre lié + planche, lien « voir plus »
    titreEtPlanche: { project: p1, more: { label: T("Voir tous les projets", "See all projects"), pageId: linkPage }, children: [kid("lt1", "section-title", { eyebrow: T("Projet récent", "Recent project"), linked: true }), kid("lb1", "project-board", { header: false })] },
    // Images + texte, espacement et carte du conteneur, grille dedans
    imagesTexteGrille: {
      project: p2,
      look: { spaceTop: "l", spaceBottom: "m", radius: "soft" },
      surface: { color: "primary12", width: "inset" },
      children: [
        kid("li2", "image", { mediaId: imgs[0], caption: T("Légende de l'image", "Image caption"), width: "wide" }),
        kid("lr2", "rich-text", { title: T("Un texte dans le conteneur", "A text in the container"), paragraphs: [T("Premier paragraphe du conteneur.", "First paragraph of the container.")] }),
        kid("lg2", "grid", { layout: "2", children: [kid("lg2b", "project-board", {}), kid("lg2i", "image", { mediaId: imgs[1] ?? imgs[0], width: "wide" })] }),
      ],
    },
    // Sans projet : titre figé + planche à projet propre
    sansProjet: { children: [kid("lt3", "section-title", { eyebrow: T("Sans projet"), title: T("Titre figé du conteneur"), intro: T("Présentation figée du conteneur.") }), kid("lb3", "project-board", { project: p1 })] },
  };
}

/** Ajoute la page. Renvoie { id, slug }. */
export function seedLegacyPage(db) {
  const projects = db.prepare("select slug from projects order by id").all().map((r) => r.slug);
  const imgs = db.prepare("select id from media where kind = 'image' and status = 'ready' order by id limit 2").all().map((r) => r.id);
  if (projects.length < 2 || !imgs.length) throw new Error("base sans projets ou sans images");
  const c = legacyContainers({ p1: projects[0], p2: projects[1], imgs, linkPage: 1 });
  const slug = T("ancienne-mise-en-avant", "legacy-featured");
  const id = Number(db.prepare("insert into pages (slug, title, meta, nav_order, published) values (?, ?, null, null, 1)").run(JSON.stringify(slug), JSON.stringify(T("Ancienne mise en avant", "Legacy featured"))).lastInsertRowid);
  const put = db.prepare("insert into blocks (page_id, position, type, props) values (?, ?, ?, ?)");
  [
    ["rich-text", { paragraphs: [T("Introduction avant les projets.", "Introduction before the projects.")] }],
    ["featured-project", c.titreEtPlanche],
    ["rich-text", { paragraphs: [T("Texte entre deux conteneurs.", "Text between two containers.")] }],
    ["featured-project", c.imagesTexteGrille],
    ["featured-project", c.sansProjet],
  ].forEach(([type, props], i) => put.run(id, i, type, JSON.stringify(props)));
  // Brouillon : même page (uid de brouillon), un paragraphe de plus après le premier conteneur.
  const draft = {
    title: T("Ancienne mise en avant", "Legacy featured"),
    slug,
    meta: { title: T(""), description: T("") },
    published: true,
    inMenu: false,
    accent: null,
    blocks: [
      { uid: "dr0", type: "rich-text", props: { paragraphs: [T("Introduction avant les projets.", "Introduction before the projects.")] } },
      { uid: "dr1", type: "featured-project", props: c.titreEtPlanche },
      { uid: "dr2", type: "rich-text", props: { paragraphs: [T("Paragraphe ajouté dans le brouillon.", "Paragraph added in the draft.")] } },
      { uid: "dr3", type: "rich-text", props: { paragraphs: [T("Texte entre deux conteneurs.", "Text between two containers.")] } },
      { uid: "dr4", type: "featured-project", props: c.imagesTexteGrille },
      { uid: "dr5", type: "featured-project", props: c.sansProjet },
    ].map((b) => JSON.parse(JSON.stringify(b))),
  };
  db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = 1 where id = ?").run(JSON.stringify(draft), id);
  return { id, slug: slug.fr };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, action] = process.argv.slice(2);
  const db = new Database(`${dir}/portfolio.db`, { timeout: 10000 });
  db.pragma("busy_timeout = 10000");
  if (action === "seed") console.log(JSON.stringify(seedLegacyPage(db)));
  else if (action === "migrate") {
    const { unwrapContainers } = await import("../../src/lib/db/unwrap.ts");
    console.log(JSON.stringify(unwrapContainers(db)));
  } else throw new Error("action : seed | migrate");
  db.close();
}
