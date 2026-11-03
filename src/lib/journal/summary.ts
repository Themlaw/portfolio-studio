/**
 * Résumés du journal d'édition (lot 97) : chemins des champs modifiés et valeurs COURTES (80 caractères au plus).
 * Module pur (aucun accès base) : testé par scripts/test-journal97.mjs.
 *
 * Confidentialité : jamais de contenu de média (data:, base64), de mot de passe, de jeton, de e-mail ni de corps de message.
 * Deux filets : par NOM de clé (secretKey) et par FORME de valeur (redact).
 */

export const MAX_VALUE = 80;
const MAX_CHANGES = 20;
const MAX_NODES = 30000;
const MAX_DEPTH = 9;

/** Clés dont la valeur n'est jamais journalisée (le chemin l'est, la valeur devient « [masqué] »). */
const SECRET_KEY = /pass|mot.?de.?passe|token|jeton|secret|cookie|authorization|credential|api.?key|mail|^message$|^body$|^corps$|data.?url|base64|blob|^data$|^file$|^bytes$/i;
export const secretKey = (k: string) => SECRET_KEY.test(k);

const EMAIL = /[^\s@<>"'`,;()]+@[^\s@<>"'`,;()]+\.[^\s@<>"'`,;()]+/g;
const DATA_URI = /data:[a-z0-9.+/-]*;base64,[A-Za-z0-9+/=]+/gi;
const BEARER = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const TOKENISH = /\b(?:sk|pk|ghp|gho|xox[abp]?|eyJ)[A-Za-z0-9_.-]{16,}/g;

/** Masque, dans une chaîne, ce qui ressemble à un secret ou à une donnée personnelle. */
export function redact(s: string): string {
  let out = s.replace(DATA_URI, "[données]").replace(BEARER, "[jeton]").replace(TOKENISH, "[jeton]").replace(EMAIL, "[e-mail]");
  // Longue suite opaque seule (clé, jeton, empreinte) : masquée.
  if (/^[A-Za-z0-9+/_=-]{40,}$/.test(out)) out = "[masqué]";
  return out;
}

/** Valeur courte et sûre : tronquée à 80 caractères APRÈS masquage. */
export function shortValue(v: unknown): string {
  const s = redact(typeof v === "string" ? v : String(v));
  return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s;
}

export type Change = { p: string; a?: string; b?: string; note?: string };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isScalar = (v: unknown): v is string | number | boolean => ["string", "number", "boolean"].includes(typeof v);
const uidOf = (v: unknown): string | null => (isObj(v) && typeof v.uid === "string" ? v.uid : null);
const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

type Acc = { changes: Change[]; total: number; nodes: number };

function push(acc: Acc, c: Change) {
  acc.total++;
  if (acc.changes.length < MAX_CHANGES) acc.changes.push(c);
}

function leaf(v: unknown, key: string): string | undefined {
  if (secretKey(key)) return v === undefined || v === null ? undefined : "[masqué]";
  if (isScalar(v)) return shortValue(v);
  if (v === null) return "null";
  return undefined;
}

function walk(a: unknown, b: unknown, p: string, key: string, depth: number, acc: Acc): void {
  if (a === b) return;
  // Absent et null disent la même chose (le brouillon d'un éditeur porte `wallpaper: null`, un brouillon plus ancien rien).
  if ((a === undefined || a === null) && (b === undefined || b === null)) return;
  if (acc.nodes++ > MAX_NODES || depth > MAX_DEPTH) {
    if (!sameJson(a, b)) push(acc, { p, note: "modifié" });
    return;
  }
  // Pas de comparaison JSON complète à chaque niveau (coût × profondeur) : on descend, les feuilles égales sortent tout de suite.
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      walk(a[k], b[k], p ? `${p}.${k}` : k, k, depth + 1, acc);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const keyed = (arr: unknown[]) => arr.length > 0 && arr.every((x) => uidOf(x) !== null);
    if (keyed(a) && keyed(b)) {
      const A = new Map((a as unknown[]).map((x) => [uidOf(x)!, x]));
      const B = new Map((b as unknown[]).map((x) => [uidOf(x)!, x]));
      const name = (x: unknown, uid: string) => `${isObj(x) && typeof x.type === "string" ? x.type : "élément"}:${uid}`;
      for (const [uid, x] of B) {
        if (!A.has(uid)) push(acc, { p: `${p}[${name(x, uid)}]`, note: "ajouté" });
        else walk(A.get(uid), x, `${p}[${name(x, uid)}]`, "", depth + 1, acc);
      }
      for (const [uid, x] of A) if (!B.has(uid)) push(acc, { p: `${p}[${name(x, uid)}]`, note: "retiré" });
      const common = [...B.keys()].filter((u) => A.has(u));
      if (common.join() !== [...A.keys()].filter((u) => B.has(u)).join()) push(acc, { p, note: "ordre changé" });
      return;
    }
    if (a.length === b.length) {
      for (let i = 0; i < a.length; i++) walk(a[i], b[i], `${p}[${i}]`, key, depth + 1, acc);
      return;
    }
    push(acc, { p, note: `${a.length} → ${b.length} éléments` });
    return;
  }
  const ca: Change = { p };
  const va = leaf(a, key);
  const vb = leaf(b, key);
  if (va !== undefined) ca.a = va;
  if (vb !== undefined) ca.b = vb;
  if (va === undefined && vb === undefined) ca.note = "modifié";
  push(acc, ca);
}

/** Différences entre deux instantanés : chemins + valeurs courtes (20 au plus), `total` = nombre réel. */
export function diffPaths(before: unknown, after: unknown): { changes: Change[]; total: number } {
  const acc: Acc = { changes: [], total: 0, nodes: 0 };
  walk(before, after, "", "", 0, acc);
  return { changes: acc.changes, total: acc.total };
}

/** Résumé d'arguments d'action : chemins aplatis `a.b.c = valeur courte` (12 au plus). Les secrets sont masqués. */
export function flattenValues(value: unknown, prefix = "", out: Change[] = [], depth = 0, key = ""): Change[] {
  if (out.length >= 12 || depth > 5) return out;
  if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      flattenValues(v, prefix ? `${prefix}.${k}` : k, out, depth + 1, k);
    }
  } else if (Array.isArray(value)) {
    if (value.every(isScalar) && value.length <= 8) out.push({ p: prefix || "valeur", b: secretKey(key) ? "[masqué]" : shortValue(value.join(", ")) });
    else out.push({ p: prefix || "valeur", note: `${value.length} éléments` });
  } else if (value !== undefined) {
    out.push({ p: prefix || "valeur", b: leaf(value, key) ?? shortValue(String(value)) });
  }
  return out;
}

/** Message d'erreur sûr pour le journal (masqué, 200 caractères). */
export function safeMessage(m: unknown, max = 200): string {
  const s = redact(String(m ?? "")).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
