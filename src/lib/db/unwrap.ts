/**
 * Migration de contenu 0021 (v0.19), idempotente : le conteneur « Projet mis en avant » (`featured-project`)
 * disparaît ; ses composants deviennent des blocs de premier niveau, à la même place et dans le même ordre.
 * Appliquée à la version publiée (table `blocks`), aux brouillons de page (`pages.draft`) et aux conteneurs
 * imbriqués (la grille qu'il portait remonte avec ses propres composants).
 *
 * Ce que devient chaque réglage du conteneur :
 * - `project` : un composant qui le reprenait sans projet propre le porte désormais en dur — Planche d'un projet
 *   (`project`) et Titre lié (`project`, nouveau champ du Titre, `linked` gardé). Ces blocs restent donc liés au
 *   projet : son nom, sa présentation et ses images (et, dans l'éditeur, la surcouche de textes du projet,
 *   `projects.draft_text`) suivent comme avant. Un conteneur sans projet ne donne rien à porter : ses composants
 *   restent tels quels (une planche ou un Titre lié sans projet ne rendait déjà rien en public).
 * - `more` (lien « voir plus ») : bloc « Lien vers une page » (`page-link`) posé après le dernier composant, même
 *   balisage que l'ancien lien. Un conteneur vide n'affichait rien en public, lien compris : en version publiée il
 *   disparaît avec son lien ; dans un brouillon le lien est gardé (travail en cours).
 * - `look` : espace du haut sur le premier composant, espace du bas sur le dernier (le conteneur n'avait pas de
 *   boîte : c'est déjà ce que faisait le rendu) ; les autres réglages (arrondi, position des titres, fond du métier,
 *   arrondis d'images…) passent à chaque composant, sous les siens propres (un réglage du composant gagne).
 * - `surface` (carte de couleur) : chaque composant porte la même carte (une carte par bloc de premier niveau :
 *   elle ne peut plus envelopper le groupe). Une carte périmée sur un composant (jamais rendue dans un conteneur) est
 *   retirée pour ne pas apparaître d'un coup.
 *
 * Limite de 40 blocs par page : un conteneur dont l'ouverture ferait dépasser la limite reste en place (encore lu
 * et rendu par le code ; aucune UI n'en crée) ; la migration le dira dans le journal.
 *
 * Module sans accès à l'application hors zod/look/surface (lu par le migrateur, le seed et les tests Node).
 */
import type Database from "better-sqlite3";

import { readLook, type Look } from "@/lib/look";
import { readSurface } from "@/themes/surface";

type Raw = { uid?: string; type: string; props: Record<string, unknown> };

export const CONTAINER = "featured-project";
/** Blocs au plus sur une page (même borne que l'éditeur et savePage). */
const MAX_PAGE_BLOCKS = 40;

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Composants d'un conteneur : objets typés seulement (le reste n'a jamais été rendu). */
function kidsOf(props: Record<string, unknown>): Raw[] {
  const c = props.children;
  return Array.isArray(c) ? (c.filter((x) => isObj(x) && typeof x.type === "string") as unknown as Raw[]) : [];
}

/** Les composants qui reprenaient le projet du conteneur le portent désormais (grille comprise). */
function pinProject(block: Raw, project: string): void {
  const props = block.props;
  if (block.type === "project-board" && typeof props.project !== "string") props.project = project;
  else if (block.type === "section-title" && props.linked && typeof props.project !== "string") props.project = project;
  else if (block.type === "grid") for (const k of kidsOf(props)) pinProject(k, typeof props.project === "string" ? props.project : project);
}

/** `own` gagne sur `base` ; les tables (textes, cadrages, arrondis d'images) se fusionnent clé par clé. */
function mergeLook(base: Look, own: Look | undefined): Look | undefined {
  const out: Record<string, unknown> = { ...(own ?? {}) };
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    const mine = out[k];
    if (mine === undefined) out[k] = clone(v);
    else if (isObj(mine) && isObj(v)) out[k] = { ...clone(v), ...mine };
  }
  return Object.keys(out).length ? (out as Look) : undefined;
}

type Options = {
  /** Brouillon : uid conservés (et créés pour le lien), conteneur vide au lien gardé. */
  draft: boolean;
  /** uid déjà pris dans l'arbre (le lien en reçoit un neuf). */
  used: Set<string>;
};

function freshUid(base: string, used: Set<string>): string {
  const stem = base.replace(/[^a-z0-9-]/g, "").slice(0, 26) || "l";
  let n = 0;
  let id = `${stem}-l`;
  while (used.has(id)) id = `${stem}-l${++n}`;
  used.add(id);
  return id;
}

/** Les blocs qui remplacent un conteneur, dans l'ordre de la page. */
export function expandContainer(container: Raw, opts: Options, inheritedProject?: string): Raw[] {
  const props = isObj(container.props) ? container.props : {};
  const project = typeof props.project === "string" ? props.project : inheritedProject;
  const look = readLook(props.look);
  const surface = readSurface(props.surface);
  const more = isObj(props.more) ? props.more : null;
  // Composants à plat (un conteneur dans un conteneur, hors règles, est aplati de même).
  const flat: Raw[] = [];
  for (const k of kidsOf(props)) {
    if (k.type === CONTAINER) flat.push(...expandContainer(clone(k), opts, project));
    else flat.push(clone({ ...k, props: isObj(k.props) ? k.props : {} }));
  }
  const rest: Look = { ...(look ?? {}) };
  delete rest.spaceTop;
  delete rest.spaceBottom;
  // Le style du texte du lien « voir plus » (`text["more.label"]`) va au bloc « Lien vers une page », pas aux composants.
  const moreStyle = isObj(rest.text) && isObj((rest.text as Record<string, unknown>)["more.label"]) ? clone((rest.text as Record<string, unknown>)["more.label"]) : undefined;
  if (moreStyle !== undefined && isObj(rest.text)) {
    const text = { ...(rest.text as Record<string, unknown>) };
    delete text["more.label"];
    if (Object.keys(text).length) (rest as Record<string, unknown>).text = text;
    else delete (rest as Record<string, unknown>).text;
  }
  const out = flat.map((k, i) => {
    if (project) pinProject(k, project);
    const base: Look = { ...rest };
    if (i === 0 && look?.spaceTop) base.spaceTop = look.spaceTop;
    if (i === flat.length - 1 && look?.spaceBottom) base.spaceBottom = look.spaceBottom;
    const merged = mergeLook(base, readLook(k.props.look));
    if (merged) k.props.look = merged;
    else delete k.props.look;
    // Carte : celle du conteneur, ou aucune (une carte périmée d'un composant ne s'est jamais affichée).
    if (surface) k.props.surface = clone(surface);
    else delete k.props.surface;
    if (!opts.draft) delete k.uid;
    return k;
  });
  if (more && (out.length > 0 || opts.draft)) {
    const link: Raw = { type: "page-link", props: { label: clone(more.label ?? { fr: "", en: "" }), ...(typeof more.pageId === "number" ? { pageId: more.pageId } : {}), ...(moreStyle !== undefined ? { look: { text: { label: moreStyle } } } : {}), ...(surface ? { surface: clone(surface) } : {}) } };
    if (opts.draft) link.uid = freshUid(container.uid ?? "c", opts.used);
    out.push(link);
  }
  return out;
}

function allUids(blocks: unknown[], into = new Set<string>()): Set<string> {
  for (const b of blocks) {
    if (!isObj(b)) continue;
    if (typeof b.uid === "string") into.add(b.uid);
    const kids = isObj(b.props) ? b.props.children : undefined;
    if (Array.isArray(kids)) allUids(kids, into);
  }
  return into;
}

export type UnwrapResult = { blocks: Raw[]; changed: boolean; unwrapped: number; kept: number };

/** Déballe les conteneurs de premier niveau d'une liste de blocs (page ou brouillon). */
export function unwrapList(list: Raw[], draft: boolean): UnwrapResult {
  const opts: Options = { draft, used: allUids(list) };
  const out: Raw[] = [];
  let unwrapped = 0;
  let kept = 0;
  // Place restante : la page garde sa longueur, ou la borne si elle la dépassait déjà.
  const total = (rest: number) => out.length + rest;
  list.forEach((b, i) => {
    if (!isObj(b) || b.type !== CONTAINER) {
      out.push(b);
      return;
    }
    const expansion = expandContainer(b, opts);
    if (total(list.length - i - 1) + expansion.length > MAX_PAGE_BLOCKS && expansion.length > 1) {
      kept++;
      out.push(b);
      return;
    }
    unwrapped++;
    out.push(...expansion);
  });
  return { blocks: out, changed: unwrapped > 0, unwrapped, kept };
}

export type UnwrapReport = { pages: number; published: number; drafts: number; unwrapped: number; kept: number };

/**
 * Migration 0021 sur une base : version publiée et brouillons. Idempotente (plus aucun conteneur à déballer
 * au second passage). Un brouillon modifié voit sa version (`draft_rev`) augmenter : un onglet d'édition resté
 * ouvert reçoit un conflit au lieu de ré-enregistrer l'ancien conteneur.
 */
export function unwrapContainers(db: Database.Database): UnwrapReport {
  const report: UnwrapReport = { pages: 0, published: 0, drafts: 0, unwrapped: 0, kept: 0 };
  const pages = db.prepare("select id, draft from pages").all() as { id: number; draft: string | null }[];
  for (const page of pages) {
    let touched = false;
    const rows = db.prepare("select id, type, props from blocks where page_id = ? order by position, id").all(page.id) as { id: number; type: string; props: string }[];
    if (rows.some((r) => r.type === CONTAINER)) {
      const original = new Map<Raw, string>();
      const list: Raw[] = rows.map((r) => {
        let props: unknown = null;
        try {
          props = JSON.parse(r.props);
        } catch {}
        const raw: Raw = { type: r.type, props: isObj(props) ? props : {} };
        original.set(raw, r.props);
        return raw;
      });
      const res = unwrapList(list, false);
      report.unwrapped += res.unwrapped;
      report.kept += res.kept;
      if (res.changed) {
        db.prepare("delete from blocks where page_id = ?").run(page.id);
        const insert = db.prepare("insert into blocks (page_id, position, type, props) values (?, ?, ?, ?)");
        res.blocks.forEach((b, position) => insert.run(page.id, position, b.type, original.get(b) ?? JSON.stringify(b.props)));
        report.published++;
        touched = true;
      }
    }
    if (page.draft) {
      let draft: unknown = null;
      try {
        draft = JSON.parse(page.draft);
      } catch {}
      if (isObj(draft) && Array.isArray(draft.blocks) && (draft.blocks as Raw[]).some((b) => isObj(b) && b.type === CONTAINER)) {
        const res = unwrapList(draft.blocks as Raw[], true);
        report.unwrapped += res.unwrapped;
        report.kept += res.kept;
        if (res.changed) {
          db.prepare("update pages set draft = ?, draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify({ ...draft, blocks: res.blocks }), page.id);
          report.drafts++;
          touched = true;
        }
      }
    }
    if (touched) report.pages++;
  }
  return report;
}
