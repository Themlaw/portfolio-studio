/**
 * Références portées par les props des blocs (sans clé étrangère en base).
 *
 * Chaque type de bloc déclare quels champs de ses props désignent un média ou
 * une page, sous forme de chemins : "portraitMediaId", "more.pageId",
 * "items[].pageId" ([] = chaque élément d'un tableau). Le registre de blocs
 * reprend cette table ; src/lib/references.ts s'en sert pour répondre à
 * « où ce média / cette page est-il utilisé ? » avant une suppression.
 *
 * Module pur (aucun import) : testable directement par Node
 * (scripts/test-references.mjs).
 */

/** `projects` : chemins vers des slugs de projet (chaînes). */
export type BlockRefs = { media?: string[]; pages?: string[]; projects?: string[] };

export const BLOCK_REFS: Record<string, BlockRefs> = {
  hero: { pages: ["reelPageId"], media: ["backgroundMediaId"] },
  // Couverture choisie sur une tuile (lot 26) : `items[].mediaId` (manuel), `edits[].mediaId` (automatique).
  "collection-tiles": { pages: ["items[].pageId"], media: ["items[].mediaId", "edits[].mediaId"] },
  // Mode automatique : les entrées suivent les pages de collection ; `edits[].pageId` (textes modifiés) ne retient aucune page.
  // Conteneur (v0.13) : ses composants (props.children) sont parcourus aussi.
  "featured-project": { pages: ["more.pageId"], projects: ["project"] },
  "collection-intro": {},
  "collection-projects": {},
  video: { media: ["reelMediaId"] },
  "rich-text": {},
  contact: {},
  profile: { media: ["portraitMediaId"] },
  "project-board": { projects: ["project"] },
  "section-title": { projects: ["project"] },
  "page-link": { pages: ["pageId"] },
  image: { media: ["mediaId"] },
  "video-single": { media: ["mediaId", "posterMediaId"] },
  cv: { media: ["mediaId"] },
  grid: {},
  "contact-form": {},
  // Ancien bloc (avant v0.13), encore lu.
  "featured-projects": { pages: ["more.pageId"], projects: ["projects[]"] },
};

/**
 * Composants d'un conteneur ({ type, props }[] dans props.children) : leurs
 * références comptent comme celles du bloc. Deux niveaux de conteneurs au
 * plus (src/blocks/tree.ts) ; au-delà, rien n'est lu. `depth` ≥ 2 : seules
 * les références du bloc lui-même.
 */
function nested(props: unknown, depth: number): { type: string; props: unknown }[] {
  if (depth >= 2 || !props || typeof props !== "object") return [];
  const children = (props as { children?: unknown }).children;
  if (!Array.isArray(children)) return [];
  return children.filter((c): c is { type: string; props: unknown } => Boolean(c) && typeof c === "object" && typeof (c as { type?: unknown }).type === "string");
}

/** Valeurs trouvées à un chemin ("a.b", "items[].pageId"…). */
export function valuesAt(value: unknown, path: string): unknown[] {
  let current: unknown[] = [value];
  for (const part of path.split(".")) {
    const isArray = part.endsWith("[]");
    const key = isArray ? part.slice(0, -2) : part;
    const next: unknown[] = [];
    for (const item of current) {
      if (!item || typeof item !== "object") continue;
      const v = (item as Record<string, unknown>)[key];
      if (isArray) {
        if (Array.isArray(v)) next.push(...v);
      } else if (v !== undefined) {
        next.push(v);
      }
    }
    current = next;
  }
  return current;
}

/** Identifiants (entiers) référencés par un bloc, par genre. */
export function extractRefs(type: string, props: unknown, depth = 0): { media: number[]; pages: number[] } {
  const refs = (Object.hasOwn(BLOCK_REFS, type) ? BLOCK_REFS[type] : undefined) ?? {};
  const ids = (paths: string[] = []) =>
    paths.flatMap((p) => valuesAt(props, p)).filter((v): v is number => Number.isInteger(v));
  const out = { media: ids(refs.media), pages: ids(refs.pages) };
  for (const child of nested(props, depth)) {
    const r = extractRefs(child.type, child.props, depth + 1);
    out.media.push(...r.media);
    out.pages.push(...r.pages);
  }
  return out;
}

/** `draft` : bloc du brouillon d'une page (éditeur visuel), pas de la version publiée. */
export type BlockRow = { id: number; pageId: number; type: string; props: unknown; draft?: boolean };
/** `draftPageId` : page dont le brouillon (éditeur visuel) est la raison de cette utilisation, sinon absent. */
export type SlotRow = { id: number; projectId: number; slug: string; mediaId: number | null; draftPageId?: number | null };

/**
 * Contenu de planche d'un projet (lot 31) : médias cités par la suite publiée et par la surcouche d'une page
 * (`draftPageId`, la page qui la tient).
 */
export type LayoutRow = { projectId: number; slug: string; published: number[]; draft: number[]; draftPageId?: number | null };

export type Usage =
  | { kind: "slot"; slotId: number; projectId: number; slug: string; draftPageId?: number }
  | { kind: "layout"; projectId: number; slug: string; draftPageId?: number }
  | { kind: "block"; blockId: number; pageId: number; type: string; path: "media" | "pages" | "projects" };

/**
 * UNE seule règle pour « où chaque média est utilisé » (compteur de la médiathèque, détail « Utilisée dans… »,
 * blocage de la suppression). Un emplacement compte une fois ; un bloc compte une fois par page et par type et
 * par média, que la page le porte publié, en brouillon ou les deux : le brouillon d'un bloc publié est LA MÊME
 * place (sans quoi le compteur disait 1 et le détail 2). Deux blocs de même type sur une page : le plus grand
 * des deux nombres (publié / brouillon) fait foi.
 */
export function mediaUsageIndex(rows: { slots: SlotRow[]; blocks: BlockRow[]; layouts?: LayoutRow[] }): Map<number, Usage[]> {
  const out = new Map<number, Usage[]>();
  const push = (media: number, u: Usage) => out.set(media, [...(out.get(media) ?? []), u]);
  for (const s of rows.slots) {
    if (s.mediaId !== null && !(out.get(s.mediaId) ?? []).some((u) => u.kind === "slot" && u.slotId === s.id)) {
      push(s.mediaId, { kind: "slot", slotId: s.id, projectId: s.projectId, slug: s.slug, ...(s.draftPageId ? { draftPageId: s.draftPageId } : {}) });
    }
  }
  // Contenu de planche : une utilisation par projet et par média (publiée, ou seulement dans le brouillon de la page qui la tient).
  for (const l of rows.layouts ?? []) {
    const published = new Set(l.published);
    for (const media of new Set([...l.published, ...l.draft])) {
      const onlyDraft = !published.has(media);
      push(media, { kind: "layout", projectId: l.projectId, slug: l.slug, ...(onlyDraft && l.draftPageId ? { draftPageId: l.draftPageId } : {}) });
    }
  }
  const counts = new Map<string, { media: number; row: BlockRow; published: number; draft: number }>();
  for (const b of rows.blocks) {
    for (const media of extractRefs(b.type, b.props).media) {
      const key = `${media}:${b.pageId}:${b.type}`;
      const c = counts.get(key) ?? { media, row: b, published: 0, draft: 0 };
      if (b.draft) c.draft++;
      else {
        c.published++;
        c.row = b;
      }
      counts.set(key, c);
    }
  }
  for (const { media, row, published, draft } of counts.values()) {
    for (let i = 0; i < Math.max(published, draft); i++) push(media, { kind: "block", blockId: row.id, pageId: row.pageId, type: row.type, path: "media" });
  }
  return out;
}

/** Où un média est utilisé : slots de planche et props de blocs (voir `mediaUsageIndex`). */
export function mediaUsages(mediaId: number, rows: { slots: SlotRow[]; blocks: BlockRow[]; layouts?: LayoutRow[] }): Usage[] {
  return mediaUsageIndex(rows).get(mediaId) ?? [];
}

/** Slugs de projet référencés par un bloc. */
export function extractProjectRefs(type: string, props: unknown, depth = 0): string[] {
  const refs = (Object.hasOwn(BLOCK_REFS, type) ? BLOCK_REFS[type] : undefined) ?? {};
  const own = (refs.projects ?? []).flatMap((p) => valuesAt(props, p)).filter((v): v is string => typeof v === "string");
  return [...own, ...nested(props, depth).flatMap((c) => extractProjectRefs(c.type, c.props, depth + 1))];
}

/** Blocs qui citent un projet (par son slug). */
export function projectReferences(slug: string, blocks: BlockRow[]): Usage[] {
  return blocks
    .filter((b) => extractProjectRefs(b.type, b.props).includes(slug))
    .map((b) => ({ kind: "block" as const, blockId: b.id, pageId: b.pageId, type: b.type, path: "projects" as const }));
}

/** Blocs (d'autres pages ou de la même) qui pointent vers une page. */
export function pageReferences(pageId: number, blocks: BlockRow[]): Usage[] {
  return blocks
    .filter((b) => extractRefs(b.type, b.props).pages.includes(pageId))
    .map((b) => ({ kind: "block" as const, blockId: b.id, pageId: b.pageId, type: b.type, path: "pages" as const }));
}
