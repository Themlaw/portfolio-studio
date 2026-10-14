/**
 * Conteneurs de blocs (v0.13) : un bloc conteneur porte ses composants dans
 * `props.children` ({ uid, type, props }[]). Imbrication bornée : au plus
 * deux niveaux de conteneurs (ex. Projet mis en avant > Grille > Vidéo) ; un
 * conteneur n'accepte que les types de sa liste `accepts`. Module pur (aucun
 * import) : lu par le registre, le serveur (brouillon, publication,
 * références), l'éditeur (client) et les tests Node.
 *
 * Toute fonction qui parcourt les blocs d'une page (références, planches
 * publiées, compteurs, nettoyage) passe par `walk` / `flatBlocks` : les
 * composants y sont vus comme les blocs de la page.
 */

export type TreeBlock = { uid?: string; type: string; props?: unknown };
export type ChildBlock = { uid: string; type: string; props: Record<string, unknown> };

/** Composants au plus par conteneur. */
export const MAX_CHILDREN = 24;
/** Niveaux de conteneurs au plus (page > conteneur > conteneur > bloc simple). */
export const MAX_NESTING = 2;

const SIMPLE = ["section-title", "project-board", "image", "rich-text", "video-single", "cv"];

/**
 * Conteneurs connus et types acceptés. Le registre (registry.ts) reprend
 * cette table (`container`) : un seul endroit à modifier.
 */
export const CONTAINERS: Record<string, { accepts: string[] }> = {
  "featured-project": { accepts: [...SIMPLE, "grid"] },
  grid: { accepts: SIMPLE },
};

const own = <T>(dict: Record<string, T>, key: string): T | undefined => (Object.hasOwn(dict, key) ? dict[key] : undefined);

export const isContainer = (type: string): boolean => Boolean(own(CONTAINERS, type));
export const containerAccepts = (parent: string, child: string): boolean => Boolean(own(CONTAINERS, parent)?.accepts.includes(child));

/** Composants d'un bloc (tableau vide pour un bloc simple ou des props illisibles). */
export function childrenOf<B extends TreeBlock = TreeBlock>(block: B): B[] {
  if (!isContainer(block.type)) return [];
  const c = (block.props as { children?: unknown } | null | undefined)?.children;
  return Array.isArray(c) ? (c.filter((x) => x && typeof x === "object" && typeof (x as TreeBlock).type === "string") as B[]) : [];
}

/** Bloc vu pendant un parcours : son conteneur direct, sa position, sa profondeur (0 = page). */
export type Visit<B extends TreeBlock = TreeBlock> = { block: B; parent: B | null; ancestors: B[]; index: number; depth: number };

/** Tous les blocs d'une page, composants compris (ordre de lecture, profondeur bornée). */
export function walk<B extends TreeBlock>(blocks: B[]): Visit<B>[] {
  const out: Visit<B>[] = [];
  const visit = (list: B[], ancestors: B[]) => {
    list.forEach((block, index) => {
      out.push({ block, parent: ancestors.at(-1) ?? null, ancestors, index, depth: ancestors.length });
      if (ancestors.length < MAX_NESTING) visit(childrenOf(block), [...ancestors, block]);
    });
  };
  visit(blocks, []);
  return out;
}

/** Les blocs, composants compris, à plat. */
export const flatBlocks = <B extends TreeBlock>(blocks: B[]): B[] => walk(blocks).map((v) => v.block);

/**
 * Contrôle de forme d'un arbre de blocs (brouillon et publication) : types
 * connus, composants seulement dans un conteneur qui les accepte, deux
 * niveaux de conteneurs au plus, nombre de composants borné, uid uniques et
 * bien formés (obligatoires pour un composant). Premier problème, ou null.
 */
export function treeProblem(blocks: TreeBlock[], known: (type: string) => boolean): string | null {
  const uids = new Set<string>();
  const uidOk = (u: unknown) => typeof u === "string" && /^[a-z0-9-]{1,32}$/.test(u);
  const check = (list: unknown[], parent: string | null, depth: number): string | null => {
    for (const raw of list) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "Composant illisible.";
      const block = raw as { uid?: unknown; type?: unknown; props?: unknown };
      if (typeof block.type !== "string" || !known(block.type)) return `Type de rubrique inconnu « ${String(block.type).slice(0, 60)} ».`;
      if (parent !== null) {
        if (!containerAccepts(parent, block.type)) return "Cette rubrique n'accepte pas ce composant.";
        if (!uidOk(block.uid)) return "Identifiant de composant invalide.";
      }
      if (block.uid !== undefined) {
        if (!uidOk(block.uid)) return "Identifiant de rubrique invalide.";
        if (uids.has(block.uid as string)) return "Rubriques en double.";
        uids.add(block.uid as string);
      }
      const props = block.props;
      if (parent !== null && (!props || typeof props !== "object" || Array.isArray(props))) return "Réglages d'un composant illisibles.";
      const hasChildren = Boolean(props) && typeof props === "object" && "children" in (props as object);
      if (!isContainer(block.type)) {
        if (hasChildren) return "Seule une rubrique à composants (Grille…) en porte.";
        continue;
      }
      if (depth >= MAX_NESTING) return "Trop de rubriques imbriquées.";
      if (!hasChildren) continue;
      const children = (props as { children: unknown }).children;
      if (!Array.isArray(children)) return "Composants de la rubrique illisibles.";
      if (children.length > MAX_CHILDREN) return `${MAX_CHILDREN} composants au plus par rubrique.`;
      const problem = check(children, block.type, depth + 1);
      if (problem) return problem;
    }
    return null;
  };
  return check(blocks, null, 0);
}

/* ---- Planches d'une page (publication, compteurs) ------------------------- */

export type BoardRef = { slug: string; collection?: string; block: TreeBlock };

/** Projet transmis par les conteneurs (le plus proche qui en a un). */
function inheritedProject(ancestors: TreeBlock[]): string | undefined {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const p = (ancestors[i].props as { project?: unknown } | undefined)?.project;
    if (typeof p === "string") return p;
  }
  return undefined;
}

/**
 * Planches de projet affichées par ces blocs (y compris dans un conteneur, où
 * une planche sans projet prend celui du conteneur).
 */
export function boardRefs(blocks: TreeBlock[]): BoardRef[] {
  const out: BoardRef[] = [];
  for (const { block, ancestors } of walk(blocks)) {
    if (block.type !== "project-board") continue;
    const p = (block.props ?? {}) as { project?: unknown; collection?: unknown };
    const slug = typeof p.project === "string" ? p.project : inheritedProject(ancestors);
    if (slug) out.push({ slug, ...(typeof p.collection === "string" ? { collection: p.collection } : {}), block });
  }
  return out;
}

/**
 * Compteurs d'une page (« N œuvres · M projets ») : M = planches de projet
 * présentes, N = images et vidéos qu'elles affichent (places vides exclues).
 * `shown(slug, collection)` : nombre d'œuvres affichées par la planche
 * (0 si le projet n'existe pas : la planche n'est alors pas comptée).
 */
export function pageCounts(blocks: TreeBlock[], shown: (slug: string, collection?: string) => number | null): { works: number; projects: number } {
  let projects = 0;
  let works = 0;
  for (const b of boardRefs(blocks)) {
    const n = shown(b.slug, b.collection);
    if (n === null) continue;
    projects++;
    works += Math.max(0, n);
  }
  return { projects, works };
}

/* ---- Opérations de l'éditeur (immuables) --------------------------------- */

export type Located = { parent: string | null; index: number; depth: number };

/** Où se trouve un bloc (parent = uid du conteneur, ou null pour la page). */
export function locate(blocks: TreeBlock[], uid: string): Located | null {
  const v = walk(blocks).find((x) => x.block.uid === uid);
  return v ? { parent: v.parent?.uid ?? null, index: v.index, depth: v.depth } : null;
}

export function findBlock<B extends TreeBlock>(blocks: B[], uid: string): B | null {
  return walk(blocks).find((v) => v.block.uid === uid)?.block ?? null;
}

/** Conteneurs qui englobent un bloc, du plus haut au plus proche. */
export function ancestorsOf<B extends TreeBlock>(blocks: B[], uid: string): B[] {
  return walk(blocks).find((v) => v.block.uid === uid)?.ancestors ?? [];
}

/** Profondeur d'un conteneur (0 = sur la page), ou null. */
function depthOf(blocks: TreeBlock[], uid: string): number | null {
  return locate(blocks, uid)?.depth ?? null;
}

/** Liste visée : la page, ou les composants d'un conteneur. */
export function listOf<B extends TreeBlock>(blocks: B[], parent: string | null): B[] | null {
  if (parent === null) return blocks;
  const container = findBlock(blocks, parent);
  if (!container || !isContainer(container.type)) return null;
  return childrenOf(container);
}

function setChildren<B extends TreeBlock>(block: B, list: B[]): B {
  return { ...block, props: { ...((block.props ?? {}) as object), children: list } } as B;
}

/** Remplace la liste `parent` (récursif). */
function withList<B extends TreeBlock>(blocks: B[], parent: string | null, list: B[]): B[] {
  if (parent === null) return list;
  const rec = (items: B[]): B[] =>
    items.map((b) => {
      if (b.uid === parent) return setChildren(b, list);
      const children = childrenOf(b);
      return children.length ? setChildren(b, rec(children)) : b;
    });
  return rec(blocks);
}

/** Retire un bloc (où qu'il soit). */
export function removeBlock<B extends TreeBlock>(blocks: B[], uid: string): B[] {
  const at = locate(blocks, uid);
  if (!at) return blocks;
  const list = listOf(blocks, at.parent)!;
  return withList(blocks, at.parent, list.filter((_, i) => i !== at.index));
}

/** Remplace un bloc (où qu'il soit). */
export function updateBlock<B extends TreeBlock>(blocks: B[], uid: string, fn: (b: B) => B): B[] {
  const at = locate(blocks, uid);
  if (!at) return blocks;
  const list = listOf(blocks, at.parent)!;
  return withList(blocks, at.parent, list.map((b, i) => (i === at.index ? fn(b) : b)));
}

/** Profondeur de conteneurs portée par un bloc lui-même (0 simple, 1 conteneur de simples, 2…). */
function nestingOf(block: TreeBlock): number {
  if (!isContainer(block.type)) return 0;
  return 1 + Math.max(0, ...childrenOf(block).map(nestingOf));
}

/** Peut-on poser ce bloc dans `parent` (null = la page) ? */
export function canPlace(blocks: TreeBlock[], block: TreeBlock, parent: string | null): boolean {
  if (parent === null) return true;
  const container = findBlock(blocks, parent);
  if (!container || !containerAccepts(container.type, block.type)) return false;
  // Conteneurs au-dessus du nouvel emplacement + ceux que le bloc apporte.
  const above = (depthOf(blocks, parent) ?? 0) + 1;
  return above + nestingOf(block) <= MAX_NESTING;
}

/** Insère un bloc dans `parent` à `index` ; null si refusé (type, place, limite). */
export function insertBlock<B extends TreeBlock>(blocks: B[], block: B, parent: string | null, index: number): B[] | null {
  if (!canPlace(blocks, block, parent)) return null;
  const list = listOf(blocks, parent);
  if (!list) return null;
  if (parent !== null && list.length >= MAX_CHILDREN) return null;
  const at = Math.max(0, Math.min(list.length, index));
  return withList(blocks, parent, [...list.slice(0, at), block, ...list.slice(at)]);
}

/**
 * Déplace un bloc vers `parent` à `index` (index compté dans la liste visée
 * AVANT le retrait, comme moveTo) ; null si refusé (un bloc ne va pas dans
 * lui-même ni dans un de ses composants).
 */
export function moveBlock<B extends TreeBlock>(blocks: B[], uid: string, parent: string | null, index: number): B[] | null {
  const from = locate(blocks, uid);
  if (!from) return null;
  const block = findBlock(blocks, uid)!;
  if (parent !== null && (parent === uid || flatBlocks(childrenOf(block)).some((c) => c.uid === parent))) return null;
  let at = index;
  if (from.parent === parent && from.index < index) at -= 1;
  if (from.parent === parent && at === from.index) return blocks;
  const without = removeBlock(blocks, uid);
  return insertBlock(without, block, parent, at);
}

/** Nombre de composants d'un conteneur, sous-conteneurs compris. */
export const descendantCount = (block: TreeBlock | null | undefined): number => (block ? flatBlocks(childrenOf(block)).length : 0);

/** Copie avec de nouveaux uid partout (dupliquer, insérer un modèle). */
export function withFreshUids<B extends TreeBlock>(block: B, newUid: () => string): B {
  const children = childrenOf(block);
  const copy = { ...block, uid: newUid() } as B;
  // Formulaire de contact : son identifiant public suit le bloc (nouveau bloc → nouvel identifiant).
  if (block.type === "contact-form" || (block.type === "contact" && (block.props as { form?: unknown } | undefined)?.form === true)) {
    copy.props = { ...((block.props ?? {}) as object), formId: `f${newUid().replace(/[^a-z0-9]/g, "")}${Math.random().toString(36).slice(2, 8)}`.slice(0, 32) };
  }
  return children.length || isContainer(block.type) ? setChildren(copy, children.map((c) => withFreshUids(c, newUid))) : copy;
}

/**
 * Chemin d'erreur d'un bloc, comme les erreurs de validation de la
 * publication : « blocks.2 », « blocks.2.props.children.0 »…
 */
export function errorPath(blocks: TreeBlock[], target: TreeBlock): string | null {
  const rec = (list: TreeBlock[], prefix: string, depth: number): string | null => {
    for (let i = 0; i < list.length; i++) {
      const here = `${prefix}.${i}`;
      if (list[i] === target) return here;
      if (depth < MAX_NESTING) {
        const found = rec(childrenOf(list[i]), `${here}.props.children`, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  return rec(blocks, "blocks", 0);
}

/** Bloc désigné par un chemin d'erreur (« blocks.2.props.children.0.props.title.fr » → ce composant). */
export function blockAtPath<B extends TreeBlock>(blocks: B[], path: string): B | null {
  const m = /^blocks\.(\d+)((?:\.props\.children\.\d+){0,2})/.exec(path);
  if (!m) return null;
  let block: B | undefined = blocks[Number(m[1])];
  for (const idx of m[2].match(/\d+/g) ?? []) block = block ? childrenOf(block)[Number(idx)] : undefined;
  return block ?? null;
}

/**
 * Des composants comptent-ils sur le projet du conteneur (planche sans projet
 * propre, titre lié), y compris dans une grille ? Le conteneur doit alors en
 * avoir un pour être publié.
 */
export function needsInheritedProject(children: TreeBlock[]): boolean {
  return children.some((c) => {
    const p = (c.props ?? {}) as { project?: unknown; linked?: unknown };
    if (c.type === "project-board" && typeof p.project !== "string") return true;
    if (c.type === "section-title" && p.linked) return true;
    return isContainer(c.type) && typeof p.project !== "string" && needsInheritedProject(childrenOf(c));
  });
}
