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
};

/** Faut-il sauvegarder maintenant ? Aucune modification = aucune sauvegarde, sauf la toute première. */
export function dueReason(s: SchedState, now: number, c: Pick<BackupConfig, "quietMs" | "maxMs">): DueReason | null {
  if (now < s.notBefore) return null;
  if (s.lastBackupAt === null) return "premier";
  if (!s.dirty) return null;
  if (now - s.lastChangeAt >= c.quietMs) return "calme";
  if (now - s.lastBackupAt >= c.maxMs) return "delai";
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
  return Math.max(floor, Math.min(s.lastChangeAt + c.quietMs, s.lastBackupAt + c.maxMs));
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
};

/** Attente après un échec : au moins une minute, jamais plus que le délai maximal. */
export const failureCooldownMs = (c: Pick<BackupConfig, "quietMs" | "maxMs">) => Math.min(c.maxMs, Math.max(60_000, c.quietMs));

export class Scheduler {
  state: SchedState;
  private running = false;

  constructor(
    private readonly deps: SchedulerDeps,
    initial: { dirty: boolean; lastChangeAt: number; lastBackupAt: number | null },
  ) {
    this.state = { ...initial, notBefore: 0 };
  }

  get busy() {
    return this.running;
  }

  /** Une vérification : relève les modifications, puis lance la sauvegarde si c'est le moment. */
  async tick(): Promise<DueReason | null> {
    const { deps } = this;
    const now = deps.now();
    if (deps.changed()) {
      const wasDirty = this.state.dirty;
      this.state.dirty = true;
      this.state.lastChangeAt = now;
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
    // Les modifications qui arrivent PENDANT la sauvegarde la rendront de nouveau « à faire ».
    const wasDirty = this.state.dirty;
    this.state.dirty = false;
    if (wasDirty) deps.persist?.({ dirty: false, lastChangeAt: this.state.lastChangeAt });
    try {
      await deps.run(reason);
      this.state.lastBackupAt = deps.now();
      this.state.notBefore = 0;
    } catch (error) {
      // Échec : on réessaiera plus tard, sans rien perdre de ce qui était en attente.
      this.state.dirty = this.state.dirty || wasDirty;
      this.state.notBefore = deps.now() + failureCooldownMs(deps.config);
      if (this.state.dirty) deps.persist?.({ dirty: true, lastChangeAt: this.state.lastChangeAt });
      deps.onError?.(error);
      if (rethrow) throw error;
    } finally {
      this.running = false;
    }
  }
}
