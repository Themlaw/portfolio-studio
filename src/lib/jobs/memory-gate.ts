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
      if (holder !== null) await new Promise<void>((go) => queue.push({ kind, go }));
      else holder = kind;
      try {
        return await fn();
      } finally {
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
