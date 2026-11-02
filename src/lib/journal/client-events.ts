/**
 * Événements du navigateur reçus par POST /api/log (lot 97) : erreurs JS non rattrapées, rejets de promesses, échecs
 * d'enregistrement (refus, conflit, réseau). Tout ce qui arrive est NON FIABLE : forme vérifiée, tailles bornées, secrets masqués.
 */
import { appVersion, pageTitle as titleOf } from "./audit";
import { writeEntry, type EntryResult, type NewEntry } from "./store";
import { safeMessage } from "./summary";

export const MAX_BODY_BYTES = 8 * 1024;
const KINDS = ["error", "rejection", "save"] as const;
type ClientKind = (typeof KINDS)[number];
const SAVE_REASONS: Record<string, EntryResult> = { refus: "refus", conflit: "conflit", reseau: "erreur", erreur: "erreur" };

const KIND_LABEL: Record<ClientKind, string> = { error: "Erreur du navigateur", rejection: "Promesse rejetée dans le navigateur", save: "Enregistrement impossible" };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, n: number) => (typeof v === "string" ? safeMessage(v, n) : "");

/** Limite de débit : 40 événements par minute et par utilisateur, 200 au total. */
const buckets = new Map<string, { start: number; n: number }>();
export function allowClientEvent(user: string, now = Date.now()): boolean {
  for (const key of [user, "*"]) {
    const limit = key === "*" ? 200 : 40;
    const b = buckets.get(key);
    if (!b || now - b.start >= 60_000) buckets.set(key, { start: now, n: 1 });
    else if (++b.n > limit) return false;
  }
  if (buckets.size > 500) buckets.clear();
  return true;
}
export const resetClientLimit = () => buckets.clear();

/** Valide et enregistre un événement du navigateur. Renvoie false si la forme est invalide. */
export function ingestClientEvent(user: string, body: unknown): boolean {
  if (!isObj(body)) return false;
  const kind = KINDS.find((k) => k === body.kind);
  if (!kind) return false;
  const message = str(body.message, 200);
  if (!message && kind !== "save") return false;
  const path = str(body.path, 160).replace(/\?.*$/, "");
  const clientVersion = str(body.clientVersion, 32) || "inconnue";
  const pageIdRaw = Number(body.pageId);
  const pageId = Number.isInteger(pageIdRaw) && pageIdRaw > 0 ? pageIdRaw : null;
  const pageTitle = str(body.pageTitle, 120) || titleOf(pageId);
  const reason = kind === "save" ? SAVE_REASONS[String(body.reason)] ?? "erreur" : "erreur";
  const detail: Record<string, string> = {};
  const stack = str(body.stack, 600);
  if (stack) detail.stack = stack;
  const source = str(body.source, 160);
  if (source) detail.source = source.replace(/\?.*$/, "");
  if (body.line !== undefined && Number.isFinite(Number(body.line))) detail.line = String(Number(body.line));
  if (path) detail.path = path;
  detail.clientVersion = clientVersion;
  if (clientVersion !== appVersion()) detail.versionServeur = appVersion();
  const act = str(body.action, 60);
  if (act) detail.action = act;
  const label = kind === "save" ? `${KIND_LABEL.save}${act ? ` (${act})` : ""}${message ? ` : ${message}` : ""}` : `${KIND_LABEL[kind]} : ${message}`;
  const entry: NewEntry = {
    kind: "client",
    action: `client.${kind}`,
    type: "erreur",
    user,
    pageId,
    page: pageTitle ?? (path || null),
    target: path || null,
    revFrom: null,
    revTo: null,
    result: reason,
    ms: null,
    version: clientVersion,
    label: label.length > 280 ? `${label.slice(0, 279)}…` : label,
    summary: { changes: Object.entries(detail).map(([p, b]) => ({ p, b })), total: Object.keys(detail).length },
  };
  const id = writeEntry(entry);
  console.log(JSON.stringify({ t: "client", at: new Date().toISOString(), a: entry.action, r: entry.result, u: user, v: clientVersion, p: path || undefined, s: entry.label.slice(0, 160), id: id ?? undefined }));
  return true;
}
