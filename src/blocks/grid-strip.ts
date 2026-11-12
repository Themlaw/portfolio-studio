/**
 * Lot 69 : passer d'une Grille à « Images qui défilent » (et inversement) dans la planche d'un projet, SUR PLACE.
 *
 * Module pur (aucun accès à la base) : lu par l'éditeur (client) et les tests Node. Le composant garde son identifiant, sa
 * place dans la suite et sa largeur (`box`) ; seules ses données changent de forme.
 *
 * Correspondances (une image = une case de la grille = une place du carrousel, dans le même ordre) :
 * - image / vidéo ........ `mediaId` de la case <-> `media[i]` du carrousel (une case vide <-> une place vide) ;
 * - légendes ............. Titre / Légende / Date de la case (`captionTitle`, `caption` ou `description`, `captionDate`)
 *                          <-> `captions.<place>.title|caption|date` ;
 * - cadre, fond d'image .. `look.frame`, `look.imageBg` de la case <-> `slotLook[place].frame` / `.bg` de la rubrique de la page ;
 * - arrondi .............. `look.radius` de la case (sinon celui de la grille) <-> `slotLook[place].radius` ;
 * - lecture d'une vidéo .. `mode` de la case <-> `slotLook[place].video` (sinon la lecture de toute la bande, `videoMode`) ;
 * - son au départ ........ `sound` de la case <-> `slotLook[place].sound` (lot 127) ;
 * - fond, espace, carte .. `look` et `background` du composant : communs aux deux formes, jamais touchés.
 *
 * Tout ce qui n'a pas d'équivalent (agencement, colonnes, tailles de cases, espace entre les images, format des cases,
 * recadrages, images d'attente, titre de la grille…) est GARDÉ tel quel dans `props.converted` : l'autre forme le retrouve
 * au retour. Un réglage qui a un équivalent n'est repris que s'il a été changé entre-temps (comparaison avec ce que la
 * conversion avait écrit) ; sinon la valeur d'origine revient exactement. Un aller-retour sans retouche rend donc l'état de départ.
 */

import type { AdminT } from "@/i18n/admin-lang";

import { upgradeLook } from "../lib/look";

import { problemMsg } from "./block-msg";

import { MAX_GRID_CHILDREN, MAX_RAIL_MEDIA, PLACE_ID, railIds, railList, type BoardItem } from "./board-layout";

type Json = Record<string, unknown>;
type Text = { fr: string; en: string };
export type MediaKinds = Record<number, "image" | "video">;

/** Réglages d'UNE image dans un vocabulaire commun aux deux formes. */
type Fields = { title?: Text; caption?: Text; date?: Text; frame?: unknown; bg?: unknown; radius?: unknown; mode?: unknown; sound?: unknown };
const FIELD_KEYS = ["title", "caption", "date", "frame", "bg", "radius", "mode", "sound"] as const;

/** Mémoire de la forme quittée (`props.converted`). */
type Stash = { kind: "grid" | "strip"; props: Json; pairs: [string, string][]; orig: Record<string, Fields>; gen: Record<string, Fields> };

/**
 * Habillage par place (`look.slotLook`) de la rubrique de la page qui montre la planche (une entrée par place : `<uid du composant>-<place>`).
 * Champ commun -> champ de l'entrée : la lecture d'une vidéo (`mode`) s'y appelle `video`.
 */
const SLOT_FIELDS = { frame: "frame", bg: "bg", radius: "radius", mode: "video", sound: "sound" } as const;

const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown): v is Text => isObj(v) && typeof v.fr === "string" && typeof v.en === "string" && v.fr.length <= 2000 && v.en.length <= 2000;
const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Écriture stable (clés triées) : deux valeurs de même contenu sont égales, quel que soit l'ordre des clés. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  return v === undefined ? "u" : JSON.stringify(v);
}
const same = (a: unknown, b: unknown) => canon(a) === canon(b);

/** La mémoire d'une forme quittée, ou null (absente, de l'autre forme ou illisible : jamais fatale). */
export function readStash(raw: unknown, kind: "grid" | "strip"): Stash | null {
  if (!isObj(raw) || raw.kind !== kind || !isObj(raw.props) || !Array.isArray(raw.pairs) || !isObj(raw.orig) || !isObj(raw.gen)) return null;
  if (!raw.pairs.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string")) return null;
  return raw as unknown as Stash;
}

/** Identité d'une place tirée de celle d'une case (12 caractères au plus, `a-z0-9`), unique dans le carrousel. */
function placeIdFor(kidUid: string, rank: number, used: Set<string>): string {
  let id = kidUid.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-12);
  if (!PLACE_ID.test(id) || used.has(id)) id = `p${rank}`;
  for (let k = 0; used.has(id); k++) id = `p${rank}x${k}`;
  used.add(id);
  return id;
}

/* ---- Réglages d'une case de grille <-> champs communs ------------------------------------------------------------------- */

type Kid = { uid: string; type: "image" | "video-single"; props: Json };
const kidsOf = (props: Json): Kid[] =>
  (Array.isArray(props.children) ? props.children : []).filter((k): k is Kid => isObj(k) && typeof k.uid === "string" && (k.type === "image" || k.type === "video-single") && isObj(k.props));

function fieldsOfKid(kid: Kid, gridRadius: unknown): Fields {
  const p = kid.props;
  const look = isObj(p.look) ? p.look : {};
  const video = kid.type === "video-single";
  const f: Fields = {};
  if (isText(p.captionTitle)) f.title = p.captionTitle;
  const cap = video ? p.description : p.caption;
  if (isText(cap)) f.caption = cap;
  if (isText(p.captionDate)) f.date = p.captionDate;
  if (look.frame !== undefined) f.frame = look.frame;
  if (!video && look.imageBg !== undefined) f.bg = look.imageBg;
  const radius = look.radius ?? gridRadius;
  if (radius !== undefined) f.radius = radius;
  if (video) f.mode = p.mode === "loop" ? "loop" : "player";
  if (video && p.sound !== undefined) f.sound = p.sound;
  return f;
}

function applyToKid(kid: Kid, f: Fields): Kid {
  const props: Json = { ...kid.props };
  const set = (key: string, v: unknown) => {
    if (v === undefined) delete props[key];
    else props[key] = clone(v);
  };
  const video = kid.type === "video-single";
  set("captionTitle", f.title);
  set(video ? "description" : "caption", f.caption);
  set("captionDate", f.date);
  const look: Json = isObj(props.look) ? { ...props.look } : {};
  const had = isObj(props.look);
  const lset = (key: string, v: unknown) => {
    if (v === undefined) delete look[key];
    else look[key] = clone(v);
  };
  lset("frame", f.frame);
  if (!video) lset("imageBg", f.bg);
  lset("radius", f.radius);
  if (Object.keys(look).length) props.look = look;
  else if (had) props.look = look;
  if (video && f.mode !== undefined) props.mode = f.mode;
  if (video) set("sound", f.sound);
  return { ...kid, props };
}

/* ---- Réglages d'une place de carrousel <-> champs communs --------------------------------------------------------------- */

function fieldsOfPlace(strip: Json, slug: string, blockLook: Json): Fields {
  const caps = isObj(strip.captions) && Object.hasOwn(strip.captions, slug) && isObj(strip.captions[slug]) ? (strip.captions[slug] as Json) : {};
  const f: Fields = {};
  if (isText(caps.title)) f.title = caps.title;
  if (isText(caps.caption)) f.caption = caps.caption;
  if (isText(caps.date)) f.date = caps.date;
  const slots = blockLook.slotLook;
  const mine = isObj(slots) && Object.hasOwn(slots, slug) && isObj(slots[slug]) ? (slots[slug] as Json) : {};
  for (const key of ["frame", "bg", "radius"] as const) if (mine[SLOT_FIELDS[key]] !== undefined) f[key] = mine[SLOT_FIELDS[key]];
  if (mine.video !== undefined) f.mode = mine.video;
  else if (strip.videoMode === "loop" || strip.videoMode === "player") f.mode = strip.videoMode;
  if (mine.sound !== undefined) f.sound = mine.sound;
  return f;
}

/** Écrit les champs d'une place : `captions` (dans la bande) et `slotLook[place]` (dans `look` de la rubrique). */
function applyToPlace(captions: Record<string, Json>, look: Json, slug: string, f: Fields, kidIsVideo: boolean) {
  const entry: Json = {};
  if (f.title) entry.title = clone(f.title);
  if (f.caption) entry.caption = clone(f.caption);
  if (f.date) entry.date = clone(f.date);
  if (Object.keys(entry).length) captions[slug] = entry;
  for (const key of ["frame", "bg", "radius", "mode", "sound"] as const) {
    const v = (key === "mode" || key === "sound") && !kidIsVideo ? undefined : f[key];
    if (v === undefined) continue;
    const map: Json = isObj(look.slotLook) ? { ...(look.slotLook as Json) } : {};
    const mine: Json = isObj(map[slug]) ? { ...(map[slug] as Json) } : {};
    mine[SLOT_FIELDS[key]] = clone(v);
    map[slug] = mine;
    look.slotLook = map;
  }
}

/** Retire de la `look` de la rubrique les réglages des places `slugs` que la grille reprend (le panorama n'a pas d'équivalent en case : il reste). */
function dropPlaces(look: Json, slugs: string[]) {
  if (!isObj(look.slotLook)) return;
  const map: Json = { ...(look.slotLook as Json) };
  for (const s of slugs) {
    if (!isObj(map[s])) continue;
    const mine: Json = { ...(map[s] as Json) };
    for (const field of Object.values(SLOT_FIELDS)) delete mine[field];
    if (Object.keys(mine).length) map[s] = mine;
    else delete map[s];
  }
  if (Object.keys(map).length) look.slotLook = map;
  else delete look.slotLook;
}

/** `val = cur` si la valeur a été changée depuis la conversion (cur ≠ gen), sinon la valeur d'origine. */
function pick(cur: Fields, gen: Fields | undefined, orig: Fields | undefined): Fields {
  const out: Fields = {};
  for (const k of FIELD_KEYS) {
    const v = gen && orig && same(cur[k], gen[k]) ? orig[k] : cur[k];
    if (v !== undefined) (out as Json)[k] = v;
  }
  return out;
}

/* ---- API ----------------------------------------------------------------------------------------------------------------- */

export type ConvertCtx = {
  /** Genre (image / vidéo) des médias cités : décide du type des cases créées. */
  kinds: MediaKinds;
  /** Identifiant d'une case neuve. */
  newUid: () => string;
  /** `look` de la rubrique de la page qui montre la planche (cartes `slot*`). */
  look: Json | undefined;
};
export type ConvertResult = { item: BoardItem; look: Json | undefined } | { error: string };

/** Ce composant peut-il changer de forme ? Message (français simple) s'il ne le peut pas, sinon la forme d'arrivée. */
export function convertTarget(item: Pick<BoardItem, "type" | "props">, t?: AdminT): { to: "grid" | "strip" } | { reason: string } {
  if (item.type === "grid") return { to: "strip" };
  if (item.type === "strip") return item.props.source === "own" ? { to: "grid" } : { reason: problemMsg("stripCannotConvert", undefined, t) };
  return { reason: problemMsg("convertOnly", undefined, t) };
}

const cleanLookObj = (look: Json): Json | undefined => {
  const out: Json = {};
  for (const [k, v] of Object.entries(look)) if (v !== undefined && !(isObj(v) && Object.keys(v).length === 0)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
};

/**
 * Le composant dans l'autre forme (même `uid`, même `box`), et la `look` mise à jour de la rubrique de la page. Ne modifie rien.
 */
export function convertItem(item: BoardItem, to: "grid" | "strip", ctx: ConvertCtx, t?: AdminT): ConvertResult {
  const target = convertTarget(item, t);
  if ("reason" in target) return { error: target.reason };
  if (target.to !== to) return { error: problemMsg(to === "strip" ? "alreadyStrip" : "alreadyGrid", undefined, t) };
  // Un `look` d'avant le lot 75 (cinq cartes par place) est relu à la nouvelle forme : la conversion écrit toujours `slotLook`.
  const look: Json = isObj(ctx.look) ? (clone(upgradeLook(ctx.look)) as Json) : {};
  const out = to === "strip" ? toStrip(item, ctx, look, t) : toGrid(item, ctx, look, t);
  if ("error" in out) return out;
  return { item: { ...out.item, ...(item.box ? { box: item.box } : {}) }, look: cleanLookObj(look) };
}

function sharedProps(from: Json): Json {
  const out: Json = {};
  if (from.look !== undefined) out.look = clone(from.look);
  if (from.background !== undefined) out.background = clone(from.background);
  return out;
}

function toStrip(item: BoardItem, ctx: ConvertCtx, blockLook: Json, t?: AdminT): { item: BoardItem } | { error: string } {
  const G = item.props;
  const kids = kidsOf(G);
  if (kids.length > MAX_RAIL_MEDIA) return { error: problemMsg("carouselMaxImages", { max: MAX_RAIL_MEDIA }, t) };
  const stash = readStash(G.converted, "strip");
  const placeOf = new Map(stash?.pairs.map(([kid, place]) => [kid, place]) ?? []);
  const gridRadius = isObj(G.look) ? G.look.radius : undefined;
  const used = new Set<string>();
  const ids = kids.map((kid, i) => {
    const wanted = placeOf.get(kid.uid);
    if (wanted && PLACE_ID.test(wanted) && !used.has(wanted)) {
      used.add(wanted);
      return wanted;
    }
    return placeIdFor(kid.uid, i, used);
  });
  const base: Json = stash ? clone(stash.props) : { source: "own" };
  for (const k of ["media", "ids", "captions", "look", "background", "converted"]) delete base[k];
  const captions: Record<string, Json> = {};
  const orig: Record<string, Fields> = {};
  const gen: Record<string, Fields> = {};
  kids.forEach((kid, i) => {
    const slug = `${item.uid}-${ids[i]}`;
    const cur = fieldsOfKid(kid, gridRadius);
    const val = pick(cur, stash?.gen[ids[i]], stash?.orig[ids[i]]);
    // Origine = les réglages PROPRES de la case (l'arrondi de la grille n'en fait pas partie : il revient en retirant l'arrondi de la place).
    orig[ids[i]] = fieldsOfKid(kid, undefined);
    gen[ids[i]] = val;
    applyToPlace(captions, blockLook, slug, val, kid.type === "video-single");
  });
  const props: Json = {
    ...base,
    source: "own",
    media: kids.map((k) => (typeof k.props.mediaId === "number" ? k.props.mediaId : null)),
    ids,
    ...(Object.keys(captions).length ? { captions } : {}),
    ...sharedProps(G),
    converted: { kind: "grid", props: clone(G), pairs: kids.map((k, i) => [k.uid, ids[i]]), orig, gen } satisfies Stash,
  };
  return { item: { uid: item.uid, type: "strip", props } };
}

function toGrid(item: BoardItem, ctx: ConvertCtx, blockLook: Json, t?: AdminT): { item: BoardItem } | { error: string } {
  const S = item.props;
  const media = railList(S);
  const ids = railIds(S);
  if (media.length > MAX_GRID_CHILDREN) return { error: problemMsg("gridMaxImages", { max: MAX_GRID_CHILDREN, extra: media.length - MAX_GRID_CHILDREN }, t) };
  const stash = readStash(S.converted, "grid");
  const kidOf = new Map(stash?.pairs.map(([kid, place]) => [place, kid]) ?? []);
  const baseKids = new Map(kidsOf(stash?.props ?? {}).map((k) => [k.uid, k]));
  const children: Kid[] = [];
  const pairs: [string, string][] = [];
  const orig: Record<string, Fields> = {};
  const gen: Record<string, Fields> = {};
  const slugs = ids.map((id) => `${item.uid}-${id}`);
  const usedKids = new Set<string>();
  media.forEach((m, i) => {
    const wantedType: Kid["type"] | null = m === null ? null : ctx.kinds[m] === "video" ? "video-single" : "image";
    const found = baseKids.get(kidOf.get(ids[i]) ?? "");
    let kid: Kid;
    if (found && !usedKids.has(found.uid) && (wantedType === null || found.type === wantedType)) kid = clone(found);
    else kid = wantedType === "video-single" ? { uid: ctx.newUid(), type: "video-single", props: { variant: "card", mode: "player" } } : { uid: ctx.newUid(), type: "image", props: { width: "wide" } };
    usedKids.add(kid.uid);
    if (m === null) delete kid.props.mediaId;
    else kid.props.mediaId = m;
    const cur = fieldsOfPlace(S, slugs[i], blockLook);
    const val = pick(cur, stash?.gen[ids[i]], stash?.orig[ids[i]]);
    orig[ids[i]] = cur;
    gen[ids[i]] = val;
    children.push(applyToKid(kid, val));
    pairs.push([kid.uid, ids[i]]);
  });
  dropPlaces(blockLook, slugs);
  const base: Json = stash ? clone(stash.props) : { layout: "auto" };
  for (const k of ["children", "look", "background"]) delete base[k];
  const props: Json = { ...base, ...sharedProps(S), children };
  // Carrousel d'origine (jamais passé par une grille) : ses réglages propres sont gardés pour le retour.
  if (!stash) props.converted = { kind: "strip", props: clone(S), pairs, orig, gen } satisfies Stash;
  return { item: { uid: item.uid, type: "grid", props } };
}
