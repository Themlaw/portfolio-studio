/**
 * Réglages des sauvegardes automatiques (lot 50), lus dans l'environnement. Module pur : aucune E/S.
 *
 *  WITH_BACKUP        1 / true pour activer (absent, 0, false : rien ne change, aucun fichier créé)
 *  BACKUP_QUIET_MIN   minutes sans nouvelle modification avant de sauvegarder (10)
 *  BACKUP_QUIET_SEC   idem en secondes (tests ; prioritaire sur BACKUP_QUIET_MIN)
 *  BACKUP_MAX_HOURS   au plus N heures entre deux sauvegardes tant qu'il y a des modifications (6)
 *  BACKUP_KEEP        nombre de sauvegardes gardées (3)
 *  BACKUP_MEDIA       0 / false : base seule, sans les médias (1)
 */
export type BackupConfig = {
  enabled: boolean;
  quietMs: number;
  maxMs: number;
  keep: number;
  media: boolean;
  /** Intervalle de la minuterie (ms) : fin par rapport au délai de quiétude le plus court. */
  pollMs: number;
  warnings: string[];
};

export const DEFAULTS = { quietMin: 10, maxHours: 6, keep: 3 } as const;

const on = (v: string | undefined) => v !== undefined && ["1", "true", "yes", "oui", "on"].includes(v.trim().toLowerCase());
const off = (v: string | undefined) => v !== undefined && ["0", "false", "no", "non", "off"].includes(v.trim().toLowerCase());

function positive(name: string, raw: string | undefined, fallback: number, warnings: string[], integer = false): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) {
    warnings.push(`${name}=${JSON.stringify(raw)} invalide : valeur par défaut (${fallback}) utilisée`);
    return fallback;
  }
  return n;
}

export function readBackupConfig(env: Record<string, string | undefined> = process.env): BackupConfig {
  const warnings: string[] = [];
  const enabled = on(env.WITH_BACKUP);
  if (!enabled && env.WITH_BACKUP !== undefined && !off(env.WITH_BACKUP) && env.WITH_BACKUP.trim() !== "") {
    warnings.push(`WITH_BACKUP=${JSON.stringify(env.WITH_BACKUP)} non reconnu : sauvegardes désactivées (utilise 1 ou true)`);
  }
  const quietSec = env.BACKUP_QUIET_SEC !== undefined && env.BACKUP_QUIET_SEC.trim() !== "" ? positive("BACKUP_QUIET_SEC", env.BACKUP_QUIET_SEC, 0, warnings) : 0;
  const quietMs = quietSec > 0 ? quietSec * 1000 : positive("BACKUP_QUIET_MIN", env.BACKUP_QUIET_MIN, DEFAULTS.quietMin, warnings) * 60_000;
  const maxMs = positive("BACKUP_MAX_HOURS", env.BACKUP_MAX_HOURS, DEFAULTS.maxHours, warnings) * 3_600_000;
  const keep = positive("BACKUP_KEEP", env.BACKUP_KEEP, DEFAULTS.keep, warnings, true);
  const media = !off(env.BACKUP_MEDIA);
  // Une vérification par quart du délai de quiétude, entre 0,5 s et 30 s : une lecture de PRAGMA, quasi gratuite.
  const pollMs = Math.min(30_000, Math.max(500, Math.floor(Math.min(quietMs, maxMs) / 4)));
  return { enabled, quietMs, maxMs, keep, media, pollMs, warnings };
}

export function describeConfig(c: BackupConfig, dir: string): string {
  const quiet = c.quietMs % 60_000 === 0 ? `${c.quietMs / 60_000} min` : `${c.quietMs / 1000} s`;
  const max = c.maxMs % 3_600_000 === 0 ? `${c.maxMs / 3_600_000} h` : `${Math.round(c.maxMs / 60_000)} min`;
  return `sauvegardes activées : après ${quiet} sans modification ou au plus ${max} après la précédente, ${c.keep} gardée(s), ${c.media ? "médias inclus" : "base seule (BACKUP_MEDIA=0)"}, dossier ${dir}`;
}
