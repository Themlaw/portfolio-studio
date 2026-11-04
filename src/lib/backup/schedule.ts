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

/** Archives à supprimer pour n'en garder que `keep` (les plus récentes). N'efface jamais tout : keep >= 1. */
export function rotationPlan(names: string[], keep: number): string[] {
  const sorted = sortArchives(names);
  const n = Math.max(1, Math.floor(keep));
  return sorted.slice(0, Math.max(0, sorted.length - n));
}

export type DueReason = "premier" | "calme" | "delai" | "bruit" | "manuel";

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
};

/**
 * Lot 118 : écart minimal entre deux sauvegardes « bruit » (la base change sans cesse SANS geste de l'artiste : traitements de
 * fond, progressions). 15 min au plus ; 3 fois la quiétude pour les réglages courts (tests).
 */
export const noiseGapMs = (c: Pick<BackupConfig, "quietMs">) => Math.min(900_000, Math.max(3 * c.quietMs, 10_000));

/** Faut-il sauvegarder maintenant ? Aucune modification = aucune sauvegarde, sauf la toute première. */
export function dueReason(s: SchedState, now: number, c: Pick<BackupConfig, "quietMs" | "maxMs">): DueReason | null {
  if (now < s.notBefore) return null;
  if (s.lastBackupAt === null) return "premier";
  if (!s.dirty) return null;
  if (now - s.lastChangeAt >= c.quietMs) return "calme";
  if (now - s.lastBackupAt >= c.maxMs) return "delai";
  // Lot 118 : l'artiste ne touche plus à rien depuis la quiétude, mais la base continue de changer (écritures de fond) : la « calme »
  // ne viendrait jamais. On sauvegarde quand même, au plus une fois par `noiseGapMs`.
  if (s.lastUserAt !== undefined && now - s.lastUserAt >= c.quietMs && now - s.lastBackupAt >= noiseGapMs(c)) return "bruit";
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
  const noise = s.lastUserAt === undefined ? Infinity : Math.max(s.lastUserAt + c.quietMs, s.lastBackupAt + noiseGapMs(c));
  return Math.max(floor, Math.min(s.lastChangeAt + c.quietMs, s.lastBackupAt + c.maxMs, noise));
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
    this.state = { ...initial, notBefore: 0, lastUserAt: 0 };
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
    this.state.dirty = false;
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
