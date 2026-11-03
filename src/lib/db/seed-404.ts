/**
 * Migration de données du lot 89 : la page spéciale « Page introuvable » (slug `_404`), créée au démarrage, JAMAIS par SQL.
 *
 * Idempotente : elle ne fait rien si une ligne de slug `_404` existe déjà (corbeille comprise) — une 404 que l'artiste a modifiée n'est
 * jamais recréée ni écrasée. Une sauvegarde restaurée d'avant le lot n'a pas la ligne : le site retombe sur la 404 d'origine
 * (`NotFoundView`) et le démarrage suivant la recrée. Appelée par bootstrap.ts, dans la transaction de démarrage, après les migrations et
 * le seed (l'accueil garde le plus petit identifiant).
 *
 * Contenu initial = la 404 d'avant, bloc pour bloc : UN bloc « Sortie » (`exit`) avec les textes de messages/{fr,en}.json (clé `notFound`).
 * Le bloc rend exactement le balisage de `NotFoundView` : sans modification, le rendu public est identique au pixel.
 *
 * Module sans accès à l'application (lu par le migrateur et les tests Node).
 */
import type Database from "better-sqlite3";

import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { NOT_FOUND_SLUG, NOT_FOUND_TITLE } from "../special-pages";

type L = { fr: string; en: string };
const l = (a: string, b: string): L => ({ fr: a, en: b });

/** Propriétés du bloc « Sortie » d'origine : les textes actuels de la 404, dans les deux langues. */
export function initialExitProps(): Record<string, unknown> {
  return {
    eyebrow: l(fr.notFound.eyebrow, en.notFound.eyebrow),
    title: l(fr.notFound.title, en.notFound.title),
    messages: [l(fr.notFound.body, en.notFound.body)],
    label: l(fr.notFound.back, en.notFound.back),
  };
}

export type NotFoundSeedReport = { created: boolean; id: number | null };

export function seedNotFoundPage(db: Database.Database): NotFoundSeedReport {
  const existing = db.prepare("select id from pages where json_extract(slug, '$.fr') = ? or json_extract(slug, '$.en') = ? limit 1").get(NOT_FOUND_SLUG, NOT_FOUND_SLUG) as { id: number } | undefined;
  if (existing) return { created: false, id: existing.id };
  const title = JSON.stringify(NOT_FOUND_TITLE);
  const row = db
    .prepare("insert into pages (slug, title, meta, nav_order, published) values (?, ?, ?, null, 1)")
    .run(JSON.stringify({ fr: NOT_FOUND_SLUG, en: NOT_FOUND_SLUG }), title, JSON.stringify({ title: NOT_FOUND_TITLE, description: { fr: "", en: "" } }));
  const id = Number(row.lastInsertRowid);
  db.prepare("insert into blocks (page_id, position, type, props) values (?, 0, 'exit', ?)").run(id, JSON.stringify(initialExitProps()));
  return { created: true, id };
}
