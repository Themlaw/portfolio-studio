/**
 * Migration de contenu 0030 (lot 75, « une seule écriture `media-look` »), idempotente, sur la version publiée (table `blocks`), les
 * brouillons de page (`pages.draft`) et les planches de projet (`projects.layout` ET `projects.draft_layout`) : l'habillage des places
 * d'« Images qui défilent » passe de CINQ cartes par place (`look.slotFrame`, `slotBg`, `slotRadius`, `slotPano`, `slotVideo`) à UNE seule,
 * `look.slotLook[place] = { frame?, bg?, radius?, pano?, video? }`. Chaque valeur est recopiée telle quelle : le rendu ne change pas.
 *
 * Propriétaire des données : il reste la rubrique de la page qui montre la planche (le `look` du bloc « Planche d'un projet »), comme avant.
 * Le descendre sur le projet changerait le rendu d'un projet montré sur deux pages avec deux habillages différents (la valeur de l'une
 * devrait être choisie au détriment de l'autre) : la décision est rapportée dans le rapport du lot 75.
 *
 * Le parcours cherche les cinq anciennes clés à n'importe quelle profondeur (rubrique, composant d'un conteneur) ; seule une valeur à
 * l'ancienne forme est réécrite. Une valeur déjà posée dans `slotLook` prime (`upgradeLook`). Chaque brouillon réécrit voit sa version
 * (`draft_rev`) augmenter : un onglet d'édition resté ouvert reçoit un conflit au lieu de ré-enregistrer l'ancien contenu. Une planche en
 * surcouche de brouillon augmente celle de la page qui la tient.
 *
 * L'ancienne forme reste LUE partout (`readLook` / `LookSchema` passent par `upgradeLook`) : une sauvegarde ou un brouillon non migré
 * s'affiche pareil.
 *
 * Module sans accès à l'application (lu par le migrateur et les tests Node).
 */
import type Database from "better-sqlite3";

import { upgradeLook } from "../look";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const LEGACY = ["slotFrame", "slotBg", "slotRadius", "slotPano", "slotVideo"] as const;

/** Réécrit en place les `look` à l'ancienne forme d'un arbre JSON ; vrai si quelque chose a changé. */
export function migrateSlotLooks(node: unknown): boolean {
  let changed = false;
  if (Array.isArray(node)) {
    for (const child of node) changed = migrateSlotLooks(child) || changed;
    return changed;
  }
  if (!isObj(node)) return false;
  if (LEGACY.some((k) => k in node)) {
    const next = upgradeLook(node) as Json;
    for (const k of Object.keys(node)) delete node[k];
    Object.assign(node, next);
    changed = true;
  }
  for (const value of Object.values(node)) changed = migrateSlotLooks(value) || changed;
  return changed;
}

export type SlotLookReport = { published: number; drafts: number; layouts: number; draftLayouts: number };

function parse(text: unknown): unknown {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Filtre SQL : le texte contient l'une des cinq anciennes clés. */
const likeAny = (col: string) => LEGACY.map(() => `${col} like ?`).join(" or ");
const patterns = LEGACY.map((k) => `%"${k}"%`);

export function seedSlotLooks(db: Database.Database): SlotLookReport {
  const report: SlotLookReport = { published: 0, drafts: 0, layouts: 0, draftLayouts: 0 };

  // Version publiée : une ligne = un bloc de premier niveau (ses composants dans props.children).
  for (const r of db.prepare(`select id, props from blocks where ${likeAny("props")}`).all(...patterns) as { id: number; props: string }[]) {
    const props = parse(r.props);
    if (!migrateSlotLooks(props)) continue;
    db.prepare("update blocks set props = ? where id = ?").run(JSON.stringify(props), r.id);
    report.published++;
  }

  // Brouillons de page.
  for (const p of db.prepare(`select id, draft from pages where ${likeAny("draft")}`).all(...patterns) as { id: number; draft: string }[]) {
    const draft = parse(p.draft);
    if (!migrateSlotLooks(draft)) continue;
    db.prepare("update pages set draft = ?, draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), p.id);
    report.drafts++;
  }

  // Planches de projet : la suite publiée, puis la surcouche de brouillon (dont la page voit sa version augmenter).
  for (const p of db.prepare(`select id, layout from projects where ${likeAny("layout")}`).all(...patterns) as { id: number; layout: string }[]) {
    const layout = parse(p.layout);
    if (!migrateSlotLooks(layout)) continue;
    db.prepare("update projects set layout = ? where id = ?").run(JSON.stringify(layout), p.id);
    report.layouts++;
  }
  for (const p of db.prepare(`select id, draft_layout layout, draft_layout_page_id page from projects where ${likeAny("draft_layout")}`).all(...patterns) as { id: number; layout: string; page: number | null }[]) {
    const layout = parse(p.layout);
    if (!migrateSlotLooks(layout)) continue;
    db.prepare("update projects set draft_layout = ? where id = ?").run(JSON.stringify(layout), p.id);
    if (p.page !== null) db.prepare("update pages set draft_rev = draft_rev + 1 where id = ?").run(p.page);
    report.draftLayouts++;
  }
  return report;
}
