/**
 * Textes sans traduction anglaise (lot 52, PAGES-04) : ce que le site public montrerait en français (ou pas du tout)
 * sur la version anglaise d'une page. Module pur : liste des pages, avertissement à la publication, tests.
 *
 * Un texte localisé est un objet `{ fr, en }` : il compte quand le français est rempli et l'anglais vide.
 * Le titre de la page compte aussi (il sert de titre d'onglet et de lien de menu en anglais).
 */
type L = { fr: string; en: string };

const isL = (v: unknown): v is L => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  return keys.length === 2 && typeof o.fr === "string" && typeof o.en === "string";
};

function walk(value: unknown, depth: number): number {
  if (depth > 12 || value === null || typeof value !== "object") return 0;
  if (isL(value)) return value.fr.trim() && !value.en.trim() ? 1 : 0;
  const items = Array.isArray(value) ? value : Object.values(value as object);
  return items.reduce<number>((n, v) => n + walk(v, depth + 1), 0);
}

/** Nombre de textes à traduire dans la page : son titre, plus ceux de ses rubriques. */
export function untranslatedCount(title: L, blocks: { props: unknown }[]): number {
  return walk(title, 0) + blocks.reduce((n, b) => n + walk(b.props, 0), 0);
}

/** « 3 textes ne sont pas traduits en anglais. » */
export function untranslatedLabel(n: number): string {
  return n === 1 ? "1 texte n'est pas traduit en anglais" : `${n} textes ne sont pas traduits en anglais`;
}
