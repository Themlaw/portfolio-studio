/**
 * Migration de contenu 0023 (v0.20, lot 27), idempotente, sur la version publiée (table `blocks`) ET les brouillons
 * de page (`pages.draft`, composants des conteneurs compris) :
 *
 *  1. « Formulaire de contact » (`contact-form`) → « Contact » (`contact`) avec l'option formulaire (`form: true`) :
 *     mêmes réglages à plat (formId, fields, submit, success, error, subject), donc même formulaire public, même
 *     identifiant d'envoi, mêmes styles locaux (`look.text`). Le rendu public ne change pas.
 *  2. Champs facultatifs (Grille : étiquette, titre ; Contact : étiquette, titre, présentation, bouton ; Profil :
 *     étiquette, légende, étiquettes du contact et des réseaux, bouton e-mail ; CV : étiquette, titre, présentation,
 *     bouton) : un champ VIDE devient un champ ABSENT, comme pour le Texte en 0020. Il n'occupe plus de place ni de
 *     texte d'aide sur la toile ; un texte saisi (même dans une seule langue) n'est jamais touché. Un champ vide ne
 *     rendait qu'un élément vide en public (ou, pour le bouton e-mail d'un Contact et d'un Profil, un bouton réduit
 *     à sa flèche) : il disparaît.
 *  3. Blocs anciens encore présents (« Projets mis en avant », « Planches d'une collection », « Vidéos », « Projet mis
 *     en avant » conteneur, « En-tête de collection ») : les migrations 0014, 0021 et 0022 sont rejouées (idempotentes,
 *     sans effet s'il n'en reste pas) pour migrer d'éventuelles instances restées dans un brouillon ; le rendu des
 *     anciens types reste dans le code, en lecture seule.
 *
 * « Grille d'images » et « Grille de vidéos » étaient déjà des modèles de départ du type `grid` (pas des types) : leurs
 * blocs sont des `grid`, rien à convertir. Chaque brouillon réécrit voit sa version (`draft_rev`) augmenter : un
 * onglet d'édition resté ouvert reçoit un conflit au lieu de ré-enregistrer l'ancien contenu.
 *
 * Module sans accès à l'application hors les migrations voisines (lu par le migrateur, le seed et les tests Node).
 */
import type Database from "better-sqlite3";

import { hasText } from "../../blocks/optional-fields";
import { unwrapContainers } from "./unwrap";
import { collectionPages, upgradeContent } from "./upgrade";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Champs de texte facultatifs par type de bloc (clés des réglages) : vide = absent. */
const OPTIONAL_TEXTS: Record<string, string[]> = {
  grid: ["eyebrow", "title"],
  contact: ["eyebrow", "title", "intro", "cta"],
  profile: ["eyebrow", "portraitCaption", "contactEyebrow", "contactLabel", "socialEyebrow"],
  cv: ["eyebrow", "title", "intro", "button"],
};

/** Un champ qui n'est pas un texte localisé (valeur illisible) n'est pas touché : seul « vide » disparaît. */
const isEmptyText = (v: unknown) => isObj(v) && (v.fr === undefined || typeof v.fr === "string") && (v.en === undefined || typeof v.en === "string") && !hasText(v);

/** Migre un bloc et ses composants en place ; vrai si quelque chose a changé. */
export function migrateBlock(node: unknown): boolean {
  if (!isObj(node)) return false;
  let changed = false;
  if (node.type === "contact-form") {
    node.type = "contact";
    if (isObj(node.props)) node.props = { ...node.props, form: true };
    changed = true;
  }
  const type = typeof node.type === "string" ? node.type : "";
  if (Object.hasOwn(OPTIONAL_TEXTS, type) && isObj(node.props)) {
    // Un « Contact » avec formulaire n'a pas de bouton e-mail : sa clé `cta` éventuelle n'est pas un champ à ranger.
    const form = type === "contact" && node.props.form === true;
    for (const key of OPTIONAL_TEXTS[type]) {
      if (form && key === "cta") continue;
      if (Object.hasOwn(node.props, key) && isEmptyText(node.props[key])) {
        delete node.props[key];
        changed = true;
      }
    }
  }
  if (isObj(node.props) && Array.isArray(node.props.children)) changed = migrateList(node.props.children) || changed;
  return changed;
}

export function migrateList(list: unknown[]): boolean {
  let changed = false;
  for (const b of list) changed = migrateBlock(b) || changed;
  return changed;
}

export type BlocsReport = { published: number; drafts: number; forms: number; emptied: number; legacy: number };

const KNOWN_LEGACY = ["featured-projects", "collection-projects", "video", "featured-project", "collection-intro"];

/** Nombre de blocs anciens (par type) restant dans une liste, composants compris. */
function countLegacy(list: unknown): number {
  let n = 0;
  const visit = (l: unknown) => {
    if (!Array.isArray(l)) return;
    for (const b of l) {
      if (!isObj(b)) continue;
      if (typeof b.type === "string" && KNOWN_LEGACY.includes(b.type)) n++;
      if (isObj(b.props)) visit(b.props.children);
    }
  };
  visit(list);
  return n;
}

export function mergeBlocks(db: Database.Database): BlocsReport {
  const report: BlocsReport = { published: 0, drafts: 0, forms: 0, emptied: 0, legacy: 0 };

  // 3. Anciens blocs : les migrations précédentes d'abord (elles peuvent réécrire des brouillons : versions à suivre).
  const revs = new Map((db.prepare("select id, draft_rev rev, draft from pages").all() as { id: number; rev: number; draft: string | null }[]).map((p) => [p.id, { rev: p.rev, draft: p.draft }]));
  upgradeContent(db);
  unwrapContainers(db);
  collectionPages(db);
  for (const [id, before] of revs) {
    const now = db.prepare("select draft, draft_rev rev from pages where id = ?").get(id) as { draft: string | null; rev: number } | undefined;
    if (now && now.draft !== before.draft && now.rev <= before.rev) db.prepare("update pages set draft_rev = ? where id = ?").run(before.rev + 1, id);
  }

  // 1 et 2. Version publiée : une ligne = un bloc de premier niveau (ses composants dans props.children).
  for (const r of db.prepare("select id, type, props from blocks").all() as { id: number; type: string; props: string }[]) {
    let props: unknown;
    try {
      props = JSON.parse(r.props);
    } catch {
      continue;
    }
    const node = { type: r.type, props };
    const wasForm = r.type === "contact-form";
    const before = JSON.stringify(props);
    if (!migrateBlock(node)) continue;
    if (wasForm) report.forms++;
    else if (JSON.stringify(node.props) !== before) report.emptied++;
    db.prepare("update blocks set type = ?, props = ? where id = ?").run(node.type, JSON.stringify(node.props), r.id);
    report.published++;
  }

  // Brouillons de page.
  for (const p of db.prepare("select id, draft from pages where draft is not null").all() as { id: number; draft: string }[]) {
    let draft: unknown;
    try {
      draft = JSON.parse(p.draft);
    } catch {
      continue;
    }
    if (!isObj(draft) || !Array.isArray(draft.blocks)) continue;
    const forms = (draft.blocks as unknown[]).filter((b) => isObj(b) && b.type === "contact-form").length;
    if (!migrateList(draft.blocks)) continue;
    report.forms += forms;
    db.prepare("update pages set draft = ?, draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), p.id);
    report.drafts++;
  }

  // Ce qui reste d'ancien (page de plus de 40 blocs une fois déballée…) : rendu seulement, signalé au journal.
  for (const r of db.prepare("select type from blocks").all() as { type: string }[]) {
    if (KNOWN_LEGACY.includes(r.type)) report.legacy++;
  }
  for (const p of db.prepare("select draft from pages where draft is not null").all() as { draft: string }[]) {
    try {
      const d = JSON.parse(p.draft) as { blocks?: unknown };
      report.legacy += countLegacy(d.blocks);
    } catch {}
  }
  return report;
}
