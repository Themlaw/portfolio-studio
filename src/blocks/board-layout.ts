/**
 * Contenu d'une planche de projet (lot 31) : une SUITE de composants rangés
 * sous l'en-tête (nom, contexte, présentation). Elle appartient au PROJET (colonnes
 * `projects.layout` / `draft_layout`, comme les textes et les emplacements), pas à la page :
 * elle suit le projet partout où sa planche est affichée.
 *
 * - « Images qui défilent » (`strip`) : la bande d'images du projet (ses emplacements),
 *   facultative, au plus une par planche.
 * - Grille (`grid`, images et vidéos), Image (`image`, pleine largeur comprise), Vidéo
 *   (`video-single`), Texte (`rich-text`) : les mêmes composants que sur une page, avec les
 *   mêmes schémas (validés par le registre côté serveur).
 *
 * Module pur (seul import : les textes d'aide, pur lui aussi) : lu par le serveur (lecture, écriture, publication,
 * références), l'éditeur (client) et les tests Node.
 */

import { HELP_TEXT } from "./help-text";
import { StrokeTintSchema } from "@/lib/look";

import { isVideoMode } from "./video-mode";

export type BoardItemType = "strip" | "grid" | "image" | "video-single" | "free-board" | "rich-text";
/**
 * Largeur et alignement de TOUT composant de la planche (lot 31b), réglage commun hors des props du composant
 * (les schémas des blocs retirent les clés inconnues). Absent ou largeur 100 = rendu d'avant, sans enveloppe.
 * Largeur en % de la largeur du cadre du site (20 à 100).
 */
export type BoardBox = { width?: number; align?: "left" | "center" | "right" };
export type BoardItem = { uid: string; type: BoardItemType; props: Record<string, unknown>; box?: BoardBox; captionStyle?: ProjectCaptionStyle };

/**
 * Style des légendes d'un PROJET (lot 98) : un style par champ (titre, légende, date), pour toutes les légendes des images du
 * projet, partout où il est affiché. Réglage commun à la suite (comme `box`, hors des props) : il vit sur le PREMIER composant de la
 * suite (`projectCaptionStyle` le retrouve où qu'il soit, `checkLayout` le remet en tête) et se publie avec la suite.
 * Les styles sont des `TextStyle` (src/lib/look.ts), validés par le serveur (`checkLayout`).
 */
export const CAPTION_STYLE_FIELDS = ["title", "legend", "date"] as const;
export type CaptionStyleField = (typeof CAPTION_STYLE_FIELDS)[number];
export type ProjectCaptionStyle = Partial<Record<CaptionStyleField, Record<string, unknown>>>;
/** Champ de style d'une légende d'après le chemin de son texte (`captionTitle`, `caption`, `description`, `captionDate`, `captions.<place>.<champ>`). */
export function captionFieldOf(path: string): CaptionStyleField | null {
  const last = path.split(".").pop() ?? "";
  if (last === "captionTitle" || (last === "title" && path.startsWith("captions."))) return "title";
  if (last === "caption" || last === "description") return "legend";
  if (last === "captionDate" || (last === "date" && path.startsWith("captions."))) return "date";
  return null;
}

/** Préréglages de largeur (Petite ~1/3, Moyenne ~1/2, Grande ~2/3, Pleine largeur). */
export const BOX_PRESETS: { id: string; label: string; width: number }[] = [
  { id: "small", label: "Petite", width: 33 },
  { id: "medium", label: "Moyenne", width: 50 },
  { id: "large", label: "Grande", width: 67 },
  { id: "full", label: "Pleine largeur", width: 100 },
];
export const BOX_MIN = 20;
export const BOX_ALIGNS = ["left", "center", "right"] as const;
/** Le composant est-il réellement réduit (largeur < 100) ? Sinon : aucune enveloppe, rendu inchangé. */
export const boxActive = (box: BoardBox | undefined): box is BoardBox & { width: number } => typeof box?.width === "number" && box.width < 100;
/** Médias au plus dans un carrousel à liste propre. */
export const MAX_RAIL_MEDIA = 60;
/**
 * Pour l'artiste il n'y a qu'UN composant « Images qui défilent ». En interne il a deux sources : les images du PROJET (la bande
 * d'origine, `props` sans `source` : ses emplacements sont ceux du projet, utilisés aussi par les tuiles de collection, la couverture,
 * le compteur et la visionneuse) ou une liste propre (`source: "own"`, `media`). Même rendu, mêmes outils par image.
 * Dans la liste propre, `null` est une place gardée vide (comme un emplacement vide du projet).
 */
export type RailMedia = (number | null)[];
/** Clé d'une place d'un carrousel à liste propre sur la toile : `<uid du composant>.<rang dans la liste>`. */
export const railKey = (uid: string, at: number) => `${uid}.${at}`;
/** Le composant et le rang qu'une clé de place désigne, ou null (clé d'un emplacement du projet). */
export function parseRailKey(key: string): { uid: string; at: number } | null {
  const m = /^([a-z0-9-]{1,32})\.(\d{1,3})$/.exec(key);
  return m ? { uid: m[1], at: Number(m[2]) } : null;
}
/** La liste d'un carrousel à liste propre (places vides comprises), jamais une entrée illisible. */
export const railList = (props: Record<string, unknown>): RailMedia => (Array.isArray(props.media) ? props.media : []).map((x) => (typeof x === "number" && Number.isInteger(x) && x > 0 ? x : null));
/**
 * Identité de chaque place d'un carrousel à liste propre (`props.ids`, parallèle à `media`) : l'arrondi et le cadre d'une place
 * (`look.slotLook` du bloc, par slug `<uid>-<identité>`) la suivent quand on la déplace, qu'on remplace son image
 * ou qu'on en retire une autre, comme ceux d'un emplacement du projet. Absentes ou illisibles (carrousel d'avant le lot 31f) : `p<rang>`,
 * puis écrites telles quelles au premier geste.
 */
export const PLACE_ID = /^[a-z0-9]{1,12}$/;
export function railIds(props: Record<string, unknown>): string[] {
  const media = railList(props);
  const raw = props.ids;
  if (Array.isArray(raw) && raw.length === media.length && raw.every((x) => typeof x === "string" && PLACE_ID.test(x)) && new Set(raw).size === raw.length) return raw as string[];
  return media.map((_, i) => `p${i}`);
}
/**
 * Titre, Légende et Date sous chaque image d'« Images qui défilent » (lot 39) : `props.captions`, par place, dont la clé est le
 * slug de la place (`<uid>-<identité>` pour un carrousel à liste propre, slug de l'emplacement pour la bande du projet). Elles
 * suivent la place quand on la déplace ou qu'on remplace son image. Pour la bande du projet, Titre et Légende restent ceux de
 * l'emplacement (colonnes `title` / `description`, partagés avec la visionneuse et les autres pages) : seule la Date est ici ;
 * sans date posée ici, la bande montre l'année de l'emplacement, comme avant.
 */
export const CAPTION_KEY = /^[a-z0-9-]{1,80}$/;
export const CAPTION_FIELDS = ["title", "caption", "date"] as const;
export type CaptionFieldName = (typeof CAPTION_FIELDS)[number];
export type CaptionText = { fr: string; en: string };
export type StripCaption = Partial<Record<CaptionFieldName, CaptionText>>;
const MAX_CAPTION_TEXT = 2000;
const isCaptionText = (v: unknown): v is CaptionText => isObj(v) && typeof v.fr === "string" && typeof v.en === "string" && v.fr.length <= MAX_CAPTION_TEXT && v.en.length <= MAX_CAPTION_TEXT;
/** Les textes des places d'une bande (une entrée illisible est ignorée, jamais une bande cassée). */
export function stripCaptions(props: Record<string, unknown>): Record<string, StripCaption> {
  const raw = props.captions;
  const out: Record<string, StripCaption> = {};
  if (!isObj(raw)) return out;
  for (const [key, v] of Object.entries(raw)) {
    if (!CAPTION_KEY.test(key) || !isObj(v)) continue;
    const entry: StripCaption = {};
    for (const f of CAPTION_FIELDS) if (isCaptionText(v[f])) entry[f] = v[f];
    out[key] = entry;
  }
  return out;
}
/** Chemin d'un texte de place d'une bande (`captions.<slug>.<champ>`) : le slug et le champ, ou null. */
export function parseCaptionPath(path: string): { key: string; field: CaptionFieldName } | null {
  const m = /^captions\.([a-z0-9-]{1,80})\.(title|caption|date)$/.exec(path);
  return m ? { key: m[1], field: m[2] as CaptionFieldName } : null;
}

/** Bande des images du PROJET (la bande d'origine, `props` vides) ou carrousel à liste propre (`source: "own"`, `media`). */
export const isProjectStrip = (item: { type: string; props: Record<string, unknown> }) => item.type === "strip" && item.props.source !== "own";

/** Types proposés dans une planche, dans l'ordre du menu « + Ajouter ». */
export const BOARD_ITEM_TYPES: BoardItemType[] = ["strip", "grid", "image", "video-single", "free-board", "rich-text"];

/** Libellés simples, tels que l'artiste les lit. */
export const BOARD_ITEM_LABELS: Record<BoardItemType, string> = {
  strip: "Images qui défilent",
  grid: "Grille",
  image: "Image",
  "video-single": "Vidéo",
  "free-board": "Planche libre",
  "rich-text": "Texte",
};

/** Une phrase par type (menu d'ajout). */
export const BOARD_ITEM_HINTS: Record<BoardItemType, string> = {
  strip: "Les images du projet en bande, qui défile sur le côté.",
  grid: "Des images ou des vidéos rangées en colonnes.",
  image: "Une image seule, jusqu'à la pleine largeur.",
  "video-single": "Une vidéo de ta médiathèque.",
  "free-board": "Des images détourées posées où tu veux, à ta taille et sous l'angle que tu veux.",
  "rich-text": "Un paragraphe, avec un titre si tu veux.",
};

/** Composants au plus dans la suite d'une planche. */
export const MAX_BOARD_ITEMS = 12;
/** Composants au plus dans une grille de planche (comme une grille de page). */
export const MAX_GRID_CHILDREN = 24;
/** Ce qu'une grille de planche accepte : des images et des vidéos. */
export const GRID_CHILD_TYPES = ["image", "video-single"] as const;
/** Taille maximale de la suite sérialisée (octets). */
export const MAX_LAYOUT_BYTES = 96 * 1024;

const UID = /^[a-z0-9-]{1,32}$/;

export const isBoardItemType = (t: unknown): t is BoardItemType => typeof t === "string" && (BOARD_ITEM_TYPES as string[]).includes(t);

/** La suite d'un projet qui n'en a jamais eu : la bande d'images seule (rendu d'avant le lot 31). */
export function defaultLayout(): BoardItem[] {
  return [{ uid: "strip", type: "strip", props: {} }];
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Le style des légendes du projet porté par la suite (le premier composant qui en a un), ou undefined. */
export function projectCaptionStyle(layout: readonly { captionStyle?: unknown }[] | undefined): ProjectCaptionStyle | undefined {
  for (const item of layout ?? []) if (isObj(item?.captionStyle) && Object.keys(item.captionStyle).length) return item.captionStyle as ProjectCaptionStyle;
  return undefined;
}

/**
 * Premier problème de forme d'une suite (types permis, uid bien formés et uniques, une seule bande, bornes),
 * ou null. Les réglages de chaque composant se valident ensuite par le schéma de son type (registre).
 */
export function layoutProblem(raw: unknown): string | null {
  if (!Array.isArray(raw)) return "Contenu de projet illisible.";
  if (raw.length > MAX_BOARD_ITEMS) return `${MAX_BOARD_ITEMS} blocs au plus par projet.`;
  const uids = new Set<string>();
  let strips = 0;
  for (const item of raw) {
    if (!isObj(item) || !isBoardItemType(item.type)) return "Bloc de projet inconnu.";
    if (typeof item.uid !== "string" || !UID.test(item.uid)) return "Identifiant de bloc invalide.";
    if (uids.has(item.uid)) return "Blocs de projet en double.";
    uids.add(item.uid);
    if (!isObj(item.props)) return "Réglages d'un bloc illisibles.";
    if (item.box !== undefined) {
      const b = item.box as Record<string, unknown>;
      if (!isObj(b) || Object.keys(b).some((k) => k !== "width" && k !== "align")) return "Largeur du bloc illisible.";
      if (b.width !== undefined && !(typeof b.width === "number" && Number.isFinite(b.width) && b.width >= BOX_MIN && b.width <= 100)) return `Largeur du bloc : entre ${BOX_MIN} et 100 %.`;
      if (b.align !== undefined && !(BOX_ALIGNS as readonly unknown[]).includes(b.align)) return "Alignement du bloc invalide.";
    }
    if (item.captionStyle !== undefined) {
      const c = item.captionStyle;
      if (!isObj(c) || Object.keys(c).some((k) => !(CAPTION_STYLE_FIELDS as readonly string[]).includes(k) || !isObj(c[k]))) return "Style des légendes du projet illisible.";
    }
    if (item.type === "strip") {
      if (item.props.captions !== undefined) {
        const c = item.props.captions;
        if (!isObj(c) || Object.keys(c).length > 400) return "Textes des images de la bande illisibles.";
        for (const [key, v] of Object.entries(c)) {
          if (!CAPTION_KEY.test(key) || !isObj(v) || Object.keys(v).some((f) => !(CAPTION_FIELDS as readonly string[]).includes(f) || !isCaptionText(v[f]))) return "Textes des images de la bande illisibles.";
        }
      }
      if (item.props.videoMode !== undefined && !isVideoMode(item.props.videoMode)) return "Lecture des vidéos de la bande illisible.";
      if (item.props.stroke !== undefined && !StrokeTintSchema.safeParse(item.props.stroke).success) return "Couleur du trait de la bande illisible.";
      const own = item.props.source === "own";
      if (own) {
        const m = item.props.media;
        const ids = item.props.ids;
        if (ids !== undefined && (!Array.isArray(ids) || ids.length > MAX_RAIL_MEDIA || ids.some((x) => typeof x !== "string" || !PLACE_ID.test(x)))) return "Places du carrousel illisibles.";
        if (m !== undefined && (!Array.isArray(m) || m.length > MAX_RAIL_MEDIA || m.some((x) => x !== null && (!Number.isInteger(x) || (x as number) <= 0)))) return `Un carrousel garde ${MAX_RAIL_MEDIA} médias au plus.`;
      } else {
        strips++;
        if (strips > 1) return "Une seule bande des images du projet est possible.";
      }
    }
    const hasChildren = "children" in item.props;
    if (item.type !== "grid") {
      if (hasChildren) return "Seule une grille en porte d'autres.";
      continue;
    }
    const kids = item.props.children;
    if (kids === undefined) continue;
    if (!Array.isArray(kids)) return "Contenu de la grille illisible.";
    if (kids.length > MAX_GRID_CHILDREN) return `${MAX_GRID_CHILDREN} blocs au plus par grille.`;
    for (const kid of kids) {
      if (!isObj(kid) || typeof kid.type !== "string" || !(GRID_CHILD_TYPES as readonly string[]).includes(kid.type)) return "Une grille de projet n'accepte que des images et des vidéos.";
      if (typeof kid.uid !== "string" || !UID.test(kid.uid) || uids.has(kid.uid)) return "Identifiant de bloc invalide.";
      uids.add(kid.uid);
      if (!isObj(kid.props) || "children" in kid.props) return "Réglages d'un bloc illisibles.";
    }
  }
  try {
    if (JSON.stringify(raw).length > MAX_LAYOUT_BYTES) return "Le contenu de ce projet est trop lourd.";
  } catch {
    return "Contenu de projet illisible.";
  }
  return null;
}

/**
 * La suite lue en base : absente (projet jamais touché) = la bande seule ; illisible = la bande seule aussi
 * (jamais de planche cassée en public).
 */
export function readLayout(raw: unknown): BoardItem[] {
  if (raw === null || raw === undefined) return defaultLayout();
  return layoutProblem(raw) === null ? (raw as BoardItem[]) : defaultLayout();
}

/** Identifiants de médias cités par une suite (images, vidéos, images d'attente, cellules de grille). */
export function layoutMediaIds(items: BoardItem[]): number[] {
  const out: number[] = [];
  for (const item of items) if (item.type === "strip" && item.props.source === "own" && Array.isArray(item.props.media)) for (const m of item.props.media) if (typeof m === "number" && Number.isInteger(m)) out.push(m);
  const take = (props: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) {
      const v = props[k];
      if (typeof v === "number" && Number.isInteger(v)) out.push(v);
    }
  };
  for (const item of items) {
    if (item.type === "image") take(item.props, ["mediaId"]);
    else if (item.type === "video-single") take(item.props, ["mediaId", "posterMediaId"]);
    else if (item.type === "free-board" && Array.isArray(item.props.items)) {
      for (const it of item.props.items as { media?: unknown }[]) if (isObj(it) && typeof it.media === "number" && Number.isInteger(it.media)) out.push(it.media);
    } else if (item.type === "grid" && Array.isArray(item.props.children)) {
      for (const kid of item.props.children as { type?: unknown; props?: unknown }[]) {
        if (!isObj(kid.props)) continue;
        if (kid.type === "image") take(kid.props, ["mediaId"]);
        else if (kid.type === "video-single") take(kid.props, ["mediaId", "posterMediaId"]);
      }
    }
  }
  return out;
}

/** Le composant n'a encore rien à montrer (image sans image, grille vide…) : vide en public, repère sur la toile. */
export function itemEmpty(item: BoardItem): boolean {
  const p = item.props;
  switch (item.type) {
    case "strip":
      return item.props.source === "own" && !railList(item.props).some((id) => id !== null);
    case "image":
    case "video-single":
      return typeof p.mediaId !== "number" && !(item.type === "video-single" && typeof p.slot === "string");
    case "grid":
      return !Array.isArray(p.children) || p.children.length === 0;
    case "free-board":
      return !Array.isArray(p.items) || p.items.length === 0;
    case "rich-text":
      return !Array.isArray(p.paragraphs) || !(p.paragraphs as { fr?: string; en?: string }[]).some((x) => x && (x.fr || x.en));
  }
}

/** Nombre d'images et de vidéos que les composants hors bande affichent (compteur « N œuvres » de la page). */
export function mediaCount(items: BoardItem[]): number {
  let n = 0;
  for (const item of items) {
    if (item.type === "strip" && item.props.source === "own" && Array.isArray(item.props.media)) n += railList(item.props).filter((id) => id !== null).length;
    else if (item.type === "image" || item.type === "video-single") n += itemEmpty(item) ? 0 : 1;
    else if (item.type === "free-board" && Array.isArray(item.props.items)) n += item.props.items.length;
    else if (item.type === "grid" && Array.isArray(item.props.children)) {
      n += (item.props.children as { props?: { mediaId?: unknown } }[]).filter((k) => typeof k?.props?.mediaId === "number").length;
    }
  }
  return n;
}

/** Même suite ? (comparaison de contenu, pour savoir si une surcouche est utile). */
export const sameLayout = (a: BoardItem[], b: BoardItem[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Composant neuf (réglages de départ), `uid` fourni par l'appelant. */
export function newBoardItem(type: BoardItemType, uid: string, source?: "project"): BoardItem {
  switch (type) {
    case "strip":
      // Sans précision : un carrousel à liste propre, vide. « project » : la bande des images du projet.
      return source === "project" ? { uid, type, props: {} } : { uid, type, props: { source: "own", media: [] } };
    case "grid":
      return { uid, type, props: { layout: "auto", children: [] } };
    case "image":
      return { uid, type, props: { width: "full" } };
    case "video-single":
      return { uid, type, props: { variant: "plain", mode: "player" } };
    case "free-board":
      return { uid, type, props: { format: "3:2", phone: "scale", items: [] } };
    case "rich-text":
      return { uid, type, props: { paragraphs: [{ ...HELP_TEXT.paragraph }] } };
  }
}
