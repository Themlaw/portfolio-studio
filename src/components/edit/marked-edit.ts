/**
 * Édition en place d'un texte à passage surligné (l'accroche de l'ouverture).
 *
 * Le rendu (`Marked`, vue brouillon) pose le contenu dans UNE enveloppe
 * (`[data-marked-body]`) que React gère : on n'y touche jamais. L'édition et
 * l'aperçu vivent à côté, dans des éléments à nous (`[data-marked-edit]`,
 * `[data-marked-over]`) ; l'enveloppe de React est seulement cachée. Retirer
 * les nôtres rend donc EXACTEMENT l'état d'origine (refus, échec, Échap).
 *
 * Le surlignage est un modèle de passages (src/lib/marked.ts, module pur) :
 * la sélection est convertie en positions dans le texte brut, le modèle est
 * modifié, puis le champ est reconstruit. Le texte saisi est toujours lu comme
 * du TEXTE (nœuds texte, `textContent`) : aucun HTML n'entre ni ne sort.
 */
import { isMarkedRange, parseMarked, plainOf, toggleRange, toMarkup, wordAt, type MarkedPart } from "@/lib/marked";

/** Longueur maximale de l'accroche envoyée (celle du message `text`) ; coupée sur le texte, jamais dans une balise. */
const MARKUP_MAX = 2000;

export const BODY = "[data-marked-body]";

/** Passages → nœuds du DOM (texte, et `.hero-mark` pour un passage surligné). */
export function markedNodes(parts: MarkedPart[], doc: Document = document): Node[] {
  return parts.map((p) => {
    if (!p.mark) return doc.createTextNode(p.text);
    const span = doc.createElement("span");
    span.className = "hero-mark";
    span.textContent = p.text;
    return span;
  });
}

/** Passages lus dans le DOM : `.hero-mark` = surligné, le reste du texte ; `<br>` = espace. */
export function partsOf(root: Node): MarkedPart[] {
  const parts: MarkedPart[] = [];
  const walk = (node: Node, mark: boolean) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) parts.push({ text: (child.nodeValue ?? "").replace(/\s*\n\s*/g, " "), mark });
      else if (child instanceof HTMLElement) {
        if (child.tagName === "BR") parts.push({ text: " ", mark });
        else walk(child, mark || child.classList.contains("hero-mark"));
      }
    }
  };
  walk(root, false);
  return parts;
}

/** Texte tel que le serveur le recevra (lu dans l'élément : champ, aperçu ou enveloppe de React). */
export const markupOf = (root: Node): string => toMarkup(partsOf(root), MARKUP_MAX);

/** Position dans le texte brut du point (nœud, décalage) de `root`. */
function plainOffset(root: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(root);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** Sélection courante en positions du texte brut de `root`, ou null (hors du champ). */
export function selectionRange(root: Node): [number, number] | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  return [plainOffset(root, r.startContainer, r.startOffset), plainOffset(root, r.endContainer, r.endOffset)];
}

/** Sélectionne [from, to[ (positions du texte brut) dans `root`. */
export function selectRange(root: Node, from: number, to: number) {
  const find = (target: number): [Node, number] => {
    let seen = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const len = n.nodeValue?.length ?? 0;
      if (target <= seen + len) return [n, target - seen];
      seen += len;
      last = n;
    }
    return last ? [last, last.nodeValue?.length ?? 0] : [root, 0];
  };
  const [a, ao] = find(from);
  const [b, bo] = find(to);
  const range = document.createRange();
  range.setStart(a, ao);
  range.setEnd(b, bo);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Intervalle visé par « Surligner » : la sélection, ou le mot sous le curseur si elle est vide. */
function target(editor: HTMLElement): [number, number] | null {
  const range = selectionRange(editor);
  if (!range) return null;
  const [a, b] = range;
  if (a !== b) return [Math.min(a, b), Math.max(a, b)];
  const [s, e] = wordAt(plainOf(partsOf(editor)), a);
  return s < e ? [s, e] : null;
}

/** État du bouton : null = rien à surligner (curseur hors d'un mot), sinon « le passage visé est déjà surligné ». */
export function markState(editor: HTMLElement): boolean | null {
  const t = target(editor);
  return t ? isMarkedRange(partsOf(editor), t[0], t[1]) : null;
}

/** Surligne le passage visé, ou retire le surlignage s'il l'est déjà. Renvoie false s'il n'y avait rien à faire. */
export function toggleMark(editor: HTMLElement): boolean {
  const t = target(editor);
  if (!t) return false;
  const parts = partsOf(editor);
  const next = toggleRange(parts, t[0], t[1]);
  if (next === parts) return false;
  editor.replaceChildren(...markedNodes(next));
  selectRange(editor, t[0], t[1]);
  return true;
}

export type MarkedEditor = { host: HTMLElement; body: HTMLElement; editor: HTMLElement; before: string };

/** Ouvre le champ à côté de l'enveloppe de React (cachée) ; null si l'élément n'a pas la forme attendue. */
export function openMarkedEditor(host: HTMLElement): MarkedEditor | null {
  const body = host.querySelector<HTMLElement>(`:scope > ${BODY}`);
  if (!body) return null;
  const over = host.querySelector<HTMLElement>(":scope > [data-marked-over]");
  // Ce qui est affiché : l'aperçu en attente s'il y en a un, sinon le rendu de React.
  const before = over?.dataset.markup ?? markupOf(body);
  const editor = document.createElement("span");
  editor.setAttribute("data-marked-edit", "");
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-label", "Phrase d'accroche");
  editor.setAttribute("aria-multiline", "false");
  editor.replaceChildren(...markedNodes(parseMarked(before)));
  try {
    editor.contentEditable = "plaintext-only";
  } catch {
    editor.contentEditable = "true";
  }
  body.after(editor);
  body.style.display = "none";
  if (over) over.style.display = "none";
  // Collage : du texte, jamais de mise en forme ni de HTML.
  editor.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/[<>]/g, "").replace(/\s*\n\s*/g, " ");
    if (text) document.execCommand("insertText", false, text);
  });
  editor.addEventListener("beforeinput", (e) => {
    if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak" || e.inputType === "insertFromDrop") e.preventDefault();
  });
  return { host, body, editor, before };
}

/** Referme le champ : l'enveloppe de React (et l'aperçu éventuel) reparaît, intacte. */
export function closeMarkedEditor(m: MarkedEditor) {
  m.editor.remove();
  const over = m.host.querySelector<HTMLElement>(":scope > [data-marked-over]");
  // Un aperçu en attente reste seul affiché (l'enveloppe de React est cachée tant qu'il existe).
  if (over) over.style.display = "";
  else m.body.style.display = "";
}
