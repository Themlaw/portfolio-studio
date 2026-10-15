/**
 * Contenu d'une planche de projet (lot 31), côté serveur : contrôle d'une suite de composants avant de
 * l'écrire en surcouche de brouillon (`complete: false`, un composant peut être inachevé) ou de la publier
 * (`complete: true`, mêmes exigences qu'une rubrique de page : image choisie, texte d'exemple remplacé…).
 *
 * Chaque composant passe par le schéma du registre de son type (les mêmes qu'une page, donc le même rendu) ;
 * les médias cités existent, ne sont pas à la corbeille et sont du bon genre (image / vidéo, jamais un PDF).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";

import { BLOCKS } from "@/blocks/registry";
import { GRID_CHILD_TYPES, itemEmpty, layoutProblem, type BoardItem, BOARD_ITEM_LABELS } from "@/blocks/board-layout";
import { getDb, schema } from "@/lib/db";
import { own } from "@/lib/own";

type Json = Record<string, unknown>;

/**
 * Le composant, ses réglages passés par le schéma de son type (clés inconnues retirées, valeurs par défaut posées),
 * ou le message du premier défaut.
 */
function parseItem(item: BoardItem): { item: BoardItem } | { error: string } {
  // Largeur et alignement : communs à tous les composants, jamais passés par le schéma du bloc.
  const keep = (out: BoardItem): BoardItem => (item.box ? { ...out, box: item.box } : out);
  if (item.type === "strip") return { item: keep(item) };
  const def = own(BLOCKS, item.type);
  if (!def) return { error: "Composant de planche inconnu." };
  const result = def.schema.safeParse(item.props);
  if (!result.success) return { error: `Réglages invalides pour « ${BOARD_ITEM_LABELS[item.type]} » : ${result.error.issues[0]?.message ?? "vérifie ce composant"}.` };
  const props = { ...(result.data as Json) } as Json;
  if (item.type === "grid") {
    const kids: BoardItem[] = [];
    for (const raw of (props.children as { uid: string; type: string; props: Json }[]) ?? []) {
      if (!(GRID_CHILD_TYPES as readonly string[]).includes(raw.type)) return { error: "Une grille de planche n'accepte que des images et des vidéos." };
      const childDef = own(BLOCKS, raw.type);
      const parsed = childDef?.schema.safeParse(raw.props);
      if (!childDef || !parsed?.success) return { error: "Un élément de la grille a des réglages invalides." };
      kids.push({ uid: raw.uid, type: raw.type as BoardItem["type"], props: parsed.data as Json });
    }
    props.children = kids;
  }
  return { item: keep({ uid: item.uid, type: item.type, props }) };
}

/** Médias cités (images, vidéos, images d'attente) avec le genre attendu : « image », « video » ou « any » (poster). */
function mediaWanted(item: BoardItem): { id: number; kind: "image" | "video" | "poster" | "any" }[] {
  const out: { id: number; kind: "image" | "video" | "poster" | "any" }[] = [];
  const take = (type: string, props: Json) => {
    if (typeof props.mediaId === "number") out.push({ id: props.mediaId, kind: type === "video-single" ? "video" : "image" });
    if (type === "video-single" && typeof props.posterMediaId === "number") out.push({ id: props.posterMediaId, kind: "poster" });
  };
  if (item.type === "strip" && item.props.source === "own") {
    for (const id of (Array.isArray(item.props.media) ? item.props.media : []) as unknown[]) if (typeof id === "number") out.push({ id, kind: "any" });
  } else if (item.type === "image" || item.type === "video-single") take(item.type, item.props);
  else if (item.type === "grid") for (const kid of (item.props.children as { type: string; props: Json }[]) ?? []) take(kid.type, kid.props);
  return out;
}

/**
 * Suite contrôlée : la suite à écrire (réglages normalisés), ou un message en français.
 * `allowPending` : Annuler / Rétablir peut rétablir un média encore en conversion.
 */
export function checkLayout(input: unknown, opts: { complete?: boolean; allowPending?: boolean } = {}): { layout: BoardItem[] } | { error: string } {
  const problem = layoutProblem(input);
  if (problem) return { error: problem };
  const out: BoardItem[] = [];
  for (const raw of input as BoardItem[]) {
    const parsed = parseItem(raw);
    if ("error" in parsed) return parsed;
    out.push(parsed.item);
  }
  const wanted = out.flatMap((i) => mediaWanted(i));
  if (wanted.length) {
    const rows = getDb()
      .select({ id: schema.media.id, kind: schema.media.kind, status: schema.media.status, deletedAt: schema.media.deletedAt })
      .from(schema.media)
      .where(inArray(schema.media.id, [...new Set(wanted.map((w) => w.id))]))
      .all();
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const w of wanted) {
      const m = byId.get(w.id);
      if (!m || m.deletedAt) return { error: "Un média de cette planche n'existe plus : choisis-en un autre." };
      if (m.kind === "pdf") return { error: "Un PDF ne se place pas dans une planche : utilise la rubrique « CV »." };
      if (w.kind === "any" && m.kind !== "image" && m.kind !== "video") return { error: "Un carrousel n'accepte que des images et des vidéos." };
      if (w.kind === "image" && m.kind !== "image") return { error: "Ce composant attend une image, pas une vidéo." };
      if (w.kind === "video" && m.kind !== "video") return { error: "Ce composant attend une vidéo, pas une image." };
      if (m.status === "failed") return { error: "Ce média est en échec : relance-le depuis la médiathèque avant de le placer." };
      if (m.status !== "ready" && !(opts.allowPending && m.status === "processing")) return { error: "Ce média est encore en conversion : attends qu'il soit prêt pour le placer." };
    }
  }
  if (opts.complete) {
    for (const item of out) {
      const label = BOARD_ITEM_LABELS[item.type];
      if (itemEmpty(item)) return { error: `Le composant « ${label} » est encore vide : remplis-le, ou supprime-le.` };
      const def = own(BLOCKS, item.type);
      const required = def?.publishCheck?.(item.props, {});
      if (required) return { error: `${label} : ${required.charAt(0).toLowerCase()}${required.slice(1)}` };
    }
  }
  return { layout: out };
}

/** Projets (publiés ou créés dans ce brouillon) dont une suite en surcouche de cette page est incomplète : message, sinon null. */
export function incompleteLayouts(pageId: number, cited: Set<number>): string | null {
  const rows = getDb()
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.draftLayoutPageId, pageId), isNull(schema.projects.deletedAt)))
    .all();
  for (const p of rows) {
    if (!p.draftLayout || !cited.has(p.id)) continue;
    const r = checkLayout(p.draftLayout, { complete: true });
    if ("error" in r) return `Publication impossible : planche « ${p.title.fr || p.slug} » — ${r.error.charAt(0).toLowerCase()}${r.error.slice(1)}`;
  }
  // Projet créé dans ce brouillon : sa suite est sur sa ligne.
  for (const p of getDb().select().from(schema.projects).where(eq(schema.projects.draftPageId, pageId)).all()) {
    if (!p.layout || !cited.has(p.id)) continue;
    const r = checkLayout(p.layout, { complete: true });
    if ("error" in r) return `Publication impossible : planche « ${p.title.fr || p.slug} » — ${r.error.charAt(0).toLowerCase()}${r.error.slice(1)}`;
  }
  return null;
}
