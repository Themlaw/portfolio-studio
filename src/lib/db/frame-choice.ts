/**
 * Migration de contenu 0028 (lot 62 « Cadres des photos et des vidéos »), idempotente, sur la version publiée (table `blocks`), les
 * brouillons de page (`pages.draft`) et les planches de projet (`projects.layout` ET `projects.draft_layout`) : le cadre d'une photo
 * passe de l'ancienne forme `{ size: "thin" | "medium" | "thick" | "none", color? }` à UN choix `{ kind, color?, width? }` :
 *
 * - `size: "none"` (« Sans cadre ») → `{ kind: "none" }` ;
 * - `size: "thin" | "medium" | "thick"` (+ couleur) → `{ kind: "band", width: "fin" | "moyen" | "epais", color? }`, la Bande de couleur de
 *   la même épaisseur et de la même couleur : le rendu d'un choix explicite ne change pas.
 *
 * Les photos SANS réglage de cadre ne sont pas touchées : elles suivent désormais le réglage du site « Cadre du thème sur toutes les
 * photos » (absent = non, y compris pour les sites existants : décision du lot 62).
 *
 * Les cadres se trouvent à `look.frame` (image seule, case de grille, composant de planche), `look.slotFrame[slug]` (image de planche ou de
 * carrousel) et `items[].frame` (Planche libre), à n'importe quelle profondeur (cases de grille) : le parcours cherche ces trois formes
 * sans dépendre de la place du composant. Seule une valeur à l'ancienne forme est réécrite.
 *
 * Chaque brouillon réécrit voit sa version (`draft_rev`) augmenter : un onglet d'édition resté ouvert reçoit un conflit au lieu de
 * ré-enregistrer l'ancien contenu. Une planche en surcouche de brouillon augmente celle de la page qui la tient.
 *
 * Module sans accès à l'application (lu par le migrateur et les tests Node).
 */
import type Database from "better-sqlite3";

import { upgradeFrame } from "../look";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);
/** Ancien cadre : un objet `size` sans `kind`. */
const isLegacy = (v: unknown): v is Json => isObj(v) && "size" in v && !("kind" in v);

/** Réécrit en place les cadres à l'ancienne forme d'un arbre JSON ; vrai si quelque chose a changé. */
export function migrateFrames(node: unknown): boolean {
  let changed = false;
  if (Array.isArray(node)) {
    for (const child of node) changed = migrateFrames(child) || changed;
    return changed;
  }
  if (!isObj(node)) return false;
  for (const [key, value] of Object.entries(node)) {
    if (key === "frame" && isLegacy(value)) {
      const next = upgradeFrame(value);
      if (next !== value) {
        node[key] = next;
        changed = true;
      }
    } else if (key === "slotFrame" && isObj(value)) {
      for (const [slug, f] of Object.entries(value)) {
        if (!isLegacy(f)) continue;
        const next = upgradeFrame(f);
        if (next !== f) {
          value[slug] = next;
          changed = true;
        }
      }
    } else changed = migrateFrames(value) || changed;
  }
  return changed;
}

export type FrameChoiceReport = { published: number; drafts: number; layouts: number; draftLayouts: number };

function parse(text: unknown): unknown {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function seedFrameChoices(db: Database.Database): FrameChoiceReport {
  const report: FrameChoiceReport = { published: 0, drafts: 0, layouts: 0, draftLayouts: 0 };
  const LEGACY = "%\"size\":%";

  // Version publiée : une ligne = un bloc de premier niveau (ses composants dans props.children).
  for (const r of db.prepare("select id, props from blocks where props like '%rame%' and props like ?").all(LEGACY) as { id: number; props: string }[]) {
    const props = parse(r.props);
    if (!migrateFrames(props)) continue;
    db.prepare("update blocks set props = ? where id = ?").run(JSON.stringify(props), r.id);
    report.published++;
  }

  // Brouillons de page.
  for (const p of db.prepare("select id, draft from pages where draft like '%rame%' and draft like ?").all(LEGACY) as { id: number; draft: string }[]) {
    const draft = parse(p.draft);
    if (!migrateFrames(draft)) continue;
    db.prepare("update pages set draft = ?, draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), p.id);
    report.drafts++;
  }

  // Planches de projet : la suite publiée, puis la surcouche de brouillon (dont la page voit sa version augmenter).
  for (const p of db.prepare("select id, layout from projects where layout like '%rame%' and layout like ?").all(LEGACY) as { id: number; layout: string }[]) {
    const layout = parse(p.layout);
    if (!migrateFrames(layout)) continue;
    db.prepare("update projects set layout = ? where id = ?").run(JSON.stringify(layout), p.id);
    report.layouts++;
  }
  for (const p of db.prepare("select id, draft_layout layout, draft_layout_page_id page from projects where draft_layout like '%rame%' and draft_layout like ?").all(LEGACY) as { id: number; layout: string; page: number | null }[]) {
    const layout = parse(p.layout);
    if (!migrateFrames(layout)) continue;
    db.prepare("update projects set draft_layout = ? where id = ?").run(JSON.stringify(layout), p.id);
    if (p.page !== null) db.prepare("update pages set draft_rev = draft_rev + 1 where id = ?").run(p.page);
    report.draftLayouts++;
  }
  return report;
}
