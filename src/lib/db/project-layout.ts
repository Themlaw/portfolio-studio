/**
 * Migration de contenu 0025 (lot 31), idempotente : chaque projet existant reçoit la suite de composants
 * [Images qui défilent], c'est-à-dire exactement la planche d'avant (en-tête, puis la bande d'images). Seuls les projets
 * sans suite (`layout` NULL) sont touchés : relancée, elle ne change plus rien, et une suite déjà réglée n'est jamais
 * remplacée. Aucune surcouche de brouillon n'existe avant ce lot (`draft_layout` vient d'être ajoutée) : rien à réécrire
 * côté brouillons. Un projet créé plus tard sans suite se lit pareil (`readLayout`, src/blocks/board-layout.ts).
 *
 * Module sans accès à l'application (lu par le migrateur et les tests Node).
 */
import type Database from "better-sqlite3";

const DEFAULT = JSON.stringify([{ uid: "strip", type: "strip", props: {} }]);

/** Nombre de projets réécrits. */
export function seedProjectLayouts(sqlite: Database.Database): number {
  return sqlite.prepare("UPDATE projects SET layout = ? WHERE layout IS NULL").run(DEFAULT).changes;
}
