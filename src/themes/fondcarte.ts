/**
 * « Fond & carte » (lot 100) : UN bouton, UN menu, deux sections toujours visibles, pour tout ce qui a un fond.
 *  - « Fond » : la zone AUTOUR, pleine largeur (aucun : c'est le fond de la page) ;
 *  - « Carte » : le cadre en retrait qui porte le contenu (aucune : le contenu est posé directement sur le fond).
 * Module pur (zod + zone.ts) : aucun changement de FORME des données. Les deux sections se rangent dans les deux couches déjà écrites par les
 * versions précédentes, dans l'ordre de rendu (la couche `surface` est dehors, la couche `background` dedans) :
 *  - bloc qui a les deux couches (rubrique de premier niveau sur une grande page) : Fond = `surface` pleine largeur (dehors), Carte = `background`
 *    avec marge (dedans) ; c'est « la carte sur le fond » ;
 *  - une seule des deux sections remplie : elle garde sa couche (un ancien réglage n'est jamais déplacé de lui-même : parité) ;
 *  - bloc qui n'a qu'une couche (composant d'une planche, rubrique sans enveloppe de fond) : Fond et Carte s'excluent, choisir l'un remplace l'autre.
 * Lecture : la section d'une zone se déduit de sa largeur AFFICHÉE (pleine = Fond, en retrait = Carte) ; si les deux couches existent, la couche
 * extérieure dit sa section et l'intérieure prend l'autre. Écriture : normalisée (ci-dessus), `readFondCarte(writeFondCarte(x)) = x`.
 */
import { zoneExtent, zoneInLayer, zoneToBackground, zoneToSurface, readZone, type Zone, type ZoneStored } from "./zone";
import { FALLBACK_CARD, type ResolvedSurface, type Surface } from "./surface";
import type { Background } from "./fond";

export type Slot = "fond" | "carte";
/** Ce que le bloc sait porter : une carte (premier niveau de page) et / ou une enveloppe de fond (grands composants). */
export type Caps = { canCard: boolean; canFond: boolean };
export type FondCarte = { fond: Zone | null; carte: Zone | null };

/** Deux couches (Fond dehors, Carte dedans) ou une seule (les deux sections s'excluent). */
/** Couleur d'une carte posée par un contour seul sur une page à papier peint : transparente (blanc à 0 %), sinon la carte cacherait le papier de la page. */
export const CONTOUR_ONLY_CLEAR = "#ffffff00";
export const isPair = (c: Caps): boolean => c.canCard && c.canFond;

/** Zone neuve d'une section : Fond = pleine largeur, Carte = en retrait (marge M quand elle vit dans la couche « fond »). */
export function freshZone(slot: Slot, caps: Caps): Zone {
  if (slot === "fond") return caps.canFond ? { layer: "fond", extent: "full" } : { layer: "card", extent: "full" };
  return caps.canCard ? { layer: "card", extent: "inset" } : { layer: "fond", extent: "inset", margin: "m" };
}

/** Les deux sections d'un bloc, lues dans ses deux couches. */
export function readFondCarte(stored: ZoneStored, defaults: ResolvedSurface = FALLBACK_CARD): FondCarte {
  const { zone: main, inner } = readZone(stored);
  const out: FondCarte = { fond: null, carte: null };
  if (!main) return out;
  const mainSlot: Slot = zoneExtent(main, defaults) === "inset" ? "carte" : "fond";
  out[mainSlot] = main;
  if (inner) out[mainSlot === "fond" ? "carte" : "fond"] = inner;
  return out;
}

/** Zone rangée dans la couche voulue, avec la largeur de sa section (pleine : pas de marge ; en retrait : marge M par défaut dans la couche « fond »). */
function shaped(z: Zone, slot: Slot, layer: Zone["layer"]): Zone {
  const base = zoneInLayer({ ...z, extent: slot === "fond" ? "full" : "inset" }, layer);
  if (slot === "fond") {
    const { margin: _m, ...rest } = base;
    void _m;
    return { ...rest, extent: "full" } as Zone;
  }
  return layer === "fond" ? ({ ...base, extent: "inset", margin: base.margin ?? "m" } as Zone) : base;
}

/**
 * Écrit les deux sections dans les couches du bloc (voir l'en-tête). `null` pour une couche = à supprimer.
 * `normalize` : une section vient d'être AJOUTÉE (l'autre existait déjà) : les deux se rangent dans l'ordre normal (Fond dehors, Carte dedans). Sinon (on règle
 * une section déjà là), chacune garde sa couche, y compris le rendu emboîté d'avant (carte dehors, fond dedans) : un réglage ne déplace jamais rien tout seul.
 */
export function writeFondCarte(fc: FondCarte, caps: Caps, normalize = true): { surface: Surface | null; background: Background | null } {
  const { fond, carte } = fc;
  if (!fond && !carte) return { surface: null, background: null };
  const put = (z: Zone, layer: Zone["layer"]) => (layer === "card" ? { surface: zoneToSurface(z), background: null } : { surface: null, background: zoneToBackground(z) });
  if (isPair(caps)) {
    if (fond && carte && !normalize && fond.layer !== carte.layer) {
      const [s, b] = fond.layer === "card" ? [shaped(fond, "fond", "card"), shaped(carte, "carte", "fond")] : [shaped(carte, "carte", "card"), shaped(fond, "fond", "fond")];
      return { surface: zoneToSurface(s), background: zoneToBackground(b) };
    }
    if (fond && carte) return { surface: zoneToSurface(shaped(fond, "fond", "card")), background: zoneToBackground(shaped(carte, "carte", "fond")) };
    const z = (fond ?? carte)!;
    const slot: Slot = fond ? "fond" : "carte";
    // Une seule section : elle garde sa couche ; une zone neuve prend celle de freshZone.
    return put(shaped(z, slot, z.layer), z.layer);
  }
  const layer: Zone["layer"] = caps.canFond ? "fond" : "card";
  const slot: Slot = fond ? "fond" : "carte";
  return put(shaped((fond ?? carte)!, slot, layer), layer);
}

/**
 * Remplace une section (ou la vide avec `null`). Sans enveloppe double, l'autre section est vidée : choisir l'une remplace l'autre
 * (le menu le dit). Avec les deux couches, la section n'est pas touchée par l'autre.
 */
export function setSlot(fc: FondCarte, slot: Slot, next: Zone | null, caps: Caps): FondCarte {
  const other: Slot = slot === "fond" ? "carte" : "fond";
  return { ...fc, [slot]: next, ...(!isPair(caps) && next ? { [other]: null } : {}) } as FondCarte;
}

/** La couleur qui se voit réellement AUTOUR de la carte : celle de la section Fond, sinon `undefined` (c'est le fond de la page). */
export const aroundColor = (fc: FondCarte): string | undefined => fc.fond?.color;
