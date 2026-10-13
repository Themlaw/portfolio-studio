/**
 * Porte mémoire du worker (module sans dépendance, testable seul).
 *
 * Le conteneur de prod a 1 Gio, serveur compris. Les files « légère » (images) et « lourde » (kits, vidéos,
 * PDF) tournent en parallèle ; mesuré : 556 Mo pour une image de 100 Mpx seule, 579 Mo pour un import de kit
 * seul, 891 Mo pour les deux, et le serveur par-dessus dépasse la limite (OOM). Un import ou un export de kit
 * (« kit ») et le traitement d'une image lourde (« image ») s'excluent donc mutuellement : un seul des deux
 * tient la porte à la fois, les arrivants attendent leur tour (ordre d'arrivée). Les images légères ne passent
 * pas par ici.
 */
export type GateKind = "kit" | "image";

export interface MemoryGate {
  /** Exécute `fn` quand la porte est libre ; la libère ensuite, même sur erreur. */
  run<T>(kind: GateKind, fn: () => Promise<T>): Promise<T>;
  /** Genre de la tâche qui tient la porte, ou null. */
  holder(): GateKind | null;
  /** Genres en attente, dans l'ordre d'arrivée. */
  waiting(): GateKind[];
  /** Appelé (hors pile) à chaque libération : le worker y relève ses files. */
  onRelease(listener: () => void): void;
}

/** MEMORY_GATE=0 : porte désactivée (mesures comparatives « avant / après » ; jamais en production). */
const disabled = () => process.env.MEMORY_GATE === "0";
export const memoryGateEnabled = () => !disabled();

export function createMemoryGate(): MemoryGate {
  let holder: GateKind | null = null;
  const queue: { kind: GateKind; go: () => void }[] = [];
  const listeners: (() => void)[] = [];

  const release = () => {
    holder = null;
    const next = queue.shift();
    if (next) {
      holder = next.kind;
      next.go();
    }
    setImmediate(() => {
      for (const l of listeners) {
        try {
          l();
        } catch (error) {
          console.error("[jobs] porte mémoire : écouteur en erreur", error);
        }
      }
    });
  };

  return {
    async run<T>(kind: GateKind, fn: () => Promise<T>): Promise<T> {
      if (disabled()) return fn();
      const asked = Date.now();
      const label = kind === "kit" ? "kit" : "image lourde";
      if (holder !== null) {
        console.log(`[jobs] mémoire : ${label} attend la fin d'un${holder === "kit" ? " kit" : "e image lourde"}`);
        await new Promise<void>((go) => queue.push({ kind, go }));
      } else holder = kind;
      const started = Date.now();
      if (started - asked > 0) console.log(`[jobs] mémoire : ${label} démarre après ${started - asked} ms d'attente`);
      else console.log(`[jobs] mémoire : ${label} démarre`);
      try {
        return await fn();
      } finally {
        console.log(`[jobs] mémoire : ${label} terminé en ${Date.now() - started} ms`);
        release();
      }
    },
    holder: () => holder,
    waiting: () => queue.map((w) => w.kind),
    onRelease: (listener) => {
      listeners.push(listener);
    },
  };
}

const G = globalThis as typeof globalThis & { __portfolioMemoryGate?: MemoryGate };

/** Porte unique du processus (Next charge parfois ce module plusieurs fois). */
export function memoryGate(): MemoryGate {
  G.__portfolioMemoryGate ??= createMemoryGate();
  return G.__portfolioMemoryGate;
}
