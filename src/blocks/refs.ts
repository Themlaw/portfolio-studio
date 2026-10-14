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

export type BlockRow = { id: number; pageId: number; type: string; props: unknown };
export type SlotRow = { id: number; projectId: number; slug: string; mediaId: number | null };

export type Usage =
  | { kind: "slot"; slotId: number; projectId: number; slug: string }
  | { kind: "block"; blockId: number; pageId: number; type: string; path: "media" | "pages" | "projects" };

/** Où un média est utilisé : slots de planche et props de blocs. */
export function mediaUsages(mediaId: number, rows: { slots: SlotRow[]; blocks: BlockRow[] }): Usage[] {
  const out: Usage[] = [];
  for (const s of rows.slots) {
    if (s.mediaId === mediaId) out.push({ kind: "slot", slotId: s.id, projectId: s.projectId, slug: s.slug });
  }
  for (const b of rows.blocks) {
    if (extractRefs(b.type, b.props).media.includes(mediaId)) {
      out.push({ kind: "block", blockId: b.id, pageId: b.pageId, type: b.type, path: "media" });
    }
  }
  return out;
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
