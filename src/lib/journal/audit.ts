/**
 * Enveloppe commune du journal d'édition (lot 97) : UN point central, pas une ligne par action.
 *
 * - `audited(nom, action)` enveloppe une server action d'ÉCRITURE ; `auditedRoute(nom, handler)` une route d'écriture.
 *   Les lectures ne sont pas enveloppées (aucun bruit).
 * - Chaque appel produit une entrée : heure, utilisateur (identifiant interne), page / cible, type, version avant → après,
 *   résultat (ok, refus, conflit, erreur), durée, version de l'application, et un résumé de ce qui change (summary.ts).
 * - Une ligne JSON courte part sur stdout (`{"t":"edit",…}`, pour `docker logs`) ; l'entrée est écrite dans la base du journal
 *   (store.ts). Coût sur le chemin de la requête : une lecture du brouillon avant `saveDraftAction` (état d'avant) et la mise en file ;
 *   le résumé, le titre de la page et l'écriture SQLite se font APRÈS la réponse (`after` de Next) : l'artiste ne les attend pas.
 *   Champs stdout `aud` (ms sur le chemin de la requête) et `bg` (ms en différé).
 * - Tout est dans des try/catch : le journal ne casse JAMAIS l'action.
 * - Sécurité (docs/SECURITE.md §2.7, P5) : un refus SANS session (un anonyme qui appelle une action) n'écrit RIEN en base (une ligne
 *   stdout agrégée par minute) : il ne fait plus tourner le journal. Par utilisateur, les entrées détaillées sont limitées en débit
 *   (USER_BURST, puis USER_PER_MINUTE) ; au-delà, l'action s'exécute normalement, stdout garde la ligne et une entrée de synthèse
 *   dit combien d'écritures n'ont pas été détaillées. `recordEvent` journalise ce qui n'est pas une server action : connexions,
 *   échecs, changement de mot de passe, téléchargements.
 */
import { eq } from "drizzle-orm";
import { after } from "next/server";

import { getDb, schema } from "@/lib/db";

import { SPECS, type Spec } from "./catalog";
import { auditStore, type AuditCtx } from "./context";
import { describeChanges, sentence } from "./human";
import { writeEntry, type EntryResult, type EntryType, type NewEntry } from "./store";
import { diffPaths, flattenValues, safeMessage, type Change } from "./summary";

export const appVersion = () => process.env.PORTFOLIO_VERSION ?? "inconnue";

type Fn = (...args: never[]) => Promise<unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

export function pageTitle(id: number | null): string | null {
  if (id === null) return null;
  try {
    const r = getDb().select({ title: schema.pages.title }).from(schema.pages).where(eq(schema.pages.id, id)).get();
    return r?.title?.fr || (r ? `n° ${id}` : `n° ${id} (supprimée)`);
  } catch {
    return null;
  }
}

/** Erreurs de contrôle de flux de Next (redirect, forbidden…) : pas des pannes. */
function controlFlow(error: unknown): { result: EntryResult; reason: string } | null {
  const digest = isObj(error) && typeof error.digest === "string" ? error.digest : "";
  if (digest.startsWith("NEXT_REDIRECT")) return { result: "ok", reason: "redirection" };
  if (digest.includes("403")) return { result: "refus", reason: "accès refusé" };
  if (digest.includes("401")) return { result: "refus", reason: "session absente" };
  if (digest.includes("404")) return { result: "refus", reason: "introuvable" };
  return null;
}

type Outcome = { result: EntryResult; reason: string | null; revTo: number | null; data: unknown };

function outcomeOf(res: unknown): Outcome {
  if (isObj(res) && res.ok === false) {
    const code = typeof res.code === "string" ? res.code : "";
    const reason = typeof res.message === "string" ? safeMessage(res.message, 120) : null;
    return { result: code === "conflict" ? "conflit" : "refus", reason: code === "corrupt" ? "brouillon illisible" : reason, revTo: num(res.rev), data: null };
  }
  if (isObj(res) && res.ok === true) {
    const data = isObj(res.data) ? res.data : null;
    return { result: "ok", reason: null, revTo: data ? num(data.rev) : null, data };
  }
  return { result: "ok", reason: null, revTo: null, data: null };
}

function stdout(e: NewEntry, id: number | null, aud: number, bg: number) {
  const line: Record<string, unknown> = { t: e.kind === "client" ? "client" : "edit", at: new Date().toISOString(), a: e.action, type: e.type, r: e.result };
  if (e.user) line.u = e.user;
  if (e.pageId !== null) line.page = e.pageId;
  if (e.revFrom !== null || e.revTo !== null) line.rev = `${e.revFrom ?? "?"}>${e.revTo ?? "?"}`;
  if (e.ms !== null) line.ms = Math.round(e.ms * 10) / 10;
  line.v = e.version;
  line.aud = Math.round(aud * 100) / 100;
  line.bg = Math.round(bg * 100) / 100;
  line.s = e.label.length > 160 ? `${e.label.slice(0, 159)}…` : e.label;
  if (id !== null) line.id = id;
  console.log(JSON.stringify(line));
}

function buildEntry(name: string, spec: Spec | undefined, args: unknown[], ctx: AuditCtx, out: Outcome, ms: number, before: unknown): NewEntry {
  const s: Spec = spec ?? { label: name, type: "modification" };
  const pageId = s.page !== undefined ? num(args[s.page]) : null;
  const page = pageTitle(pageId);
  const revFrom = s.rev !== undefined ? num(args[s.rev]) : null;
  let target: string | null = null;
  if (s.target !== undefined) {
    const t = args[s.target];
    if (typeof t === "string" || typeof t === "number") target = String(t).slice(0, 80);
  }
  let changes: Change[] = [];
  let total = 0;
  let what = s.label;
  if (out.result === "ok") {
    if (s.diff && before !== undefined && isObj(args[s.diff.arg])) {
      const d = diffPaths(before, args[s.diff.arg]);
      changes = d.changes;
      total = d.total;
    } else if (s.diff && before === undefined && isObj(args[s.diff.arg])) {
      // Premier enregistrement : pas de brouillon avant ; on dit combien de blocs le brouillon porte.
      const blocks = (args[s.diff.arg] as { blocks?: unknown }).blocks;
      changes = [{ p: "blocks", note: Array.isArray(blocks) ? `premier brouillon, ${blocks.length} blocs` : "premier brouillon" }];
      total = 1;
      what = "Brouillon créé";
    } else if (s.diffResult && isObj(out.data) && out.data.before !== undefined && out.data.after !== undefined) {
      const d = diffPaths(out.data.before, out.data.after);
      changes = d.changes;
      total = d.total;
    }
    if (s.diff || s.diffResult) {
      if (total === 0 && what === s.label) what = `${s.label} (aucun champ changé)`;
      else if (total > 0 && what === s.label) what = describeChanges(changes);
    }
  }
  if (!changes.length) {
    const idx = s.values ?? args.map((_, i) => i).filter((i) => i !== s.page && i !== s.rev && i !== s.target);
    for (const i of idx) {
      if (i < args.length) {
        const flat = flattenValues(args[i], idx.length > 1 ? `arg${i}` : "");
        for (const c of flat) if (changes.length < 12) changes.push(c);
      }
    }
    total = changes.length;
  }
  if (isObj(out.data) && name === "publishDraftAction") {
    const d = out.data;
    changes.push({ p: "résultat", b: `${num(d.blocks) ?? "?"} blocs${d.site ? ", site" : ""}${d.wentLive ? ", mise en ligne" : ""}` });
  }
  const label = sentence({ what, page, state: out.result === "ok" ? s.state ?? null : null, result: out.result, reason: out.reason });
  return {
    kind: "action",
    action: name,
    type: s.type,
    user: ctx.user,
    pageId,
    page,
    target,
    revFrom,
    revTo: out.result === "ok" ? out.revTo : out.result === "conflit" ? out.revTo : null,
    result: out.result,
    ms,
    version: appVersion(),
    label,
    summary: { changes, total, ...(out.reason ? { reason: out.reason } : {}) },
  };
}

/** Travaux différés en attente (tests : `flushAudit`). */
const pending = new Set<Promise<void>>();

/**
 * Exécute la fabrication et l'écriture de l'entrée APRÈS la réponse (`after` de Next ; hors requête, au tour suivant) : l'artiste n'attend
 * ni le résumé, ni SQLite. Jamais d'exception.
 */
function defer(task: () => void | Promise<void>): void {
  const job = async () => {
    try {
      await task();
    } catch (error) {
      console.error("[journal] entrée non écrite :", (error as Error).message);
    }
  };
  try {
    after(job);
  } catch {
    const p = new Promise<void>((resolve) => setImmediate(() => void job().finally(resolve)));
    pending.add(p);
    void p.finally(() => pending.delete(p));
  }
}

/** Attend les entrées en cours d'écriture (tests uniquement : en production `after` s'en charge). */
export async function flushAudit(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

/* ---- débit ------------------------------------------------------------------------------------------------------------------ */

/** Rafale d'entrées détaillées permise à un utilisateur, puis débit soutenu (par minute). */
export const USER_BURST = 300;
export const USER_PER_MINUTE = 60;
/** Entrées anonymes (échecs de connexion) détaillées par heure ; au-delà, une synthèse. */
export const ANON_PER_HOUR = 20;

type Bucket = { tokens: number; at: number; skipped: number };
const buckets = new Map<string, Bucket>();
let anon = { from: 0, written: 0, skipped: 0 };
let anonRefusals = { from: 0, n: 0, actions: new Set<string>() };

/** Jeton d'écriture pour cet utilisateur (seau qui se remplit de USER_PER_MINUTE par minute, plafonné à USER_BURST). */
function takeToken(user: string, now: number): Bucket & { ok: boolean } {
  const b = buckets.get(user) ?? { tokens: USER_BURST, at: now, skipped: 0 };
  b.tokens = Math.min(USER_BURST, b.tokens + ((now - b.at) * USER_PER_MINUTE) / 60_000);
  b.at = now;
  buckets.delete(user);
  buckets.set(user, b);
  if (buckets.size > 1000) buckets.delete(buckets.keys().next().value as string);
  if (b.tokens < 1) return { ...b, ok: false };
  b.tokens -= 1;
  return { ...b, ok: true };
}

/** Tests : remet les compteurs de débit à zéro. */
export function resetAuditLimits(): void {
  buckets.clear();
  anon = { from: 0, written: 0, skipped: 0 };
  anonRefusals = { from: 0, n: 0, actions: new Set() };
}

/** `what` : [singulier, pluriel], accord compris (« écriture non détaillée », « échecs de connexion non détaillés »). */
function synthesis(user: string | null, n: number, what: [string, string]): NewEntry {
  return {
    kind: "action",
    action: "journal:debit",
    type: "erreur",
    user,
    pageId: null,
    page: null,
    target: null,
    revFrom: null,
    revTo: null,
    result: "refus",
    ms: null,
    version: appVersion(),
    label: `${n} ${n > 1 ? what[1] : what[0]} dans le journal (débit dépassé ; voir stdout)`,
    summary: { changes: [{ p: "non détaillées", b: String(n) }], total: 1 },
  };
}

/**
 * Refus SANS session (`forbidden()` / 401 avant `assertAdmin` réussi) : aucune ligne en base. stdout : la première ligne de chaque
 * minute, puis une ligne de synthèse `{"t":"edit-anon","n":…}` à la minute suivante.
 */
function anonRefusal(action: string, now = Date.now()) {
  if (now - anonRefusals.from > 60_000) {
    if (anonRefusals.n > 1) console.log(JSON.stringify({ t: "edit-anon", at: new Date(now).toISOString(), n: anonRefusals.n, a: [...anonRefusals.actions].slice(0, 10) }));
    anonRefusals = { from: now, n: 0, actions: new Set() };
    console.log(JSON.stringify({ t: "edit-anon", at: new Date(now).toISOString(), n: 1, a: [action] }));
  }
  anonRefusals.n++;
  if (anonRefusals.actions.size < 50) anonRefusals.actions.add(action);
}

/** Écrit l'entrée et la ligne stdout. `aud` : ms pris sur le chemin de la requête ; `bg` : ms pris en différé. */
function record(e: NewEntry, aud: number, bgStart: number, now = Date.now()) {
  let id: number | null = null;
  if (e.user) {
    const t = takeToken(e.user, now);
    if (t.ok) {
      if (t.skipped > 0) {
        writeEntry(synthesis(e.user, t.skipped, ["écriture non détaillée", "écritures non détaillées"]), now);
        buckets.get(e.user)!.skipped = 0;
      }
      id = writeEntry(e, now);
    } else buckets.get(e.user)!.skipped++;
  } else if (e.kind === "action" && e.result === "refus" && e.action.startsWith("auth:")) {
    // Échec de connexion (anonyme par nature) : ANON_PER_HOUR entrées détaillées par heure, puis une synthèse.
    if (now - anon.from > 3600_000) {
      if (anon.skipped > 0) writeEntry(synthesis(null, anon.skipped, ["échec de connexion non détaillé", "échecs de connexion non détaillés"]), now);
      anon = { from: now, written: 0, skipped: 0 };
    }
    if (anon.written < ANON_PER_HOUR) {
      anon.written++;
      id = writeEntry(e, now);
    } else anon.skipped++;
  } else id = writeEntry(e, now);
  stdout(e, id, aud, performance.now() - bgStart);
}

/** Refus sans session : `assertAdmin()` n'a inscrit personne et l'action a été arrêtée (403 / 401). */
const anonymousRefusal = (ctx: AuditCtx, out: Outcome, status: number | null) =>
  ctx.user === null && out.result === "refus" && (status === 401 || status === 403 || out.reason === "accès refusé" || out.reason === "session absente");

/**
 * Événement hors server action (connexion, échec, changement de mot de passe, téléchargement) : même entrée, même ligne stdout,
 * mêmes limites de débit. Jamais d'exception ; jamais d'e-mail ni de secret (le libellé est écrit par l'appelant, l'IP n'y entre pas).
 */
export function recordEvent(ev: { action: string; type: EntryType; user: string | null; result: EntryResult; label: string; target?: string | null; reason?: string | null }): void {
  try {
    const e: NewEntry = {
      kind: "action",
      action: ev.action,
      type: ev.type,
      user: ev.user,
      pageId: null,
      page: null,
      target: ev.target ?? null,
      revFrom: null,
      revTo: null,
      result: ev.result,
      ms: null,
      version: appVersion(),
      label: ev.label,
      summary: { changes: [], total: 0, ...(ev.reason ? { reason: safeMessage(ev.reason, 120) } : {}) },
    };
    record(e, 0, performance.now());
  } catch (error) {
    console.error("[journal] événement non écrit :", (error as Error).message);
  }
}

/** Enveloppe une server action d'écriture. Le type de la fonction est conservé tel quel. */
export function audited<F extends Fn>(name: string, fn: F): F {
  const wrapped = async (...args: unknown[]) => {
    // Catalogue lu à l'appel, pas à la définition : les fichiers d'actions s'évaluent parfois avant lui (imports circulaires).
    const spec = SPECS[name];
    const ctx: AuditCtx = { user: null };
    const t0 = performance.now();
    let captured: unknown;
    if (spec?.diff) {
      try {
        captured = spec.diff.capture(args);
      } catch {
        captured = undefined;
      }
    }
    const capMs = performance.now() - t0;
    let res: unknown;
    let thrown: unknown;
    let threw = false;
    try {
      res = await auditStore.run(ctx, () => (fn as unknown as (...a: unknown[]) => Promise<unknown>)(...args));
    } catch (error) {
      threw = true;
      thrown = error;
    }
    const a0 = performance.now();
    const ms = a0 - t0 - capMs;
    // `audMs` : part du journal sur le chemin de la requête (capture d'avant + mise en file) ; complété juste après `defer`, lu en différé.
    let audMs = capMs;
    defer(async () => {
      const b0 = performance.now();
      let out: Outcome;
      if (threw) {
        const flow = controlFlow(thrown);
        out = flow ? { result: flow.result, reason: flow.reason, revTo: null, data: null } : { result: "erreur", reason: safeMessage((thrown as Error)?.message ?? thrown), revTo: null, data: null };
      } else out = outcomeOf(res);
      let before: unknown;
      if (spec?.diff && out.result === "ok") {
        try {
          before = await spec.diff.resolve(captured, args);
        } catch {
          before = undefined;
        }
      }
      if (anonymousRefusal(ctx, out, null)) return anonRefusal(name);
      record(buildEntry(name, spec, args, ctx, out, ms, before), audMs, b0);
    });
    audMs = capMs + (performance.now() - a0);
    if (threw) throw thrown;
    return res;
  };
  return wrapped as unknown as F;
}

/** Enveloppe un gestionnaire de route d'écriture (POST, PUT, DELETE). `name` : clé « route:… » du catalogue. */
export function auditedRoute<F extends (request: Request, ...rest: never[]) => Promise<Response>>(name: string, fn: F): F {
  const key = `route:${name}`;
  const wrapped = async (request: Request, ...rest: unknown[]) => {
    const spec = SPECS[key];
    const ctx: AuditCtx = { user: null };
    const t0 = performance.now();
    let res: Response | undefined;
    let thrown: unknown;
    let threw = false;
    try {
      res = await auditStore.run(ctx, () => (fn as unknown as (r: Request, ...a: unknown[]) => Promise<Response>)(request, ...rest));
    } catch (error) {
      threw = true;
      thrown = error;
    }
    const a0 = performance.now();
    const ms = a0 - t0;
    // Copie du corps d'erreur JSON prise tout de suite (le flux de la réponse part vers le navigateur) ; lue en différé.
    const copy = !threw && res!.status >= 400 && (res!.headers.get("content-type") ?? "").includes("json") ? res!.clone() : null;
    const status = threw ? 0 : res!.status;
    const path = new URL(request.url).pathname;
    let audMs = 0;
    defer(async () => {
      const b0 = performance.now();
      let out: Outcome;
      let message: string | null = null;
      if (threw) {
        const flow = controlFlow(thrown);
        out = flow ? { result: flow.result, reason: flow.reason, revTo: null, data: null } : { result: "erreur", reason: safeMessage((thrown as Error)?.message ?? thrown), revTo: null, data: null };
      } else {
        if (copy) {
          try {
            const body = (await copy.json()) as { message?: unknown };
            if (typeof body?.message === "string") message = safeMessage(body.message, 120);
          } catch {
            message = null;
          }
        }
        out = { result: status < 400 ? "ok" : status === 409 ? "conflit" : status >= 500 ? "erreur" : "refus", reason: message ?? (status >= 400 ? `HTTP ${status}` : null), revTo: null, data: null };
      }
      if (anonymousRefusal(ctx, out, status)) return anonRefusal(key);
      const e = buildEntry(key, spec, [], ctx, out, ms, undefined);
      e.summary = { changes: [{ p: "route", b: `${request.method} ${path}` }, ...(status ? [{ p: "statut", b: String(status) }] : [])], total: 1, ...(out.reason ? { reason: out.reason } : {}) };
      record(e, audMs, b0);
    });
    audMs = performance.now() - a0;
    if (threw) throw thrown;
    return res!;
  };
  return wrapped as unknown as F;
}
