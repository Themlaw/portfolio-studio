/**
 * Côté navigateur (lot 97) : envoie une erreur ou un échec d'enregistrement à POST /api/log. Jamais bloquant, jamais d'exception.
 * Doublons identiques coupés (10 par minute au plus). Aucun contenu de la page n'est envoyé : message, pile, chemin, version.
 */
let windowStart = 0;
let count = 0;
const seen = new Set<string>();

export type ClientReport = {
  kind: "error" | "rejection" | "save";
  message?: string;
  stack?: string;
  source?: string;
  line?: number;
  /** save : refus, conflit, reseau */
  reason?: "refus" | "conflit" | "reseau" | "erreur";
  /** save : nom de l'action (saveDraftAction…) */
  action?: string;
  pageId?: number;
  pageTitle?: string;
};

export function reportToJournal(r: ClientReport): void {
  try {
    const now = Date.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      count = 0;
      seen.clear();
    }
    const key = `${r.kind}|${r.reason ?? ""}|${r.action ?? ""}|${r.message ?? ""}`.slice(0, 300);
    if (seen.has(key) || count >= 10) return;
    seen.add(key);
    count++;
    const fromPath = /^\/admin\/pages\/(\d+)/.exec(location.pathname);
    const body = JSON.stringify({ ...r, pageId: r.pageId ?? (fromPath ? Number(fromPath[1]) : undefined), path: location.pathname, clientVersion: process.env.PORTFOLIO_VERSION ?? "inconnue" });
    if (body.length > 7000) return;
    void fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => undefined);
  } catch {
    // le journal ne casse jamais l'interface
  }
}

/** Écouteurs globaux : erreurs non rattrapées et rejets de promesses. À poser une seule fois (JournalReporter). */
export function installGlobalReporters(): () => void {
  const onError = (e: ErrorEvent) => {
    // Bruits sans conséquence : boucle de ResizeObserver, erreur d'un script d'une autre origine (sans détail).
    if (/ResizeObserver loop|^Script error\.?$/.test(e.message ?? "")) return;
    reportToJournal({ kind: "error", message: e.message, stack: e.error?.stack, source: e.filename, line: e.lineno });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const reason = e.reason as { message?: unknown; stack?: unknown } | string | undefined;
    reportToJournal({ kind: "rejection", message: typeof reason === "string" ? reason : String(reason?.message ?? "rejet sans message"), stack: typeof reason === "object" && typeof reason?.stack === "string" ? reason.stack : undefined });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
