/**
 * Migration de contenu 0027 (lot 36 « Lecteur vidéo »), idempotente, sur la version publiée (table `blocks`), les brouillons
 * de page (`pages.draft`) et les planches de projet (`projects.layout` ET `projects.draft_layout`) : chaque composant Vidéo
 * (`video-single`), seul ou case de grille (page et planche), reçoit explicitement son mode de lecture, `mode` valant
 * `"loop"` (Boucle) ou `"player"` (Lecteur).
 *
 * Le mode équivalent au comportement d'avant :
 * - `mode` déjà posé et connu (« loop » ou « player ») : gardé tel quel. Une boucle muette en lecture automatique était déjà
 *   « loop » (devient la Boucle) ; un lecteur était « player » (devient le Lecteur) ;
 * - `mode` absent ou illisible : le schéma du composant en faisait « player » (valeur par défaut, lecteur avec bouton lecture) ;
 *   c'est donc « player » qui est écrit, le choix sûr : ni son ni mouvement ne démarre sans le geste du visiteur.
 *
 * Les bandes d'images (« Images qui défilent », bande du projet) ne sont pas touchées : leur réglage `videoMode` est facultatif, et
 * son absence veut dire « chaque vidéo suit sa nature » (animation courte et muette en boucle, vidéo longue en lecteur), ce qui
 * est exactement leur comportement d'avant.
 *
 * Chaque brouillon réécrit voit sa version (`draft_rev`) augmenter : un onglet d'édition resté ouvert reçoit un conflit au lieu
 * de ré-enregistrer l'ancien contenu. Une planche en surcouche de brouillon augmente celle de la page qui la tient.
 *
 * Module sans accès à l'application (lu par le migrateur et les tests Node).
 */
import type Database from "better-sqlite3";

import { isVideoMode } from "../../blocks/video-mode";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Pose le mode des composants Vidéo d'une liste (et de leurs enfants) en place ; vrai si quelque chose a changé. */
export function migrateVideoModes(list: unknown): boolean {
  if (!Array.isArray(list)) return false;
  let changed = false;
  for (const node of list) {
    if (!isObj(node) || !isObj(node.props)) continue;
    if (node.type === "video-single" && !isVideoMode(node.props.mode)) {
      node.props.mode = "player";
      changed = true;
    }
    if (Array.isArray(node.props.children)) changed = migrateVideoModes(node.props.children) || changed;
  }
  return changed;
}

export type VideoModeReport = { published: number; drafts: number; layouts: number; draftLayouts: number };

function parse(text: unknown): unknown {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function seedVideoModes(db: Database.Database): VideoModeReport {
  const report: VideoModeReport = { published: 0, drafts: 0, layouts: 0, draftLayouts: 0 };

  // Version publiée : une ligne = un bloc de premier niveau (ses composants dans props.children).
  for (const r of db.prepare("select id, type, props from blocks where props like '%video-single%' or type = 'video-single'").all() as { id: number; type: string; props: string }[]) {
    const props = parse(r.props);
    if (!isObj(props)) continue;
    if (!migrateVideoModes([{ type: r.type, props }])) continue;
    db.prepare("update blocks set props = ? where id = ?").run(JSON.stringify(props), r.id);
    report.published++;
  }

  // Brouillons de page.
  for (const p of db.prepare("select id, draft from pages where draft like '%video-single%'").all() as { id: number; draft: string }[]) {
    const draft = parse(p.draft);
    if (!isObj(draft) || !migrateVideoModes(draft.blocks)) continue;
    db.prepare("update pages set draft = ?, draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), p.id);
    report.drafts++;
  }

  // Planches de projet : la suite publiée, puis la surcouche de brouillon (dont la page voit sa version augmenter).
  for (const p of db.prepare("select id, layout from projects where layout like '%video-single%'").all() as { id: number; layout: string }[]) {
    const layout = parse(p.layout);
    if (!migrateVideoModes(layout)) continue;
    db.prepare("update projects set layout = ? where id = ?").run(JSON.stringify(layout), p.id);
    report.layouts++;
  }
  for (const p of db.prepare("select id, draft_layout layout, draft_layout_page_id page from projects where draft_layout like '%video-single%'").all() as { id: number; layout: string; page: number | null }[]) {
    const layout = parse(p.layout);
    if (!migrateVideoModes(layout)) continue;
    db.prepare("update projects set draft_layout = ? where id = ?").run(JSON.stringify(layout), p.id);
    if (p.page !== null) db.prepare("update pages set draft_rev = draft_rev + 1 where id = ?").run(p.page);
    report.draftLayouts++;
  }
  return report;
}
