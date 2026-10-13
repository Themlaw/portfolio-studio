/**
 * Migration de contenu 0014 (v0.13), idempotente, sur la version publiée ET
 * les brouillons de page (`pages.draft`) :
 *
 * - « Projets mis en avant » (featured-projects, liste ou projets « mis en
 *   avant ») → conteneur « Projet mis en avant » : projet = le premier, un
 *   « Titre » (mêmes textes, même rendu) puis une « Planche d'un projet » par
 *   projet (alternance de fond conservée), lien « voir plus » gardé.
 * - « Planches d'une collection » → une « Planche d'un projet » par projet
 *   qui a des œuvres de ce métier, dans le même ordre (filtrée par métier si
 *   le projet en mêle plusieurs, alternance de fond conservée).
 * - Ancienne vitrine « Vidéos » (demoreel + extraits) → une « Grille » 1 grand
 *   (la demoreel, présentation « Grande ») puis une « Grille » 2 côte à côte
 *   (étiquette et titre des extraits, une « Vidéo » carte par plan).
 * - Menu : réglage `nav` créé depuis l'ordre des pages s'il n'existe pas.
 *
 * Les listes dynamiques d'avant (projets « mis en avant », projets d'une
 * collection, plans de la collection Animation) sont figées dans l'état du
 * moment : le site public ne change pas. Accès SQL direct (better-sqlite3),
 * pour tourner dans la transaction du migrateur et du seed, et en test sur
 * une base en mémoire.
 */
import type Database from "better-sqlite3";

type Raw = { uid?: string; type: string; props: Record<string, unknown> };
type Ctx = {
  projects: { id: number; slug: string; featured: boolean }[];
  /** Œuvres visibles en public (média prêt, emplacement publié), par id. */
  artworks: { id: number; projectId: number; slug: string; collection: string; reel: boolean; video: boolean }[];
  media: Map<number, { kind: string; status: string }>;
};

const LEGACY = new Set(["featured-projects", "collection-projects", "video"]);

function readCtx(db: Database.Database): Ctx {
  const projects = (db.prepare("select id, slug, featured from projects where draft_page_id is null order by position, id").all() as { id: number; slug: string; featured: number }[]).map((p) => ({
    ...p,
    featured: Boolean(p.featured),
  }));
  const published = new Set(projects.map((p) => p.id));
  const media = new Map(
    (db.prepare("select id, kind, status from media").all() as { id: number; kind: string; status: string }[]).map((m) => [m.id, { kind: m.kind, status: m.status }]),
  );
  const artworks = (
    db.prepare("select id, project_id projectId, slug, collection, reel, media_id mediaId, draft_state state from slots order by id").all() as {
      id: number;
      projectId: number;
      slug: string;
      collection: string;
      reel: number;
      mediaId: number | null;
      state: string | null;
    }[]
  )
    .filter((s) => s.state !== "added" && published.has(s.projectId) && s.mediaId !== null && media.get(s.mediaId)?.status === "ready")
    .map((s) => ({ id: s.id, projectId: s.projectId, slug: s.slug, collection: s.collection, reel: Boolean(s.reel), video: media.get(s.mediaId!)?.kind === "video" }));
  return { projects, artworks, media };
}

const L0 = { fr: "", en: "" };
const loc = (v: unknown) => (v && typeof v === "object" ? (v as { fr: string; en: string }) : L0);

/** Blocs qui remplacent un bloc ancien (vide : il ne rendait rien). `uid(i)` : uid du i-ème bloc ou composant créé. */
export function upgradeBlock(block: Raw, ctx: Ctx, uid: (i: number) => string): Raw[] | null {
  if (!LEGACY.has(block.type)) return null;
  const p = block.props ?? {};
  let n = 0;
  const next = () => uid(n++);
  const top = (type: string, props: Record<string, unknown>): Raw => ({ ...(block.uid !== undefined ? { uid: next() } : {}), type, props });
  const kid = (type: string, props: Record<string, unknown>) => ({ uid: next(), type, props });

  if (block.type === "featured-projects") {
    const chosen = Array.isArray(p.projects) && p.projects.length ? (p.projects as unknown[]).filter((s): s is string => typeof s === "string") : null;
    let slugs: string[];
    if (chosen) slugs = chosen.filter((s) => ctx.projects.some((x) => x.slug === s));
    else {
      const limit = Number.isInteger(p.limit) ? (p.limit as number) : 2;
      const pool = ctx.projects.filter((x) => x.featured);
      slugs = (pool.length ? pool : ctx.projects).slice(0, limit).map((x) => x.slug);
    }
    const children = [
      kid("section-title", { eyebrow: loc(p.eyebrow), title: loc(p.title), intro: loc(p.intro) }),
      // Le premier projet est celui du conteneur : sa planche le reprend.
      ...slugs.map((s, i) => kid("project-board", { ...(i === 0 ? {} : { project: s }), deep: i % 2 === 0 })),
    ];
    const more = p.more && typeof p.more === "object" ? p.more : undefined;
    return [top("featured-project", { ...(slugs[0] ? { project: slugs[0] } : {}), ...(more ? { more } : {}), children })];
  }

  if (block.type === "collection-projects") {
    const c = typeof p.collection === "string" ? p.collection : "characters";
    const list = ctx.projects.filter((x) => ctx.artworks.some((a) => a.projectId === x.id && a.collection === c));
    return list.map((x, i) => {
      const mixed = ctx.artworks.some((a) => a.projectId === x.id && a.collection !== c);
      return top("project-board", { project: x.slug, deep: i % 2 === 1, ...(mixed ? { collection: c } : {}) });
    });
  }

  // Ancienne vitrine vidéo : demoreel (hébergée, sinon le plan « reel ») puis les plans.
  const animation = ctx.artworks.filter((a) => a.collection === "animation");
  const hostedId = Number.isInteger(p.reelMediaId) ? (p.reelMediaId as number) : null;
  const hosted = hostedId !== null && ctx.media.get(hostedId)?.kind === "video" && ctx.media.get(hostedId)?.status === "ready";
  const reelSlot = animation.find((a) => a.reel);
  const out: Raw[] = [];
  if (hosted || reelSlot) {
    out.push(
      top("grid", {
        layout: "1",
        top: "none",
        children: [kid("video-single", { variant: "feature", mode: "player", eyebrow: loc(p.reelEyebrow), ...(hosted ? { mediaId: hostedId } : { slot: reelSlot!.slug }) })],
      }),
    );
  }
  const cards = animation.filter((a) => !a.reel);
  // 24 composants au plus par grille : au-delà, grilles suivantes (sans titre).
  for (let i = 0; i === 0 || i < cards.length; i += 24) {
    out.push(
      top("grid", {
        layout: "2",
        top: out.length ? (i === 0 ? "gap" : "none") : "none",
        ...(i === 0 ? { eyebrow: loc(p.cardsEyebrow), title: loc(p.cardsTitle) } : {}),
        children: cards.slice(i, i + 24).map((a) => kid("video-single", { variant: "card", mode: "player", slot: a.slug })),
      }),
    );
  }
  return out;
}

/** Blocs au plus sur une page (même borne que l'éditeur et savePage). */
const MAX_PAGE_BLOCKS = 40;
const MAX_KIDS = 24;

/**
 * Page trop longue après conversion (beaucoup de projets dans une
 * collection) : les planches consécutives sont rangées dans des conteneurs
 * « Projet mis en avant » SANS projet (leurs planches ont chacune le leur) —
 * conteneur sans boîte : rendu identique — jusqu'à repasser sous la borne.
 */
function pack(list: Raw[], uid: (() => string) | null): Raw[] {
  let out = list;
  while (out.length > MAX_PAGE_BLOCKS) {
    // Plus longue suite de planches consécutives (au moins 2).
    let best: [number, number] | null = null;
    for (let i = 0; i < out.length; ) {
      if (out[i].type !== "project-board") {
        i++;
        continue;
      }
      let j = i;
      while (j < out.length && out[j].type === "project-board") j++;
      if (j - i >= 2 && (!best || j - i > best[1] - best[0])) best = [i, j];
      i = j;
    }
    if (!best) break;
    const [i, j] = best;
    const take = Math.min(MAX_KIDS, j - i, out.length - MAX_PAGE_BLOCKS + 1);
    const group = out.slice(i, i + take).map((b, k) => ({ uid: b.uid ?? `${uid ? uid() : `pk${i}`}-${k}`, type: b.type, props: b.props }));
    const container: Raw = { ...(uid ? { uid: uid() } : {}), type: "featured-project", props: { children: group } };
    out = [...out.slice(0, i), container, ...out.slice(i + take)];
  }
  return out;
}

/** uid de tout l'arbre (pour en créer de nouveaux sans collision). */
function allUids(blocks: Raw[], into = new Set<string>()): Set<string> {
  for (const b of blocks) {
    if (typeof b?.uid === "string") into.add(b.uid);
    const kids = (b?.props as { children?: unknown } | undefined)?.children;
    if (Array.isArray(kids)) allUids(kids as Raw[], into);
  }
  return into;
}

function upgradeList(blocks: Raw[], ctx: Ctx, uidBase: (i: number) => string): { blocks: Raw[]; changed: boolean } {
  let changed = false;
  const used = allUids(blocks);
  /** uid neuf, unique dans le brouillon, au format (32 caractères au plus). */
  const fresh = (prefix: string) => {
    let n = 0;
    let id = `${prefix.slice(0, 20)}-m${n}`;
    while (used.has(id)) id = `${prefix.slice(0, 20)}-m${++n}`;
    used.add(id);
    return id;
  };
  const out: Raw[] = [];
  blocks.forEach((b, i) => {
    const prefix = b.uid ?? uidBase(i);
    const next = b && typeof b === "object" && typeof b.type === "string" ? upgradeBlock(b, ctx, () => fresh(prefix)) : null;
    if (next) {
      changed = true;
      out.push(...next);
    } else out.push(b);
  });
  return { blocks: changed ? pack(out, () => fresh("pk")) : out, changed };
}

/** Applique la migration 0014 (idempotente). Renvoie le nombre de pages modifiées. */
export function upgradeContent(db: Database.Database): number {
  const ctx = readCtx(db);
  let pages = 0;
  const pageRows = db.prepare("select id, draft from pages").all() as { id: number; draft: string | null }[];
  for (const page of pageRows) {
    let touched = false;
    // Version publiée : blocs réécrits (positions renumérotées).
    const rows = db.prepare("select id, type, props from blocks where page_id = ? order by position, id").all(page.id) as { id: number; type: string; props: string }[];
    if (rows.some((r) => LEGACY.has(r.type))) {
      // Bloc inchangé (ou illisible) : son texte exact est gardé (ORIGINAL).
      const ORIGINAL = new Map<Raw, string>();
      const converted: Raw[] = [];
      for (const r of rows) {
        let props: Record<string, unknown> | null = null;
        try {
          props = JSON.parse(r.props);
        } catch {}
        const next = props && typeof props === "object" ? upgradeBlock({ type: r.type, props }, ctx, (k) => `p${r.id}-m${k}`) : null;
        if (next) converted.push(...next);
        else {
          const raw: Raw = { type: r.type, props: props && typeof props === "object" ? props : {} };
          ORIGINAL.set(raw, r.props);
          converted.push(raw);
        }
      }
      // Trop de blocs : planches regroupées dans des conteneurs sans boîte (uid dérivés de la page).
      let n = 0;
      const out = pack(converted, null).map((b) => {
        if (ORIGINAL.has(b)) return { type: b.type, text: ORIGINAL.get(b)! };
        if (b.type === "featured-project" && !("project" in b.props) && Array.isArray(b.props.children)) {
          const children = (b.props.children as Raw[]).map((k) => ({ uid: `p${page.id}-k${n++}`, type: k.type, props: k.props }));
          return { type: b.type, text: JSON.stringify({ ...b.props, children }) };
        }
        return { type: b.type, text: JSON.stringify(b.props) };
      });
      db.prepare("delete from blocks where page_id = ?").run(page.id);
      const insert = db.prepare("insert into blocks (page_id, position, type, props) values (?, ?, ?, ?)");
      out.forEach((b, position) => insert.run(page.id, position, b.type, b.text));
      touched = true;
    }
    // Brouillon de la page (s'il est lisible).
    if (page.draft) {
      let draft: { blocks?: unknown } | null = null;
      try {
        draft = JSON.parse(page.draft);
      } catch {}
      if (draft && Array.isArray(draft.blocks) && (draft.blocks as Raw[]).some((b) => b && LEGACY.has(b.type))) {
        const { blocks } = upgradeList(draft.blocks as Raw[], ctx, (i) => `b${i}`);
        db.prepare("update pages set draft = ? where id = ?").run(JSON.stringify({ ...draft, blocks }), page.id);
        touched = true;
      }
    }
    if (touched) pages++;
  }
  // Menu (v0.13) : réglage `nav` depuis l'ordre des pages.
  // Base neuve (migrations jouées avant le seed) : rien à figer, le seed rappelle cette fonction.
  const nav = db.prepare("select value from settings where key = 'nav'").get();
  const hasPages = (db.prepare("select count(*) n from pages").get() as { n: number }).n > 0;
  if (!nav && hasPages) {
    const items = (db.prepare("select id from pages where nav_order is not null order by nav_order, id").all() as { id: number }[]).map((p) => ({ kind: "page", pageId: p.id }));
    db.prepare("insert into settings (key, value) values ('nav', ?)").run(JSON.stringify(items));
  }
  return pages;
}

/* ---- 0016 : présentation du bloc Vidéo (`look` → `variant`) ------------------ */

const VIDEO_VARIANTS = new Set(["feature", "card", "plain"]);

/** Bloc Vidéo à l'ancien format : `look` est une chaîne (présentation), jamais les réglages du lot 2. */
function renameInTree(node: unknown): boolean {
  if (Array.isArray(node)) return node.map(renameInTree).some(Boolean);
  if (!node || typeof node !== "object") return false;
  const b = node as { type?: unknown; props?: Record<string, unknown> };
  let changed = false;
  if (b.type === "video-single" && b.props && typeof b.props.look === "string") {
    const look = b.props.look;
    delete b.props.look;
    if (VIDEO_VARIANTS.has(look) && b.props.variant === undefined) b.props.variant = look;
    changed = true;
  }
  if (b.props && Array.isArray(b.props.children)) changed = renameInTree(b.props.children) || changed;
  if (Array.isArray((node as { blocks?: unknown }).blocks)) changed = renameInTree((node as { blocks: unknown[] }).blocks) || changed;
  return changed;
}

/**
 * Migration 0016 (intégration lots 2 + v0.13) : la présentation du bloc Vidéo
 * s'appelait `look`, nom repris par les réglages de mise en page de TOUS les
 * blocs (lot 2, registre) : elle devient `variant`. Versions publiées (blocs
 * et leurs composants) et brouillons des pages. Idempotente ; renvoie le
 * nombre de lignes réécrites.
 */
export function renameVideoLook(db: Database.Database): number {
  let n = 0;
  for (const r of db.prepare("select id, type, props from blocks where type = 'video-single' or props like '%video-single%'").all() as { id: number; type: string; props: string }[]) {
    let props: unknown;
    try {
      props = JSON.parse(r.props);
    } catch {
      continue;
    }
    if (renameInTree({ type: r.type, props })) {
      db.prepare("update blocks set props = ? where id = ?").run(JSON.stringify(props), r.id);
      n++;
    }
  }
  for (const p of db.prepare("select id, draft from pages where draft like '%video-single%'").all() as { id: number; draft: string }[]) {
    let draft: unknown;
    try {
      draft = JSON.parse(p.draft);
    } catch {
      continue;
    }
    if (renameInTree(draft)) {
      db.prepare("update pages set draft = ? where id = ?").run(JSON.stringify(draft), p.id);
      n++;
    }
  }
  return n;
}

/* ---- 0018 : nom du site fr / en --------------------------------------------- */

/**
 * Migration 0018 (v0.16) : `site.name` (chaîne) devient { fr, en }, aussi dans le
 * brouillon du site (`siteDraft.snap.identity.name`). `en` reste vide : le site
 * montre le nom français dans les deux langues, comme avant. Idempotente
 * (un nom déjà fr / en n'est pas touché). Renvoie le nombre de réglages réécrits.
 */
export function siteNameI18n(db: Database.Database): number {
  const rewrite = (key: string, pick: (v: Record<string, unknown>) => Record<string, unknown> | null): number => {
    const row = db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    if (!row) return 0;
    let value: unknown;
    try {
      value = JSON.parse(row.value);
    } catch {
      return 0;
    }
    if (!value || typeof value !== "object") return 0;
    const holder = pick(value as Record<string, unknown>);
    if (!holder || typeof holder.name !== "string") return 0;
    holder.name = { fr: holder.name, en: "" };
    db.prepare("update settings set value = ? where key = ?").run(JSON.stringify(value), key);
    return 1;
  };
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
  return (
    rewrite("site", (v) => v) +
    rewrite("siteDraft", (v) => obj(obj(v.snap)?.identity))
  );
}

/* ---- 0019 : image pleine largeur au format imposé = « cover » ------------------- */

/** Image pleine largeur au format imposé, sans choix d'ajustement : avant la v0.17 elle remplissait son cadre. */
function pinFitInTree(node: unknown): boolean {
  if (Array.isArray(node)) return node.map(pinFitInTree).some(Boolean);
  if (!node || typeof node !== "object") return false;
  const b = node as { type?: unknown; props?: Record<string, unknown> };
  let changed = false;
  if (b.type === "image" && b.props && b.props.width === "full" && typeof b.props.ratio === "string" && b.props.ratio !== "auto" && b.props.fit === undefined) {
    b.props.fit = "cover";
    changed = true;
  }
  if (b.props && Array.isArray(b.props.children)) changed = pinFitInTree(b.props.children) || changed;
  if (Array.isArray((node as { blocks?: unknown }).blocks)) changed = pinFitInTree((node as { blocks: unknown[] }).blocks) || changed;
  return changed;
}

/**
 * Migration 0019 (v0.17) : le défaut de « Dans le cadre » d'une image pleine largeur à
 * format imposé passe de « cover » à « contain » pour les blocs NEUFS. Les blocs déjà
 * présents (publiés, dans un conteneur, brouillons) gardent leur rendu : `fit: "cover"`
 * est écrit sans action de l'artiste. Un choix explicite n'est jamais touché. Idempotente ;
 * renvoie le nombre de lignes réécrites.
 */
export function pinImageFit(db: Database.Database): number {
  let n = 0;
  for (const r of db.prepare("select id, type, props from blocks where type = 'image' or props like '%\"image\"%'").all() as { id: number; type: string; props: string }[]) {
    let props: unknown;
    try {
      props = JSON.parse(r.props);
    } catch {
      continue;
    }
    if (pinFitInTree({ type: r.type, props })) {
      db.prepare("update blocks set props = ? where id = ?").run(JSON.stringify(props), r.id);
      n++;
    }
  }
  for (const p of db.prepare("select id, draft from pages where draft like '%\"image\"%'").all() as { id: number; draft: string }[]) {
    let draft: unknown;
    try {
      draft = JSON.parse(p.draft);
    } catch {
      continue;
    }
    if (pinFitInTree(draft)) {
      db.prepare("update pages set draft = ? where id = ?").run(JSON.stringify(draft), p.id);
      n++;
    }
  }
  return n;
}
