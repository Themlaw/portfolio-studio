/**
 * Presse-papiers de blocs et de styles (lot 133) : partie PURE, sans registre ni base (lue aussi par l'éditeur, côté navigateur).
 * Le collage lui-même (revalidation par le registre) est dans clipboard.ts, côté serveur.
 */

export const CLIP_KEY = "portfolio:clipboard";
export const CLIP_VERSION = 1;
/** Taille maximale d'un presse-papiers (octets) : bien en dessous du brouillon (256 Ko). */
export const MAX_CLIP_BYTES = 128 * 1024;
/** Blocs au plus par page (comme le brouillon) et par collage. */
export const MAX_PAGE_BLOCKS = 40;

/** Clés de props communes à TOUS les types (ajoutées par `define()` du registre) : le « style » d'un bloc. */
export const STYLE_KEYS = ["look", "surface", "background", "reveal"] as const;
/** Réglages de `look` qui tiennent au CONTENU (cadrage d'une image, habillage de places) : jamais copiés avec le style. */
export const CONTENT_LOOK_KEYS = ["crop", "tileCrop", "slotLook"] as const;

export type ClipBlock = { uid: string; type: string; props: Record<string, unknown> };
export type BlocksClip = { v: number; kind: "blocks"; blocks: ClipBlock[]; from?: number };
export type StyleClip = { v: number; kind: "style"; type: string; style: Record<string, unknown> };
export type Clip = BlocksClip | StyleClip;

export const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const DANGEROUS = new Set(["__proto__", "constructor", "prototype"]);

/** Copie profonde sans clé dangereuse. */
export function clean<T>(value: T, depth = 0): T {
  if (depth > 24) return undefined as T;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1)) as T;
  if (isObj(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!DANGEROUS.has(k)) out[k] = clean(v, depth + 1);
    return out as T;
  }
  return value;
}

export const blocksClip = (blocks: ClipBlock[], from?: number): BlocksClip => ({ v: CLIP_VERSION, kind: "blocks", blocks, ...(from ? { from } : {}) });
export const styleClip = (type: string, style: Record<string, unknown>): StyleClip => ({ v: CLIP_VERSION, kind: "style", type, style });

/** Lecture tolérante du texte du presse-papiers : null si illisible, trop lourd, de version inconnue ou mal formé. */
export function parseClip(text: unknown): Clip | null {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_CLIP_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return readClip(raw);
}

/** Forme d'un presse-papiers déjà analysé (le serveur reçoit un objet). */
export function readClip(raw: unknown): Clip | null {
  if (!isObj(raw) || raw.v !== CLIP_VERSION) return null;
  const data = clean(raw);
  if (data.kind === "blocks") {
    const blocks = data.blocks;
    if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > MAX_PAGE_BLOCKS) return null;
    for (const b of blocks) if (!isObj(b) || typeof b.uid !== "string" || typeof b.type !== "string" || b.type.length > 60 || !isObj(b.props)) return null;
    return { v: CLIP_VERSION, kind: "blocks", blocks: blocks as ClipBlock[], ...(Number.isInteger(data.from) ? { from: data.from as number } : {}) };
  }
  if (data.kind === "style") {
    if (typeof data.type !== "string" || data.type.length > 60 || !isObj(data.style)) return null;
    return { v: CLIP_VERSION, kind: "style", type: data.type, style: data.style };
  }
  return null;
}

/* ------------------------------------------------------------------ style */

/** Le style d'un bloc : ses clés communes, sans ce qui tient au contenu. */
export function styleOf(block: { props?: unknown }): Record<string, unknown> {
  const props = isObj(block.props) ? block.props : {};
  const out: Record<string, unknown> = {};
  for (const key of STYLE_KEYS) {
    if (props[key] === undefined) continue;
    if (key === "look" && isObj(props.look)) {
      const look = { ...props.look };
      for (const k of CONTENT_LOOK_KEYS) delete look[k];
      if (Object.keys(look).length) out.look = clean(look);
    } else out[key] = clean(props[key]);
  }
  return out;
}

/**
 * Props de la cible après « coller le style » : chaque clé de style prend la valeur adaptée ; une clé que la source n'a pas est retirée de la
 * cible (la cible prend le style de la source) ; une clé que la source a mais que la cible ne peut pas porter est laissée telle quelle.
 */
export function applyStyle(props: Record<string, unknown>, source: Record<string, unknown>, adapted: Record<string, unknown>): Record<string, unknown> {
  const out = { ...props };
  for (const key of STYLE_KEYS) {
    if (key in adapted) out[key] = adapted[key];
    else if (!(key in source)) delete out[key];
  }
  return out;
}


/* ------------------------------------------------------------------ stockage */

/** Presse-papiers du navigateur (localStorage : partagé entre les onglets de l'admin). Jamais d'exception : indisponible = vide. */
export function readStoredClip(): Clip | null {
  try {
    return parseClip(globalThis.localStorage?.getItem(CLIP_KEY));
  } catch {
    return null;
  }
}

/** false = refusé (stockage indisponible ou plein) : l'éditeur le dit. */
export function writeStoredClip(clip: Clip): boolean {
  try {
    const text = JSON.stringify(clip);
    if (text.length > MAX_CLIP_BYTES) return false;
    globalThis.localStorage.setItem(CLIP_KEY, text);
    return true;
  } catch {
    return false;
  }
}
