/**
 * Texte avec un passage mis en valeur (accroche de l'ouverture) : module PUR,
 * partagé par le rendu (`Marked`), la toile (édition en place) et l'éditeur.
 *
 * Stockage : une chaîne dont SEUL le balisage `<mark>…</mark>` est reconnu
 * (jamais imbriqué, jamais vide) ; rien d'autre qui ressemble à une balise (`<` suivi
 * d'une lettre ou de `/`). Un `<` ou un `>` isolé (« I <3 ») reste du texte. Aucun HTML
 * n'est jamais interprété : le rendu pose le texte dans des nœuds texte, et le
 * balisage est revalidé ici avant d'entrer dans le brouillon.
 */

export type MarkedPart = { text: string; mark: boolean };

/** Lecture (rendu) : comme avant la v0.16, tolérante pour les données anciennes. */
const READ = /<mark>(.*?)<\/mark>/g;
/** Ce qui ressemble à une balise (ouvrante ou fermante). */
const TAGLIKE = /<\/?[a-z]/i;
/** Écriture (validation) : un passage dont le contenu ne ressemble à aucune balise. */
const MARK = /<mark>((?:(?!<\/?[a-zA-Z])[\s\S])*?)<\/mark>/g;

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
  // Séparateur neutre (et non une chaîne vide) : « a <<mark>b</mark>c » ne doit pas recoller « < » et « c » en fausse balise.
  const rest = text.replace(MARK, "\u0000");
  if (TAGLIKE.test(rest)) return "Seul le balisage <mark>…</mark> est accepté (sans imbrication), aucune autre balise.";
  return null;
}

/** Texte sans ce qui ressemblerait à une balise (« < » suivi d'une lettre ou de « / ») ; « I <3 » est gardé. */
function noTags(text: string): string {
  let out = text;
  // Jusqu'à stabilité : retirer un « < » peut en rapprocher un autre d'une lettre (« <</b »).
  while (TAGLIKE.test(out)) out = out.replace(/<(?=\/?[a-zA-Z])/g, "");
  return out;
}

/** Début du texte d'au plus `len` unités, coupé sur une frontière de graphème (jamais au milieu d'un émoji). */
function cutGraphemes(text: string, len: number): string {
  let end = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    if (end + segment.length > len) break;
    end += segment.length;
  }
  return text.slice(0, end);
}

/**
 * Passages → chaîne stockée : passages voisins de même nature fondus, vides retirés, ce qui ressemblerait
 * à une balise retiré. `max` : longueur maximale de la chaîne ; le surplus est coupé dans le TEXTE de la
 * fin (jamais au milieu d'une balise : le résultat reste valide).
 */
export function toMarkup(parts: MarkedPart[], max = Infinity): string {
  const merged: MarkedPart[] = [];
  for (const p of parts) {
    if (!p.text) continue;
    const last = merged.at(-1);
    if (last && last.mark === p.mark) last.text += p.text;
    else merged.push({ text: p.text, mark: p.mark });
  }
  // Après la fusion : deux passages voisins ne peuvent pas recomposer une balise.
  for (const p of merged) p.text = noTags(p.text);
  const kept = merged.filter((p) => p.text);
  const render = () => kept.map((p) => (p.mark ? `<mark>${p.text}</mark>` : p.text)).join("");
  let out = render();
  while (out.length > max && kept.length) {
    const last = kept[kept.length - 1];
    last.text = cutGraphemes(last.text, Math.max(0, last.text.length - (out.length - max)));
    if (!last.text) kept.pop();
    out = render();
  }
  return out;
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
