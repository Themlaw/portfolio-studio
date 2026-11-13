/**
 * Collage de blocs et de styles (lot 133), côté serveur : le presse-papiers (localStorage, src/lib/edit/clip.ts) n'est jamais cru, tout repasse
 * par le REGISTRE (src/blocks/registry.ts) : schéma du type, conteneurs acceptés, imbrication, types uniques, références déclarées (`refs`),
 * nouveaux uid. Rien n'est propre à un type de bloc : un type ajouté au registre (autres lots) se copie, se colle et se style sans code de plus.
 *
 * Module sans accès base : l'existence des médias, pages et projets est fournie par l'appelant (`exists`).
 */
import { BLOCKS, type BlockDefinition } from "@/blocks/registry";
import { valuesAt } from "@/blocks/refs";
import { readReveal } from "@/blocks/reveal";
import { childrenOf, containerAccepts, isContainer, MAX_CHILDREN, MAX_NESTING, withFreshUids, type TreeBlock } from "@/blocks/tree";
import { own } from "@/lib/own";
import { readLook } from "@/lib/look";
import { scopeProblem } from "@/lib/special-pages";
import { readBackground, supportsFond } from "@/themes/fond";
import { readSurface } from "@/themes/surface";

import { clean, CONTENT_LOOK_KEYS, isObj, MAX_PAGE_BLOCKS, type ClipBlock } from "./clip";

/** Motif d'un chemin de texte déclaré au registre (`*` = indice de liste). */
const inlineMatcher = (paths: string[]): RegExp => new RegExp(`^(?:${paths.map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "\\d+")).join("|") || "(?!)"})$`);

/**
 * Le style tel que la cible peut le porter, d'après les schémas : carte au premier niveau seulement, fond sur les types qui en ont,
 * styles de texte sur les textes que la cible déclare, tout réglage illisible écarté. Ne garde que les clés valides.
 */
export function adaptStyle(style: Record<string, unknown>, target: { type: string; top: boolean }, registry: Record<string, BlockDefinition> = BLOCKS): Record<string, unknown> {
  const def = own(registry, target.type);
  const out: Record<string, unknown> = {};
  if (!def || !isObj(style)) return out;
  const src = clean(style);
  if (src.look !== undefined) {
    const look = readLook(src.look) as Record<string, unknown> | undefined;
    if (look) {
      const next: Record<string, unknown> = { ...look };
      for (const k of CONTENT_LOOK_KEYS) delete next[k];
      if (isObj(next.text)) {
        const ok = inlineMatcher(def.inline);
        const text = Object.fromEntries(Object.entries(next.text).filter(([path]) => ok.test(path)));
        if (Object.keys(text).length) next.text = text;
        else delete next.text;
      }
      if (Object.keys(next).length) out.look = next;
    }
  }
  if (src.surface !== undefined && target.top) {
    const surface = readSurface(src.surface);
    if (surface) out.surface = surface;
  }
  if (src.background !== undefined && supportsFond(target.type)) {
    const background = readBackground(src.background);
    if (background) out.background = background;
  }
  if (src.reveal !== undefined) {
    const reveal = readReveal(src.reveal);
    if (reveal) out.reveal = reveal;
  }
  return out;
}

/* ------------------------------------------------------------------ collage */

export type Existence = {
  media: (id: number) => boolean;
  page: (id: number) => boolean;
  /** "ok" = citable ; "elsewhere" = projet en cours de création sur une autre page ; "missing" = n'existe plus. */
  project: (slug: string) => "ok" | "missing" | "elsewhere";
};

export type PasteOptions = {
  /** Type du conteneur visé (null = la page). */
  parentType: string | null;
  /** Niveaux de conteneurs jusqu'au conteneur visé compris (0 = la page). */
  depth: number;
  /** Blocs déjà présents dans la liste visée. */
  count: number;
  /** Blocs de toute la page cible (types uniques). */
  pageBlocks: { type: string }[];
  special: boolean;
  exists: Existence;
  newUid: () => string;
  registry?: Record<string, BlockDefinition>;
};

export type Pasted = { ok: true; blocks: ClipBlock[] } | { ok: false; message: string };

const nestingOf = (block: TreeBlock): number => (isContainer(block.type) ? 1 + Math.max(0, ...childrenOf(block).map(nestingOf)) : 0);
const flat = (blocks: TreeBlock[]): TreeBlock[] => blocks.flatMap((b) => [b, ...flat(childrenOf(b))]);

/**
 * Revalide des blocs collés par le registre et leur donne de nouveaux uid. Les médias, pages et projets cités restent référencés (jamais copiés).
 * Un bloc invalide refuse tout le collage, avec la raison.
 */
export function sanitizeBlocks(input: unknown, opts: PasteOptions): Pasted {
  const registry = opts.registry ?? BLOCKS;
  const label = (type: string) => own(registry, type)?.label ?? type;
  if (!Array.isArray(input) || input.length === 0) return { ok: false, message: "Rien à coller." };
  if (input.length > MAX_PAGE_BLOCKS) return { ok: false, message: `${MAX_PAGE_BLOCKS} blocs au plus par collage.` };
  const limit = opts.parentType === null ? MAX_PAGE_BLOCKS : MAX_CHILDREN;
  if (opts.count + input.length > limit) return { ok: false, message: opts.parentType === null ? `${MAX_PAGE_BLOCKS} blocs au plus par page.` : "Ce bloc est plein." };
  const blocks = clean(input) as TreeBlock[];
  const fail = (message: string): Pasted => ({ ok: false, message });
  const seen = new Map<string, number>();
  for (const b of opts.pageBlocks) seen.set(b.type, (seen.get(b.type) ?? 0) + 1);

  const walk = (list: unknown[], parentType: string | null, depth: number): { blocks: ClipBlock[] } | { error: string } => {
    const out: ClipBlock[] = [];
    for (const item of list) {
      if (!isObj(item) || typeof item.type !== "string" || !isObj(item.props)) return { error: "Bloc illisible : le collage est refusé." };
      const def = own(registry, item.type);
      if (!def) return { error: `Type de bloc inconnu « ${item.type} ».` };
      if (def.deprecated) return { error: `« ${def.label} » n'est plus proposé : il ne se colle pas.` };
      if (def.locked) return { error: `« ${def.label} » existe une seule fois sur la page : il ne se colle pas.` };
      if (parentType !== null) {
        const accepts = own(registry, parentType)?.container?.accepts ?? [];
        if (!accepts.includes(item.type) && !containerAccepts(parentType, item.type)) return { error: `« ${def.label} » ne se pose pas dans ce bloc.` };
      }
      if (def.single) {
        if ((seen.get(item.type) ?? 0) > 0) return { error: def.single.reason };
        seen.set(item.type, 1);
      }
      const result = def.schema.safeParse(item.props);
      if (!result.success) return { error: `« ${def.label} » : ${result.error.issues.map((i) => `${i.path.join(".") || "réglages"} (${i.message})`).slice(0, 2).join(", ")}.` };
      const props = { ...(result.data as Record<string, unknown>) };
      // Références déclarées au registre (sans clé étrangère en base) : médias et pages existants, projets citables.
      for (const path of def.refs.media ?? []) for (const v of valuesAt(props, path)) if (Number.isInteger(v) && !opts.exists.media(v as number)) return { error: `« ${def.label} » cite un média qui n'existe plus ou qui est à la corbeille.` };
      for (const path of def.refs.pages ?? []) for (const v of valuesAt(props, path)) if (Number.isInteger(v) && !opts.exists.page(v as number)) return { error: `« ${def.label} » pointe vers une page qui n'existe plus.` };
      for (const path of def.refs.projects ?? []) {
        for (const v of valuesAt(props, path)) {
          if (typeof v !== "string") continue;
          const state = opts.exists.project(v);
          if (state === "missing") return { error: `« ${def.label} » cite un projet qui n'existe plus.` };
          if (state === "elsewhere") return { error: `« ${def.label} » cite un projet en cours de création sur une autre page : publie cette page d'abord.` };
        }
      }
      if (def.container) {
        const kids = Array.isArray(props.children) ? props.children : [];
        if (kids.length > MAX_CHILDREN) return { error: `« ${def.label} » : ${MAX_CHILDREN} composants au plus.` };
        if (depth + 1 > MAX_NESTING && kids.length) return { error: "Trop de niveaux de blocs imbriqués." };
        const inner = walk(kids, item.type, depth + 1);
        if ("error" in inner) return inner;
        props.children = inner.blocks;
      }
      out.push({ uid: typeof item.uid === "string" ? item.uid : "", type: item.type, props });
    }
    return { blocks: out };
  };

  const res = walk(blocks, opts.parentType, opts.depth);
  if ("error" in res) return fail(res.error);
  // Imbrication : les conteneurs au-dessus de l'emplacement + ceux que les blocs apportent.
  if (opts.depth > 0 && res.blocks.some((b) => opts.depth + nestingOf(b) > MAX_NESTING)) return fail("Trop de niveaux de blocs imbriqués.");
  const scope = scopeProblem(opts.special, flat(res.blocks).map((b) => b.type), label);
  if (scope) return fail(scope);
  return { ok: true, blocks: res.blocks.map((b) => withFreshUids(b, opts.newUid)) };
}
