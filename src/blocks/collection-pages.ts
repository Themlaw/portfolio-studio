/**
 * Entrées des collections : pages de collection et sélection automatique (lot 22).
 *
 * Une page de collection est une page PUBLIÉE dont le réglage « Cette page est la collection » est posé
 * (`pages.collection` : characters, backgrounds ou animation ; une collection n'a qu'une page). Sa tuile reprend
 * les textes de son premier bloc Titre. Module pur (aucun import) : lu par le bloc (rendu), l'éditeur (client),
 * la migration 0022 et les tests Node.
 */

export type L = { fr: string; en: string };
export type CollectionKey = "characters" | "backgrounds" | "animation";
export const COLLECTION_KEYS: readonly CollectionKey[] = ["characters", "backgrounds", "animation"];

/** Tuiles au plus (même borne en manuel et en automatique). */
export const MAX_TILES = 24;

/** Page de collection et ce que sa tuile en reprend. */
export type CollectionPage = { pageId: number; collection: CollectionKey; eyebrow: L; title: L; intro: L };

/**
 * Textes d'une tuile modifiés sur la tuile (automatique) : gardés, attachés à la page. `mediaId` (lot 26) : couverture
 * choisie sur la tuile (une image de la médiathèque) à la place de celle de la collection ; absent = la couverture de la collection.
 */
export type TileEdit = { pageId: number; eyebrow?: L; title?: L; intro?: L; mediaId?: number };
export type TileItem = { collection: CollectionKey; pageId: number; eyebrow: L; title: L; intro: L; mediaId?: number };

/** Nom des collections dans l'interface (mots de l'admin : COLLECTION_OPTIONS). */
export const COLLECTION_NAMES: Record<CollectionKey, string> = { characters: "Personnages", backgrounds: "Décors", animation: "Animation" };
const isMediaId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
export const TEXT_FIELDS = ["eyebrow", "title", "intro"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

const EMPTY: L = { fr: "", en: "" };
const isKey = (v: unknown): v is CollectionKey => typeof v === "string" && (COLLECTION_KEYS as readonly string[]).includes(v);
const isL = (v: unknown): v is L => Boolean(v) && typeof v === "object" && typeof (v as L).fr === "string" && typeof (v as L).en === "string";
const asL = (v: unknown): L => (isL(v) ? { fr: v.fr, en: v.en } : EMPTY);
export const sameL = (a: L, b: L) => a.fr === b.fr && a.en === b.en;

/**
 * Textes d'en-tête d'une page de collection : ceux de son premier bloc Titre (étiquette, titre, présentation) ;
 * un Titre sans titre (vide), ou une page sans Titre, reprend le titre de la page. (Un ancien « En-tête de collection »
 * non encore migré compte comme un Titre.)
 */
export function pageHeader(blocks: { type: string; props: unknown }[], pageTitle: L): Pick<CollectionPage, "eyebrow" | "title" | "intro"> {
  for (const b of blocks) {
    if (b.type !== "section-title" && b.type !== "collection-intro") continue;
    const p = (b.props && typeof b.props === "object" ? b.props : {}) as Record<string, unknown>;
    if (p.linked) continue;
    return { eyebrow: asL(p.eyebrow), title: isL(p.title) && (p.title.fr.trim() || p.title.en.trim()) ? asL(p.title) : asL(pageTitle), intro: asL(p.intro) };
  }
  return { eyebrow: EMPTY, title: asL(pageTitle), intro: EMPTY };
}

/**
 * Pages de collection (celles dont le champ « collection » est réglé) dans l'ordre du menu (`menu` : identifiants de
 * pages dans l'ordre du menu) ; celles qui n'y sont pas viennent après, par identifiant. `pages` : seulement les
 * pages publiées.
 */
export function orderCollectionPages(
  pages: { id: number; title: L; collection: string | null | undefined; blocks: { type: string; props: unknown }[] }[],
  menu: number[],
): CollectionPage[] {
  const rank = new Map<number, number>();
  menu.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  return pages
    .flatMap((p) => (isKey(p.collection) ? [{ pageId: p.id, collection: p.collection, ...pageHeader(p.blocks, p.title) }] : []))
    .sort((a, b) => (rank.get(a.pageId) ?? Infinity) - (rank.get(b.pageId) ?? Infinity) || a.pageId - b.pageId);
}

/** Tuile à montrer. `edited` : champs dont le texte vient de la tuile et non de l'en-tête de la page. */
export type Entry = CollectionPage & { edited: Partial<Record<TextField, true>>; mediaId?: number };

/** Mode automatique : une tuile par page de collection, textes d'en-tête sauf ceux modifiés sur la tuile. */
export function autoEntries(found: CollectionPage[], edits: TileEdit[] | undefined): Entry[] {
  return found.slice(0, MAX_TILES).map((page) => {
    const edit = (edits ?? []).find((e) => e.pageId === page.pageId);
    const out: Entry = { ...page, edited: {} };
    for (const f of TEXT_FIELDS) {
      const own = edit?.[f];
      if (isL(own)) {
        out[f] = own;
        out.edited[f] = true;
      }
    }
    const cover = edit?.mediaId;
    if (isMediaId(cover)) out.mediaId = cover;
    return out;
  });
}

/**
 * Mode manuel : la liste de l'artiste. Une entrée dont la page n'est plus publiée (supprimée ou dépubliée)
 * est marquée `broken` : masquée en public, signalée sur la toile.
 */
export function manualEntries(items: TileItem[], publishedIds: Set<number>): (TileItem & { broken: boolean })[] {
  return items.map((it) => ({ ...it, broken: !publishedIds.has(it.pageId) }));
}

/** Mode du bloc : « manual » tant que le bloc ne dit pas « auto » (un bloc d'avant la v0.19 est manuel). */
export const tilesMode = (props: { mode?: unknown }): "auto" | "manual" => (props.mode === "auto" ? "auto" : "manual");

/**
 * Textes d'une liste manuelle qui diffèrent de l'en-tête de leur page : devenus modifications de tuile
 * (rien ne se perd en passant en automatique). Entrée sans page de collection : ignorée.
 */
export function editsFromItems(items: TileItem[], found: CollectionPage[]): TileEdit[] {
  const out: TileEdit[] = [];
  for (const it of items) {
    const page = found.find((p) => p.pageId === it.pageId);
    if (!page) continue;
    const edit: TileEdit = { pageId: it.pageId };
    for (const f of TEXT_FIELDS) if (!sameL(it[f], page[f])) edit[f] = it[f];
    if (isMediaId(it.mediaId)) edit.mediaId = it.mediaId;
    if (Object.keys(edit).length > 1) out.push(edit);
  }
  return out;
}

/** Liste manuelle équivalente à ce que montre le mode automatique (passage auto → manuel). */
export function itemsFromEntries(entries: Entry[]): TileItem[] {
  return entries.map((e) => ({ collection: e.collection, pageId: e.pageId, eyebrow: e.eyebrow, title: e.title, intro: e.intro, ...(e.mediaId !== undefined ? { mediaId: e.mediaId } : {}) }));
}

/**
 * Migration d'un bloc existant : passe en automatique SEULEMENT si sa liste est déjà exactement celle des
 * pages de collection (mêmes pages, même ordre, même collection). Les textes qui diffèrent de l'en-tête de
 * la page deviennent des modifications de tuile ; la liste est retirée. Sinon le bloc est écrit « manual »
 * et sa liste n'est pas touchée. Un bloc qui a déjà un mode est rendu tel quel (idempotente).
 */
export function migrateTilesProps(props: Record<string, unknown>, found: CollectionPage[]): { props: Record<string, unknown>; mode: "auto" | "manual"; changed: boolean } {
  if (props.mode === "auto" || props.mode === "manual") return { props, mode: props.mode, changed: false };
  const raw = Array.isArray(props.items) ? props.items : [];
  const items = raw.filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === "object");
  const same =
    items.length === raw.length &&
    items.length === found.length &&
    items.every((it, i) => it.pageId === found[i].pageId && it.collection === found[i].collection);
  if (!same) return { props: { ...props, mode: "manual" }, mode: "manual", changed: true };
  const list: TileItem[] = items.map((it, i) => ({
    collection: found[i].collection,
    pageId: found[i].pageId,
    eyebrow: asL(it.eyebrow),
    title: asL(it.title),
    intro: asL(it.intro),
    ...(isMediaId(it.mediaId) ? { mediaId: it.mediaId } : {}),
  }));
  const edits = editsFromItems(list, found);
  const { items: _items, ...rest } = props;
  void _items;
  return { props: { ...rest, mode: "auto", ...(edits.length ? { edits } : {}) }, mode: "auto", changed: true };
}

/**
 * Ce que montre une entrée selon les œuvres PUBLIÉES de sa collection (lot 26) : « tile » = la tuile ; « notice » = collection
 * vide, sur la toile : un avis dans la tuile (« Cette collection n'a encore aucune œuvre publiée ») ; « hidden » = collection
 * vide en public : rien (une tuile sans image n'a pas de sens).
 */
export const tileVisibility = (works: number, edit: boolean): "tile" | "notice" | "hidden" => (works > 0 ? "tile" : edit ? "notice" : "hidden");

/** Taille des images d'une tuile. */
export type TileSize = "small" | "medium" | "large";
export const TILE_SIZES: readonly TileSize[] = ["small", "medium", "large"];
export const TILE_SIZE_LABELS: Record<TileSize, string> = { small: "Petite", medium: "Moyenne", large: "Grande" };
/** Colonnes (sur 12) de l'image, plafond de hauteur de l'image (en svh) et `sizes` de l'image. */
export const TILE_GEOMETRY: Record<TileSize, { cols: number; cap: number; sizes: string }> = {
  small: { cols: 5, cap: 50, sizes: "(min-width: 768px) 42vw, 100vw" },
  medium: { cols: 6, cap: 70, sizes: "(min-width: 768px) 50vw, 100vw" },
  large: { cols: 8, cap: 85, sizes: "(min-width: 768px) 66vw, 100vw" },
};
export const tileSize = (v: unknown): TileSize => ((TILE_SIZES as readonly unknown[]).includes(v) ? (v as TileSize) : "medium");

export const isCollectionKey = isKey;
