/**
 * Ligne en lecture seule de l'admin (Réglages > Avancé > Diagnostic) : « Dernière sauvegarde : il y a 2 h (3 gardées) ».
 * Null quand les sauvegardes ne sont pas activées (aucune ligne, aucun accès disque).
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { dataDir } from "@/lib/db";

import { BACKUP_DIRNAME } from "./archive";
import { readBackupConfig } from "./config";
import { ARCHIVE_RE, sortArchives } from "./schedule";

/** « il y a 5 min », « il y a 2 h », « il y a 3 jours ». */
export function ageLabel(ms: number): string {
  if (ms < 60_000) return "à l'instant";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} jours`;
}

export function backupSummary(now = Date.now()): string | null {
  if (!readBackupConfig().enabled) return null;
  const dir = path.join(/* turbopackIgnore: true */ dataDir(), BACKUP_DIRNAME);
  let names: string[] = [];
  try {
    names = sortArchives(readdirSync(dir).filter((n) => ARCHIVE_RE.test(n)));
  } catch {
    // dossier pas encore créé
  }
  if (!names.length) return "aucune pour l'instant";
  const last = names[names.length - 1];
  let when = 0;
  try {
    when = statSync(path.join(/* turbopackIgnore: true */ dir, last)).mtimeMs;
  } catch {
    return "aucune pour l'instant";
  }
  return `${ageLabel(now - when)} (${names.length} gardée${names.length > 1 ? "s" : ""})`;
}
