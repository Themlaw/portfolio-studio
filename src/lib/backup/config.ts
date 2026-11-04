/**
 * Réglages des sauvegardes automatiques (lot 50), lus dans l'environnement. Module pur : aucune E/S.
 *
 *  WITH_BACKUP        1 / true pour activer (absent, 0, false : rien ne change, aucun fichier créé)
 *  BACKUP_QUIET_MIN   minutes sans nouvelle modification avant de sauvegarder (10)
 *  BACKUP_QUIET_SEC   idem en secondes (tests ; prioritaire sur BACKUP_QUIET_MIN)
 *  BACKUP_MAX_HOURS   au plus N heures entre deux sauvegardes tant qu'il y a des modifications (6)
 *  BACKUP_KEEP        nombre de sauvegardes gardées (3)
 *  BACKUP_MEDIA       0 / false : base seule, sans les médias (1)
 *  BACKUP_MAX_DISK_PCT  place totale des sauvegardes, en % de la taille du disque (30, entre 5 et 90). Volontairement absent de
 *                     l'écran de l'admin : une session volée ne doit pas pouvoir s'en servir (audit de sécurité, P6).
 *
 * Lot 76 : l'admin peut surcharger ces réglages (ligne `backup` de la table settings, voir settings.ts). Un réglage de l'admin
 * PRIME sur l'environnement, qui reste la valeur par défaut ; `sources` dit d'où vient chaque valeur.
 */
/** Réglages posés depuis l'admin (chaque champ absent = on retombe sur l'environnement, puis sur le défaut). */
export type BackupOverrides = { enabled?: boolean; keep?: number; quietMin?: number; maxHours?: number; media?: boolean };
export type ConfigSource = "reglage" | "env" | "defaut";
export type BackupSources = Record<keyof BackupOverrides, ConfigSource>;
/** Bornes acceptées depuis l'admin. */
export const LIMITS = { keep: { min: 1, max: 30 }, quietMin: { min: 1, max: 1440 }, maxHours: { min: 1, max: 720 } } as const;

export type BackupConfig = {
  enabled: boolean;
  quietMs: number;
  maxMs: number;
  keep: number;
  media: boolean;
  /** Place totale des sauvegardes, en % de la taille du disque (environnement seul). */
  maxDiskPct: number;
  /** Intervalle de la minuterie (ms) : fin par rapport au délai de quiétude le plus court. */
  pollMs: number;
  warnings: string[];
  /** D'où vient chaque valeur : réglage de l'admin, variable d'environnement ou valeur par défaut. */
  sources: BackupSources;
};

export const DEFAULTS = { quietMin: 10, maxHours: 6, keep: 3, maxDiskPct: 30 } as const;
export const DISK_PCT = { min: 5, max: 90 } as const;

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

/** Réglages enregistrés (JSON de la base) : tout champ absent ou hors bornes est ignoré, jamais d'exception. */
export function sanitizeOverrides(raw: unknown): BackupOverrides {
  const o: BackupOverrides = {};
  if (!raw || typeof raw !== "object") return o;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number, integer = false) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v)) ? v : undefined);
  if (typeof r.enabled === "boolean") o.enabled = r.enabled;
  if (typeof r.media === "boolean") o.media = r.media;
  const keep = num(r.keep, LIMITS.keep.min, LIMITS.keep.max, true);
  if (keep !== undefined) o.keep = keep;
  const quiet = num(r.quietMin, 0.05, LIMITS.quietMin.max);
  if (quiet !== undefined) o.quietMin = quiet;
  const max = num(r.maxHours, 0.05, LIMITS.maxHours.max);
  if (max !== undefined) o.maxHours = max;
  return o;
}

export function readBackupConfig(env: Record<string, string | undefined> = process.env, overrides: BackupOverrides = {}): BackupConfig {
  const warnings: string[] = [];
  const envEnabled = on(env.WITH_BACKUP);
  if (!envEnabled && env.WITH_BACKUP !== undefined && !off(env.WITH_BACKUP) && env.WITH_BACKUP.trim() !== "") {
    warnings.push(`WITH_BACKUP=${JSON.stringify(env.WITH_BACKUP)} non reconnu : sauvegardes désactivées (utilise 1 ou true)`);
  }
  const quietSec = env.BACKUP_QUIET_SEC !== undefined && env.BACKUP_QUIET_SEC.trim() !== "" ? positive("BACKUP_QUIET_SEC", env.BACKUP_QUIET_SEC, 0, warnings) : 0;
  const envQuietMs = quietSec > 0 ? quietSec * 1000 : positive("BACKUP_QUIET_MIN", env.BACKUP_QUIET_MIN, DEFAULTS.quietMin, warnings) * 60_000;
  const envMaxMs = positive("BACKUP_MAX_HOURS", env.BACKUP_MAX_HOURS, DEFAULTS.maxHours, warnings) * 3_600_000;
  const envKeep = positive("BACKUP_KEEP", env.BACKUP_KEEP, DEFAULTS.keep, warnings, true);
  const envMedia = !off(env.BACKUP_MEDIA);
  let maxDiskPct = positive("BACKUP_MAX_DISK_PCT", env.BACKUP_MAX_DISK_PCT, DEFAULTS.maxDiskPct, warnings);
  if (maxDiskPct < DISK_PCT.min || maxDiskPct > DISK_PCT.max) {
    warnings.push(`BACKUP_MAX_DISK_PCT=${JSON.stringify(env.BACKUP_MAX_DISK_PCT)} hors bornes (${DISK_PCT.min} à ${DISK_PCT.max}) : valeur par défaut (${DEFAULTS.maxDiskPct}) utilisée`);
    maxDiskPct = DEFAULTS.maxDiskPct;
  }

  const given = (v: string | undefined) => v !== undefined && v.trim() !== "";
  const sources: BackupSources = {
    enabled: overrides.enabled !== undefined ? "reglage" : on(env.WITH_BACKUP) || off(env.WITH_BACKUP) ? "env" : "defaut",
    keep: overrides.keep !== undefined ? "reglage" : given(env.BACKUP_KEEP) && warnings.every((w) => !w.startsWith("BACKUP_KEEP")) ? "env" : "defaut",
    quietMin:
      overrides.quietMin !== undefined
        ? "reglage"
        : (given(env.BACKUP_QUIET_SEC) && quietSec > 0) || (given(env.BACKUP_QUIET_MIN) && warnings.every((w) => !w.startsWith("BACKUP_QUIET_MIN")))
          ? "env"
          : "defaut",
    maxHours: overrides.maxHours !== undefined ? "reglage" : given(env.BACKUP_MAX_HOURS) && warnings.every((w) => !w.startsWith("BACKUP_MAX_HOURS")) ? "env" : "defaut",
    media: overrides.media !== undefined ? "reglage" : on(env.BACKUP_MEDIA) || off(env.BACKUP_MEDIA) ? "env" : "defaut",
  };
  const enabled = overrides.enabled ?? envEnabled;
  const quietMs = overrides.quietMin !== undefined ? overrides.quietMin * 60_000 : envQuietMs;
  const maxMs = overrides.maxHours !== undefined ? overrides.maxHours * 3_600_000 : envMaxMs;
  const keep = overrides.keep ?? envKeep;
  const media = overrides.media ?? envMedia;
  // Une vérification par quart du délai de quiétude, entre 0,5 s et 30 s : une lecture de PRAGMA, quasi gratuite.
  const pollMs = Math.min(30_000, Math.max(500, Math.floor(Math.min(quietMs, maxMs) / 4)));
  return { enabled, quietMs, maxMs, keep, media, maxDiskPct, pollMs, warnings, sources };
}

export function describeConfig(c: BackupConfig, dir: string): string {
  const quiet = c.quietMs % 60_000 === 0 ? `${c.quietMs / 60_000} min` : `${c.quietMs / 1000} s`;
  const max = c.maxMs % 3_600_000 === 0 ? `${c.maxMs / 3_600_000} h` : `${Math.round(c.maxMs / 60_000)} min`;
  return `sauvegardes activées : après ${quiet} sans modification ou au plus ${max} après la précédente, ${c.keep} gardée(s) (plus la dernière de plus de 48 h et 3 manuelles, ${c.maxDiskPct} % du disque au plus), ${c.media ? "médias inclus" : "base seule (BACKUP_MEDIA=0)"}, dossier ${dir}`;
}
