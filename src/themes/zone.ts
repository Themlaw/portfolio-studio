/**
 * Fond unique d'une rubrique (lot 66, « Surface » commune) : pour l'artiste, « Carte » et « Fond » sont la même chose. UN modèle de données
 * (`Zone`), UNE lecture, UNE écriture, lus par le menu « Fond » (src/components/edit/ZoneMenu.tsx), le rendu (src/components/ZoneWrap.tsx), la
 * toile (aperçu) et les tests (scripts/test-zone66.mjs). Module pur (zod + palette) : aucun import de composant.
 *
 * Stockage : AUCUN changement de forme des données. Une zone vit dans l'une des deux couches déjà écrites par les versions précédentes :
 *  - `props.surface` (ancienne « Carte » : couleur, largeur pleine / en retrait, coins, bordure, papier du site, papier peint SUR la couleur) ;
 *  - `props.background` (ancien « Fond » : couleur ou papier peint, marge `inset`, coins `round`, et, depuis le lot 66, `paper: "under"`).
 * La lecture (`readZone`) est tolérante et sans perte : `zoneToStored(readZone(x)) = x` pour toute valeur lisible (test-zone66, anti-perte de
 * données). L'écriture garde la couche d'une zone existante ; une zone neuve prend la couche qui sait faire ce qu'elle demande
 * (carte en retrait, bordure : `surface` ; pleine largeur : `background`). Les blocs qui portaient LES DEUX (carte + fond de couleur dessus, rendu
 * emboîté) gardent leurs deux couches : la première est la zone, la seconde (`inner`) reste telle quelle et se retire d'un clic.
 *
 * Empilement documenté (du dessous au dessus, identique pour la page, la rubrique, la planche, la case et la Planche libre) :
 *   1. papier peint de la PAGE (`.page-wallpaper`, ou papier du kit sur le corps) ;
 *   2. zone de la rubrique : carte (`.surface-card`, couleur puis papier de la carte) ;
 *   3. fond emboîté (`.fond-bloc`, couleur puis papier peint ou papier du site) ;
 *   4. fond de l'image (`data-img-bg`), 5. média, 6. cadre (même élément que 4 et 5), 7. légende.
 */
import { FALLBACK_CARD, SURFACE_PAPERS, cleanSurface, isSurfaceToken, readSurface, resolveSurface, type ResolvedSurface, type Surface } from "./surface";
import { readBackground, type Background, type FondStep } from "./fond";
import { FOND_STEPS } from "./schema";

/** Couche de stockage : la carte (`props.surface`) ou le fond (`props.background`). */
export type ZoneLayer = "card" | "fond";
/** Ce qu'un bloc stocke (les deux clés, absentes = aucune couche). */
export type ZoneStored = { surface?: Surface | undefined; background?: Background | undefined };
export type ZoneKind = "color" | "wallpaper";
export type ZoneExtent = "full" | "inset";
export type ZoneCorners = "square" | "round" | FondStep;
export type ZonePaper = (typeof SURFACE_PAPERS)[number];

/** Couleur posée au premier choix « Couleur » d une zone sans couleur (lot 100 : la couleur de carte du thème, jamais « bgDeep » : sur certains thèmes c est un jaune vif imposé). Toujours réglable. */
export const FIRST_COLOR = "surface";

/**
 * Zone, vue unique des deux couches (tous les champs sont facultatifs : absent = « comme avant » ou « comme le thème »).
 *  - `wallpaper` : id d'un motif de la bibliothèque ; `size` / `opacity` : ses réglages propres (absents = ceux du motif).
 *  - `extent` / `margin` : pleine largeur ou en retrait ; marge S / M / L (fond en retrait seulement).
 *  - `paper` : papier du site sur cette zone (`under` : caché ; `over` : montré, carte seulement ; absent : comme le site).
 *  - `paperOpacity` : intensité du papier du site (carte, sans papier peint).
 */
export type Zone = {
  layer: ZoneLayer;
  color?: string;
  wallpaper?: number;
  size?: number;
  opacity?: number;
  extent?: ZoneExtent;
  margin?: FondStep;
  corners?: ZoneCorners;
  border?: Surface["border"];
  paper?: ZonePaper;
  paperOpacity?: number;
};

export const zoneKind = (z: Zone): ZoneKind => (z.wallpaper !== undefined ? "wallpaper" : "color");

/** Retire les champs `undefined` (les schémas stricts les refusent, et `{}` ne doit pas devenir autre chose). */
const defined = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Couche « carte » → zone. */
export function zoneOfSurface(s: Surface): Zone {
  return defined({
    layer: "card" as const,
    color: s.color,
    wallpaper: s.paperWallpaper,
    size: s.paperSize,
    // Avec un papier peint, `paperOpacity` est son opacité ; sans, c'est l'intensité du papier du site.
    opacity: s.paperWallpaper !== undefined ? s.paperOpacity : undefined,
    paperOpacity: s.paperWallpaper === undefined ? s.paperOpacity : undefined,
    extent: s.width,
    corners: s.corners,
    border: s.border,
    paper: s.paper,
  }) as Zone;
}

/** Couche « fond » → zone. */
export function zoneOfBackground(b: Background): Zone {
  return defined({
    layer: "fond" as const,
    color: b.color,
    wallpaper: b.kind === "wallpaper" ? b.wallpaper : undefined,
    size: b.kind === "wallpaper" ? b.size : undefined,
    opacity: b.kind === "wallpaper" ? b.opacity : undefined,
    extent: (b.inset ? "inset" : "full") as ZoneExtent,
    margin: b.inset,
    corners: b.round,
    paper: b.paper,
  }) as Zone;
}

/** Zone → couche « carte » (jamais de valeur `undefined` dans l'objet). */
export function zoneToSurface(z: Zone): Surface {
  const wp = z.wallpaper !== undefined;
  return cleanSurface({
    ...(z.color !== undefined ? { color: z.color } : {}),
    ...(z.extent ? { width: z.extent } : {}),
    ...(z.corners ? { corners: z.corners } : {}),
    ...(z.border !== undefined ? { border: z.border } : {}),
    ...(z.paper ? { paper: z.paper } : {}),
    ...(wp ? { paperWallpaper: z.wallpaper, ...(z.size !== undefined ? { paperSize: z.size } : {}), ...(z.opacity !== undefined ? { paperOpacity: z.opacity } : {}) } : z.paperOpacity !== undefined ? { paperOpacity: z.paperOpacity } : {}),
  } as Surface);
}

/** Zone → couche « fond ». Un fond a toujours une couleur ou un motif ; sans l'un ni l'autre, `null`. */
export function zoneToBackground(z: Zone): Background | null {
  const inset = z.extent === "inset" ? (z.margin ?? "m") : z.margin;
  const round = z.corners && (FOND_STEPS as readonly string[]).includes(z.corners) ? (z.corners as FondStep) : z.corners === "round" ? "m" : undefined;
  const common = { ...(inset ? { inset } : {}), ...(round ? { round } : {}), ...(z.paper === "under" ? { paper: "under" as const } : {}) };
  if (z.wallpaper !== undefined) {
    return readBackground({ kind: "wallpaper", wallpaper: z.wallpaper, ...(z.color !== undefined ? { color: z.color } : {}), ...(z.size !== undefined ? { size: z.size } : {}), ...(z.opacity !== undefined ? { opacity: z.opacity } : {}), ...common }) ?? null;
  }
  return readBackground({ kind: "color", color: z.color ?? FIRST_COLOR, ...common }) ?? null;
}

/** Écrit une zone dans SA couche (l'autre clé reste intacte : `null` = à supprimer). */
export function zoneToStored(z: Zone | null, base: ZoneStored = {}): { surface: Surface | null; background: Background | null } {
  const cur = { surface: base.surface ?? null, background: base.background ?? null };
  if (!z) return { surface: null, background: null };
  if (z.layer === "card") return { surface: zoneToSurface(z), background: cur.background };
  return { surface: cur.surface, background: zoneToBackground(z) };
}

/** Les couches d'un bloc : la zone (carte si elle existe, sinon fond) et la couche emboîtée (le fond d'une carte, rendu d'avant). */
export function readZone(stored: ZoneStored): { zone: Zone | null; inner: Zone | null } {
  const s = stored.surface ? readSurface(stored.surface) : undefined;
  const b = stored.background ? readBackground(stored.background) : undefined;
  if (s) return { zone: zoneOfSurface(s), inner: b ? zoneOfBackground(b) : null };
  return { zone: b ? zoneOfBackground(b) : null, inner: null };
}

/**
 * Change la nature de la zone sans jamais remplacer un choix existant : `memo` rend ce qui avait été choisi avant (couleur, motif et ses
 * réglages), `wallpaperId` le motif à poser (jamais un motif « par défaut » choisi à la place de l'artiste). « Couleur » cache le papier du site
 * sur la zone : ce que l'artiste voit alors est ce qu'il a choisi, et rien d'autre.
 */
export type ZoneMemo = { color?: string; wallpaper?: { id: number; size?: number; opacity?: number } };
export function zoneWithKind(z: Zone, kind: ZoneKind, memo: ZoneMemo = {}, wallpaperId?: number): Zone {
  if (kind === "color") {
    const { wallpaper: _w, size: _s, opacity: _o, paperOpacity: _p, ...rest } = z;
    void _w;
    void _s;
    void _o;
    void _p;
    return { ...rest, color: z.color ?? memo.color ?? (z.layer === "fond" ? FIRST_COLOR : undefined), paper: "under" } as Zone;
  }
  const id = wallpaperId ?? z.wallpaper ?? memo.wallpaper?.id;
  if (id === undefined) return z;
  const keep = z.wallpaper === undefined && memo.wallpaper?.id === id ? memo.wallpaper : undefined;
  const { paperOpacity: _p, paper, ...rest } = z;
  void _p;
  // Papier peint sur une carte : « sous la carte » le cacherait ; le papier du site est celui du motif, on ne garde pas `under`.
  return defined({ ...rest, wallpaper: id, size: keep?.size, opacity: keep?.opacity, ...(z.layer === "card" && paper === "under" ? {} : { paper }) }) as Zone;
}

/** Couleur de la zone (jeton, teinte ou `#rrggbb`) ; une couleur absente se lit dans `defaults` (la carte du thème). */
export function zoneColor(z: Zone, defaults: ResolvedSurface = FALLBACK_CARD): string | undefined {
  return z.color ?? (z.layer === "card" ? defaults.color : undefined);
}

/** Étendue réellement affichée (une carte sans réglage suit celle du thème). */
export function zoneExtent(z: Zone, defaults: ResolvedSurface = FALLBACK_CARD): ZoneExtent {
  if (z.layer === "card") return resolveSurface(zoneToSurface(z), defaults).width === "inset" ? "inset" : "full";
  return z.extent ?? "full";
}

/** Passe d'une couche à l'autre sans perdre ce que les deux savent dire (bordure : carte seulement ; marge S / M / L : fond seulement). */
export function zoneInLayer(z: Zone, layer: ZoneLayer): Zone {
  if (z.layer === layer) return z;
  if (layer === "card") {
    const { margin: _m, ...rest } = z;
    void _m;
    return { ...rest, layer: "card", extent: z.extent ?? "full" };
  }
  const { border: _b, paperOpacity: _p, ...rest } = z;
  void _b;
  void _p;
  return { ...rest, layer: "fond", extent: z.extent ?? "full", ...(z.paper === "over" ? { paper: undefined } : {}) } as Zone;
}

export const isCustomColor = (c: string | undefined): c is string => c !== undefined && !isSurfaceToken(c);

