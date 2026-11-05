/**
 * Lot 75 (R4 de l'audit A5) : UNE écriture pour l'habillage d'un média (cadre, fond derrière l'image, arrondi, panorama, lecture de la
 * vidéo), quel que soit son conteneur. Module pur (zod + look.ts) : lu par la toile (aperçu), l'éditeur, le serveur (`item-media-look`
 * de src/lib/edit/boards.ts) et les tests (scripts/test-media-look75.mjs).
 *
 * Une intention `media-look { target, patch }` (protocol.ts) :
 * - `target` dit OÙ l'habillage est écrit : une rubrique de la page ou une case de grille de la page (`block`, `look.frame` / `look.imageBg` /
 *   `look.radius`), un composant de planche (`item`, `props.look` du composant, dans le projet), une case d'une grille de planche (`cell`),
 *   une place de carrousel (`slot`, `look.slotLook[slug]` de la rubrique de la page) ou une image de la Planche libre (`free`) ;
 * - `patch` dit QUOI : seuls les champs présents changent, `null` retire le réglage (retour à « Auto » / au choix du site).
 *
 * Le réducteur (`applyMediaPatch*`) est le même partout : une action de l'artiste = un patch = un pas d'historique.
 */
import { z } from "zod";

import { cleanLook, FrameSchema, ImageBgSchema, MEDIA_LOOK_FIELDS, RADII, SLOT_PANO_MODES, SLOT_VIDEO_MODES, type Look, type MediaLookData, type MediaLookField } from "../look";

export const MediaPatchSchema = z
  .strictObject({
    frame: FrameSchema.nullable().optional(),
    bg: ImageBgSchema.nullable().optional(),
    radius: z.enum(RADII).nullable().optional(),
    pano: z.enum(SLOT_PANO_MODES).nullable().optional(),
    video: z.enum(SLOT_VIDEO_MODES).nullable().optional(),
  })
  .refine((p) => MEDIA_LOOK_FIELDS.some((k) => p[k] !== undefined), { message: "Rien à changer." });
export type MediaPatch = z.infer<typeof MediaPatchSchema>;

/** Champs que seule une place de carrousel porte. */
const SLOT_ONLY: readonly MediaLookField[] = ["pano", "video"];

/** Le patch concerne-t-il une place de carrousel seulement ? Message (français simple) si un champ n'a pas sa place là. */
export function patchError(patch: MediaPatch, where: "slot" | "own" | "free"): string | null {
  if (where === "slot") return null;
  // Planche libre (lot 116) : la lecture d'une vidéo (Boucle / Lecteur) se règle sur sa ligne, comme sur une place de carrousel ; pas le panorama.
  if (where === "free") return patch.pano !== undefined ? "Le panorama ne se règle que sur une place d'« Images qui défilent »." : null;
  return SLOT_ONLY.some((k) => patch[k] !== undefined) ? "Le panorama et la lecture ne se règlent que sur une place d'« Images qui défilent »." : null;
}

/** Les champs d'un habillage avec un patch par-dessus (`null` retire, absent ne touche pas). */
export function mergeMedia(cur: MediaLookData | undefined, patch: MediaPatch): MediaLookData {
  const out: Record<string, unknown> = { ...(cur ?? {}) };
  for (const k of MEDIA_LOOK_FIELDS) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out as MediaLookData;
}

/** Les clés de `look` qui portent le cadre, le fond et l'arrondi d'un média seul (image seule, case, composant de planche). */
const OWN_KEYS = { frame: "frame", bg: "imageBg", radius: "radius" } as const;

/** L'habillage de la place `slug` (vide sans réglage). */
export function slotOf(look: Look | undefined, slug: string): MediaLookData {
  return look?.slotLook && Object.hasOwn(look.slotLook, slug) ? look.slotLook[slug] : {};
}

/**
 * Le `look` d'une rubrique, d'une case ou d'un composant avec le patch posé : sur le média lui-même (`slug` absent : `frame`, `imageBg`,
 * `radius`) ou sur une place de carrousel (`slotLook[slug]`). `undefined` = plus aucun réglage ; une erreur est un message français.
 * N'altère jamais `look`.
 */
export function applyMediaPatch(look: Look | undefined, patch: MediaPatch, slug?: string): { look: Look | undefined } | { error: string } {
  const error = patchError(patch, slug === undefined ? "own" : "slot");
  if (error) return { error };
  const next: Record<string, unknown> = { ...(look ?? {}) };
  if (slug === undefined) {
    for (const k of Object.keys(OWN_KEYS) as (keyof typeof OWN_KEYS)[]) {
      const v = patch[k];
      if (v === undefined) continue;
      if (v === null) delete next[OWN_KEYS[k]];
      else next[OWN_KEYS[k]] = v;
    }
  } else {
    const slots: Record<string, MediaLookData> = { ...(look?.slotLook ?? {}) };
    const merged = mergeMedia(slots[slug], patch);
    if (Object.keys(merged).length) slots[slug] = merged;
    else delete slots[slug];
    if (Object.keys(slots).length) next.slotLook = slots;
    else delete next.slotLook;
  }
  return { look: cleanLook(next as Look) };
}

/** Une image de la Planche libre : ses trois réglages vivent sur sa ligne (`frame`, `bg`, `radius`). */
export type FreeLook = { frame?: unknown; bg?: unknown; radius?: unknown; video?: unknown };
export function applyMediaPatchToFree<T extends FreeLook>(item: T, patch: MediaPatch): { item: T } | { error: string } {
  const error = patchError(patch, "free");
  if (error) return { error };
  const next: Record<string, unknown> = { ...item };
  for (const k of ["frame", "bg", "radius", "video"] as const) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return { item: next as T };
}
