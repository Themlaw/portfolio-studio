/**
 * Texte avec un passage mis en valeur (accroche de l'ouverture) : module PUR,
 * partagé par le rendu (`Marked`), la toile (édition en place) et l'éditeur.
 *
 * Stockage : une chaîne dont SEUL le balisage `<mark>…</mark>` est reconnu
 * (jamais imbriqué, jamais vide) ; aucun autre `<` ou `>`. Aucun HTML n'est
 * jamais interprété : le rendu pose le texte dans des nœuds texte, et le
 * balisage est revalidé ici avant d'entrer dans le brouillon.
 */

export type MarkedPart = { text: string; mark: boolean };

/** Lecture (rendu) : comme avant la v0.16, tolérante pour les données anciennes. */
const READ = /<mark>(.*?)<\/mark>/g;
/** Écriture (validation) : un passage sans « < » ni « > ». */
const MARK = /<mark>([^<>]*)<\/mark>/g;

/** Passages du texte (mis en valeur ou non), comme le rendu les lit. */
export function parseMarked(text: string): MarkedPart[] {
  const parts: MarkedPart[] = [];
  let last = 0;
  for (const m of text.matchAll(READ)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), mark: false });
    if (m[1]) parts.push({ text: m[1], mark: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mark: false });
  return parts;
}

/** Message d'erreur si le balisage n'est pas celui que l'on accepte, sinon null. */
export function markedProblem(text: string): string | null {
  if (/<mark><\/mark>/.test(text)) return "Un passage surligné ne peut pas être vide.";
  const rest = text.replace(MARK, "");
  if (/[<>]/.test(rest)) return "Seul le balisage <mark>…</mark> est accepté (sans imbrication), aucun autre « < » ou « > ».";
  return null;
}

/** Passages → chaîne stockée : passages voisins de même nature fondus, vides retirés, « < » et « > » retirés. */
export function toMarkup(parts: MarkedPart[]): string {
  const merged: MarkedPart[] = [];
  for (const p of parts) {
    const text = p.text.replace(/[<>]/g, "");
    if (!text) continue;
    const last = merged.at(-1);
    if (last && last.mark === p.mark) last.text += text;
    else merged.push({ text, mark: p.mark });
  }
  return merged.map((p) => (p.mark ? `<mark>${p.text}</mark>` : p.text)).join("");
}

/** Texte brut (sans balisage) des passages. */
export const plainOf = (parts: MarkedPart[]): string => parts.map((p) => p.text).join("");

/** Mot autour de la position `at` (lettres, chiffres, apostrophe, trait d'union), ou [at, at]. */
export function wordAt(text: string, at: number): [number, number] {
  const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}'’-]/u.test(c);
  let s = at;
  let e = at;
  while (s > 0 && isWord(text[s - 1])) s--;
  while (e < text.length && isWord(text[e])) e++;
  return [s, e];
}

/**
 * Surligne (ou, si tout le passage l'est déjà, retire le surlignage de) l'intervalle [from, to[
 * du texte brut. Les espaces en bordure de sélection ne sont pas surlignés.
 */
export function toggleRange(parts: MarkedPart[], from: number, to: number): MarkedPart[] {
  const plain = plainOf(parts);
  let s = Math.max(0, Math.min(from, to));
  let e = Math.min(plain.length, Math.max(from, to));
  while (s < e && /\s/.test(plain[s])) s++;
  while (e > s && /\s/.test(plain[e - 1])) e--;
  if (s >= e) return parts;
  const marked: boolean[] = [];
  for (const p of parts) for (let i = 0; i < p.text.length; i++) marked.push(p.mark);
  const all = marked.slice(s, e).every(Boolean);
  for (let i = s; i < e; i++) marked[i] = !all;
  const out: MarkedPart[] = [];
  for (let i = 0; i < plain.length; i++) {
    const last = out.at(-1);
    if (last && last.mark === marked[i]) last.text += plain[i];
    else out.push({ text: plain[i], mark: marked[i] });
  }
  return out;
}

/** Le passage [from, to[ est-il entièrement surligné ? */
export function isMarkedRange(parts: MarkedPart[], from: number, to: number): boolean {
  const flags: boolean[] = [];
  for (const p of parts) for (let i = 0; i < p.text.length; i++) flags.push(p.mark);
  const seg = flags.slice(Math.min(from, to), Math.max(from, to));
  return seg.length > 0 && seg.every(Boolean);
}
