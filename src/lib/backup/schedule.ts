/**
 * Logique de déclenchement et de rotation des sauvegardes (lot 50). Pas d'accès disque ni à la base ici :
 * tout passe par des dépendances injectées, ce qui permet de la tester avec une horloge simulée.
 */
import type { BackupConfig } from "./config";

export const ARCHIVE_RE = /^portfolio-(\d{8})-(\d{6})(?:-(\d+))?\.tar\.gz$/;

const p2 = (n: number) => String(n).padStart(2, "0");

/** portfolio-AAAAMMJJ-HHMMSS.tar.gz (heure locale du processus ; UTC dans le conteneur). */
export function archiveName(date: Date, suffix = 0): string {
  const d = `${date.getFullYear()}${p2(date.getMonth() + 1)}${p2(date.getDate())}`;
  const t = `${p2(date.getHours())}${p2(date.getMinutes())}${p2(date.getSeconds())}`;
  return `portfolio-${d}-${t}${suffix ? `-${suffix}` : ""}.tar.gz`;
}

/** Noms d'archives valides, de la plus ancienne à la plus récente. */
export function sortArchives(names: string[]): string[] {
  const key = (n: string) => {
    const m = ARCHIVE_RE.exec(n)!;
    return `${m[1]}${m[2]}${String(m[3] ?? 0).padStart(4, "0")}`;
  };
  return names.filter((n) => ARCHIVE_RE.test(n)).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** Instant (ms) d'une archive d'après son nom (heure locale du processus, comme `archiveName`), null si le nom n'est pas valide. */
export function archiveInstant(name: string): number | null {
  const m = ARCHIVE_RE.exec(name);
  if (!m) return null;
  const d = m[1];
  const t = m[2];
  return new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)).getTime();
}

const parisFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
/** Jour civil à Paris (AAAA-MM-JJ) d'un instant. */
export const parisDay = (ms: number): string => parisFmt.format(new Date(ms));

/** Les `days` derniers jours civils à Paris, aujourd'hui compris. */
export function lastParisDays(now: number, days: number): string[] {
  const [y, m, d] = parisDay(now).split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < days; i++) out.push(new Date(Date.UTC(y, m - 1, d - i, 12)).toISOString().slice(0, 10));
  return out;
}

export type Retention = { name: string; kind: "recente" | "jour"; day: string };

/**
 * Lot 118 : conservation. On garde (1) les `keep` dernières sauvegardes, (2) la DERNIÈRE de chacun des `days` derniers jours civils
 * à Paris (aujourd'hui compris). Tout le reste est à supprimer. Une sauvegarde manuelle compte comme les autres. N'efface jamais
 * tout : keep >= 1. `days` = 0 : seulement les `keep` dernières (comportement d'avant).
 */
export function retentionPlan(names: string[], keep: number, days = 0, now = Date.now()): { kept: Retention[]; doomed: string[] } {
  const sorted = sortArchives(names);
  const n = Math.max(1, Math.floor(keep));
  const recent = new Set(sorted.slice(Math.max(0, sorted.length - n)));
  const window = new Set(days > 0 ? lastParisDays(now, Math.floor(days)) : []);
  const lastOfDay = new Map<string, string>();
  for (const name of sorted) {
    const at = archiveInstant(name);
    if (at === null) continue;
    const day = parisDay(at);
    if (window.has(day)) lastOfDay.set(day, name);
  }
  const daily = new Set(lastOfDay.values());
  const kept: Retention[] = [];
  const doomed: string[] = [];
  for (const name of sorted) {
    const day = parisDay(archiveInstant(name) ?? 0);
    if (recent.has(name)) kept.push({ name, kind: "recente", day });
    else if (daily.has(name)) kept.push({ name, kind: "jour", day });
    else doomed.push(name);
  }
  return { kept, doomed };
}

/** Archives à supprimer (voir `retentionPlan`). */
export function rotationPlan(names: string[], keep: number, days = 0, now = Date.now()): string[] {
  return retentionPlan(names, keep, days, now).doomed;
}

/** Date d'une archive lue dans son nom (heure locale du processus, comme `archiveName`) ; null si le nom n'en est pas une. */
export function archiveDate(name: string): Date | null {
  const m = ARCHIVE_RE.exec(name);
  if (!m) return null;
  const [d, t] = [m[1], m[2]];
  const date = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Rétention (P1/P6 de l'audit de sécurité) : une session admin volée ne doit pas pouvoir effacer toutes les sauvegardes d'avant
 * l'intrusion (régler « garder 1 » puis lancer « Sauvegarder maintenant »), ni remplir le disque.
 */
export const RETENTION = {
  /** Âge au-delà duquel la plus récente archive est protégée de toute rotation, quel que soit `keep`. */
  protectAgeMs: 48 * 3_600_000,
  /** Sauvegardes manuelles gardées (réserve à part : elles ne poussent jamais dehors une sauvegarde automatique). */
  manualKeep: 3,
} as const;

export type ArchiveInfo = { name: string; size: number; manual: boolean };

/**
 * Archives à supprimer. Règles, dans cet ordre :
 *  - sauvegardes automatiques (et d'origine inconnue) : les `keep` plus récentes ;
 *  - sauvegardes manuelles : les `RETENTION.manualKeep` plus récentes, comptées À PART (« Sauvegarder maintenant » en boucle ne
 *    fait tourner que cette réserve) ;
 *  - toujours gardées, quoi qu'il arrive : la plus récente de toutes, et la plus récente de celles qui ont plus de 48 h ;
 *  - plafond de place (`maxBytes`) : au-delà, on retire les plus anciennes NON protégées jusqu'à repasser dessous (les deux
 *    archives protégées restent, même si elles dépassent à elles seules : le journal le signale).
 */
export function securityRetentionPlan(archives: ArchiveInfo[], opts: { keep: number; now: number; maxBytes?: number; manualKeep?: number; protectAgeMs?: number; extraKeep?: Iterable<string> }): string[] {
  const byName = new Map(archives.filter((a) => ARCHIVE_RE.test(a.name)).map((a) => [a.name, a]));
  const sorted = sortArchives([...byName.keys()]).map((n) => byName.get(n)!);
  if (!sorted.length) return [];
  const keepAuto = Math.max(1, Math.floor(opts.keep));
  const keepManual = Math.max(1, Math.floor(opts.manualKeep ?? RETENTION.manualKeep));
  const age = opts.protectAgeMs ?? RETENTION.protectAgeMs;
  const protectedNames = new Set<string>([sorted[sorted.length - 1].name]);
  const old = sorted.filter((a) => {
    const d = archiveDate(a.name);
    return d !== null && opts.now - d.getTime() >= age;
  });
  if (old.length) protectedNames.add(old[old.length - 1].name);
  const kept = new Set(protectedNames);
  for (const a of sorted.filter((x) => !x.manual).slice(-keepAuto)) kept.add(a.name);
  for (const a of sorted.filter((x) => x.manual).slice(-keepManual)) kept.add(a.name);
  // Conservées par une autre règle (lot 118 : la dernière de chaque jour) : gardées, mais le plafond de place peut encore les retirer.
  for (const n of opts.extraKeep ?? []) if (byName.has(n)) kept.add(n);
  if (opts.maxBytes !== undefined && Number.isFinite(opts.maxBytes)) {
    let total = sorted.filter((a) => kept.has(a.name)).reduce((n, a) => n + a.size, 0);
    for (const a of sorted) {
      if (total <= opts.maxBytes) break;
      if (!kept.has(a.name) || protectedNames.has(a.name)) continue;
      kept.delete(a.name);
      total -= a.size;
    }
  }
  return sorted.filter((a) => !kept.has(a.name)).map((a) => a.name);
}

export type DueReason = "premier" | "calme" | "delai" | "manuel";

export type SchedState = {
  /** Des modifications n'ont pas encore été sauvegardées. */
  dirty: boolean;
  /** Date (ms) de la dernière modification vue. */
  lastChangeAt: number;
  /** Date (ms) de la dernière sauvegarde terminée ; null = aucune n'existe. */
  lastBackupAt: number | null;
  /** Pas de nouvel essai avant cette date (ms) : après un échec. */
  notBefore: number;
  /** Date (ms) du dernier geste d'édition de l'artiste (activity.ts) ; 0 = aucun depuis le démarrage. */
  lastUserAt?: number;
  /** Date (ms) à laquelle les modifications en attente ont commencé (lot 118) ; absente = lastChangeAt. */
  dirtySince?: number;
};

/**
 * Un geste de l'artiste accompagne les modifications en attente. Marge : la vérification suit le geste de quelques secondes
 * (au plus une minute, au plus la moitié de la quiétude : des écritures de fond bien après un geste ne comptent pas).
 */
const userPending = (s: SchedState, c: Pick<BackupConfig, "quietMs">) => (s.lastUserAt ?? 0) > 0 && (s.lastUserAt ?? 0) >= (s.dirtySince ?? s.lastChangeAt) - Math.min(60_000, c.quietMs / 2);

/** Faut-il sauvegarder maintenant ? Aucune modification = aucune sauvegarde, sauf la toute première. */
export function dueReason(s: SchedState, now: number, c: Pick<BackupConfig, "quietMs" | "maxMs">): DueReason | null {
  if (now < s.notBefore) return null;
  if (s.lastBackupAt === null) return "premier";
  if (!s.dirty) return null;
  if (now - s.lastChangeAt >= c.quietMs) return "calme";
  // Lot 118 : l'artiste travaille sans pause de `quietMs` : ses modifications en attente depuis `maxMs` (1 h) partent quand même.
  // Sans geste de l'artiste (écritures de fond seules), pas de sauvegarde « délai » : la règle de calme reste la seule.
  if (userPending(s, c) && now - (s.dirtySince ?? s.lastChangeAt) >= c.maxMs) return "delai";
  return null;
}

/**
 * Date (ms) de la prochaine sauvegarde prévue, ou null quand rien n'est prévu (aucune modification en attente).
 * `immediate` : la première sauvegarde part dès la prochaine vérification.
 */
export function nextDueAt(s: SchedState, c: Pick<BackupConfig, "quietMs" | "maxMs">): number | null {
  const floor = s.notBefore;
  if (s.lastBackupAt === null) return floor;
  if (!s.dirty) return null;
  const delai = userPending(s, c) ? (s.dirtySince ?? s.lastChangeAt) + c.maxMs : Infinity;
  return Math.max(floor, Math.min(s.lastChangeAt + c.quietMs, delai));
}

export type SchedulerDeps = {
  /** Lu à CHAQUE vérification : les réglages de l'admin changent en cours de route. */
  config: Pick<BackupConfig, "quietMs" | "maxMs">;
  now: () => number;
  /** Une écriture a-t-elle eu lieu depuis le dernier appel ? */
  changed: () => boolean;
  /** Fait la sauvegarde ; lève en cas d'échec ou de renoncement (espace insuffisant…). */
  run: (reason: DueReason) => Promise<void>;
  /** Mémorise l'état « modifications en attente » (survit à un redémarrage). */
  persist?: (s: { dirty: boolean; lastChangeAt: number }) => void;
  onError?: (error: unknown) => void;
  /** Sauvegardes automatiques en marche ? Désactivées, les modifications sont quand même relevées (rien n'est oublié à la réactivation). */
  enabled?: () => boolean;
  /** Date (ms) du dernier geste d'édition de l'artiste (lot 118). */
  userActivity?: () => number;
  /** Durée au-delà de laquelle une sauvegarde en cours est tenue pour bloquée (lot 118) ; 30 min par défaut. */
  runTimeoutMs?: number;
};

/** Défaut de `runTimeoutMs` : une sauvegarde de plusieurs Go prend quelques minutes, jamais une demi-heure. */
export const RUN_TIMEOUT_MS = 30 * 60_000;

export type Health = { kind: "retard" | "minuterie" | "bloquee"; message: string; since: number };

/** Attente après un échec : au moins une minute, jamais plus que le délai maximal. */
export const failureCooldownMs = (c: Pick<BackupConfig, "quietMs" | "maxMs">) => Math.min(c.maxMs, Math.max(60_000, c.quietMs));

export class Scheduler {
  state: SchedState;
  private running = false;
  /** Dernière vérification faite (ms) : la surveillance s'en sert pour déceler une minuterie arrêtée. */
  lastTickAt = 0;
  /** Modifications vues depuis la dernière sauvegarde, et date de la première (ms) : diagnostic du « bruit ». */
  changesSince = 0;
  dirtySince = 0;
  runStartedAt = 0;

  constructor(
    private readonly deps: SchedulerDeps,
    initial: { dirty: boolean; lastChangeAt: number; lastBackupAt: number | null },
  ) {
    this.state = { ...initial, notBefore: 0, lastUserAt: 0, dirtySince: initial.dirty ? initial.lastChangeAt : undefined };
  }

  get busy() {
    return this.running;
  }

  /** Une vérification : relève les modifications, puis lance la sauvegarde si c'est le moment. */
  async tick(): Promise<DueReason | null> {
    const { deps } = this;
    const now = deps.now();
    this.lastTickAt = now;
    // Horloge reculée (resynchronisation) : une date « dans le futur » ne doit pas repousser la sauvegarde indéfiniment.
    if (this.state.lastChangeAt > now) this.state.lastChangeAt = now;
    const user = Math.min(deps.userActivity?.() ?? 0, now);
    if (user > (this.state.lastUserAt ?? 0)) this.state.lastUserAt = user;
    if (deps.changed()) {
      const wasDirty = this.state.dirty;
      this.state.dirty = true;
      this.state.lastChangeAt = now;
      this.changesSince++;
      if (!wasDirty || !this.dirtySince) this.dirtySince = now;
      if (!wasDirty) this.state.dirtySince = now;
      // Écrit à chaque transition seulement (la date de calme se lit ensuite en mémoire).
      if (!wasDirty) deps.persist?.({ dirty: true, lastChangeAt: now });
    }
    if (this.running || (deps.enabled && !deps.enabled())) return null;
    const reason = dueReason(this.state, now, deps.config);
    if (!reason) return null;
    await this.execute(reason);
    return reason;
  }

  /**
   * Sauvegarde à la demande (bouton « Sauvegarder maintenant ») : sans attendre les délais, mais avec le même verrou.
   * Retourne false si une sauvegarde est déjà en cours. L'échec est relevé par onError ET relancé à l'appelant.
   */
  async runNow(reason: DueReason = "manuel"): Promise<boolean> {
    if (this.running) return false;
    await this.execute(reason, true);
    return true;
  }

  private async execute(reason: DueReason, rethrow = false): Promise<void> {
    const { deps } = this;
    this.running = true;
    this.runStartedAt = deps.now();
    // Les modifications qui arrivent PENDANT la sauvegarde la rendront de nouveau « à faire ».
    const wasDirty = this.state.dirty;
    const pendingSince = this.state.dirtySince;
    this.state.dirty = false;
    this.state.dirtySince = undefined;
    if (wasDirty) deps.persist?.({ dirty: false, lastChangeAt: this.state.lastChangeAt });
    try {
      await this.withTimeout(deps.run(reason));
      this.state.lastBackupAt = deps.now();
      this.state.notBefore = 0;
      this.changesSince = 0;
      this.dirtySince = 0;
    } catch (error) {
      // Échec : on réessaiera plus tard, sans rien perdre de ce qui était en attente.
      this.state.dirty = this.state.dirty || wasDirty;
      if (wasDirty && pendingSince !== undefined) this.state.dirtySince = Math.min(pendingSince, this.state.dirtySince ?? pendingSince);
      this.state.notBefore = deps.now() + failureCooldownMs(deps.config);
      if (this.state.dirty) deps.persist?.({ dirty: true, lastChangeAt: this.state.lastChangeAt });
      deps.onError?.(error);
      if (rethrow) throw error;
    } finally {
      this.running = false;
      this.runStartedAt = 0;
    }
  }

  /** Une promesse qui ne se résout jamais ne doit pas garder le verrou « en cours » pour toujours (lot 118). */
  private withTimeout(p: Promise<void>): Promise<void> {
    const ms = this.deps.runTimeoutMs ?? RUN_TIMEOUT_MS;
    let timer: NodeJS.Timeout;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`la sauvegarde ne se termine pas (plus de ${Math.round(ms / 60_000)} min) : abandonnée, nouvel essai plus tard`)), ms);
      timer.unref?.();
    });
    return Promise.race([p, limit]).finally(() => clearTimeout(timer));
  }

  /**
   * Surveillance (lot 118) : null si tout va bien, sinon ce qui cloche. `retard` : une sauvegarde est due depuis plus de `grace` ms et
   * ne part pas ; `bloquee` : une sauvegarde dure trop longtemps ; `minuterie` : plus aucune vérification depuis `grace` ms.
   */
  health(now: number, grace: number): Health | null {
    const { deps } = this;
    if (deps.enabled && !deps.enabled()) return null;
    if (this.running) {
      const limit = (deps.runTimeoutMs ?? RUN_TIMEOUT_MS) + grace;
      return this.runStartedAt && now - this.runStartedAt > limit ? { kind: "bloquee", message: "Une sauvegarde est en cours depuis très longtemps : elle semble bloquée.", since: this.runStartedAt } : null;
    }
    if (this.lastTickAt && now - this.lastTickAt > grace) {
      return { kind: "minuterie", message: "Le déclencheur des sauvegardes automatiques ne tourne plus.", since: this.lastTickAt };
    }
    // Date due SANS l'attente après un échec : une sauvegarde qui échoue en boucle (disque plein, dossier en lecture seule) est « due
    // et pas faite » aussi.
    const at = nextDueAt({ ...this.state, notBefore: 0 }, deps.config);
    if (at !== null && now - at > grace) {
      return { kind: "retard", message: "Une sauvegarde automatique aurait dû avoir lieu et n'a pas eu lieu.", since: at };
    }
    return null;
  }
}
