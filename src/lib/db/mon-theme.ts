/**
 * Migration de contenu 0028 (lot 60 « Mon thème »), idempotente, jouée juste après le SQL (colonnes `mine`, `based_on`, `version`,
 * `published_version`, `live_data` et table `theme_versions`).
 *
 * Choix (cf. rapport du lot 60) :
 * - le thème EN LIGNE est un thème personnalisé (copie, kit, import…) : il devient « Mon thème », version 1, publiée. Même ligne, même
 *   identifiant, mêmes données : le site public ne change pas d'un pixel. Son nom est gardé s'il a été choisi par l'utilisatrice,
 *   remplacé par « Mon thème » s'il vient de l'ancien système (« Studio (kit 2) ») ; l'ancien nom reste dans le résumé de la version 1 ;
 * - le thème en ligne est un thème FOURNI (modèle) : rien n'est créé ici, Mon thème naît au premier passage (« Utiliser ce modèle », kit,
 *   import, « En faire mon thème »). Raison : un modèle suit le code (syncPresets le met à jour au démarrage) ; en figer une copie à la
 *   migration, sans geste de l'utilisatrice, la couperait des mises à jour du modèle pour rien, et ferait changer le thème actif du site ;
 * - tous les autres thèmes personnalisés restent tels quels (aucune ligne modifiée ni supprimée) : l'écran les range dans « Mes anciens thèmes ».
 *
 * Module sans accès à l'application (lu par le migrateur et les tests Node).
 */
import type Database from "better-sqlite3";

import { PRESETS } from "../../themes/presets";
import { cleanThemeName, ownThemeName } from "../themes/summary";

export type MonThemeReport = { converted: string | null; reason: string };

export function migrateMonTheme(sqlite: Database.Database): MonThemeReport {
  if (sqlite.prepare("select 1 from themes where mine = 1 limit 1").get()) return { converted: null, reason: "Mon thème existe déjà" };
  const setting = sqlite.prepare("select value from settings where key = 'activeThemeId'").get() as { value: string } | undefined;
  let activeId = "";
  try {
    const v = JSON.parse(setting?.value ?? "null");
    if (typeof v === "string") activeId = v;
  } catch {
    /* réglage illisible : traité comme absent */
  }
  if (!activeId) return { converted: null, reason: "aucun thème en ligne enregistré" };
  const row = sqlite.prepare("select id, name, preset, data from themes where id = ?").get(activeId) as { id: string; name: string; preset: number; data: string } | undefined;
  if (!row) return { converted: null, reason: "le thème en ligne n'existe pas en base (le site utilise le thème par défaut)" };
  if (row.preset) return { converted: null, reason: "le thème en ligne est un modèle : Mon thème sera créé au premier passage" };
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(row.data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("pas un objet");
    data = parsed as Record<string, unknown>;
  } catch {
    return { converted: null, reason: "le thème en ligne est illisible : laissé tel quel" };
  }
  const base = cleanThemeName(row.name);
  const preset = Object.values(PRESETS).find((p) => p.name === base);
  const basedOn = preset?.name ?? base;
  const name = ownThemeName(row.name, Object.values(PRESETS).map((p) => p.name));
  const json = name === row.name ? row.data : JSON.stringify({ ...data, name });
  sqlite.prepare("update themes set mine = 1, name = ?, data = ?, based_on = ?, version = 1, published_version = 1, live_data = null where id = ?").run(name, json, basedOn, row.id);
  sqlite
    .prepare("insert or ignore into theme_versions (theme_id, n, data, source, summary, created_at, pinned, sealed) values (?, 1, ?, 'migration', ?, unixepoch(), 1, 0)")
    .run(row.id, json, `Reprise de « ${row.name} »`);
  return { converted: row.id, reason: `thème en ligne personnalisé « ${row.name} » devenu Mon thème (version 1)` };
}
