/**
 * Kit par partie (lot 122). Le kit v4 est une archive de TROIS fichiers Photoshop, un par
 * « partie » (décor d'accueil ; logo, papier, trait et icône du site ; icônes, curseurs,
 * cadre et scotch). Une partie se télécharge seule : c'est EXACTEMENT le fichier de
 * l'archive (mêmes octets, donc mêmes calques et mêmes noms), lu en flux depuis le .zip
 * en cache. Le réimport d'un seul fichier existe déjà (import.ts : « pas envoyé : inchangé »).
 * Un petit fichier `.meta` à côté de l'archive garde la durée de génération (affichée par l'admin).
 */
import { readFile, stat, writeFile } from "node:fs/promises";

import { slotsOfRole, KIT_FILES, KIT_ROLES, type KitRole } from "./spec";
import { listZip, openStoredEntry } from "./zip-archive";

export type KitPart = {
  role: KitRole;
  /** Nom du fichier, celui de l'archive (« 1-decor-accueil.psd »). */
  file: string;
  /** « 1 · Décor d'accueil » */
  label: string;
  /** Ce que contient la partie, en clair. */
  elements: string[];
  /** Poids du fichier, une fois le kit généré (sinon null). */
  bytes: number | null;
};

export const isKitRole = (value: unknown): value is KitRole => typeof value === "string" && (KIT_ROLES as string[]).includes(value);

/** Éléments d'une partie (libellés de l'admin). Le décor est libre : un calque ou groupe = un plan. */
export function partElements(role: KitRole): string[] {
  if (role === "decor") return ["Décor d'accueil (un calque ou groupe = un plan)"];
  return slotsOfRole(role).map((s) => s.label);
}

/** Les parties du kit, avec leur poids si l'archive `zip` existe. */
export async function kitParts(zip: string | null): Promise<KitPart[]> {
  const sizes = new Map<string, number>();
  if (zip && (await stat(zip).catch(() => null))) {
    try {
      for (const e of await listZip(zip)) sizes.set(e.name, e.size);
    } catch {
      // archive illisible : pas de poids
    }
  }
  return KIT_ROLES.map((role) => ({ role, file: KIT_FILES[role].file, label: KIT_FILES[role].label, elements: partElements(role), bytes: sizes.get(KIT_FILES[role].file) ?? null }));
}

/** Fichier d'une partie, en flux depuis l'archive (null : archive absente ou partie introuvable). */
export async function openKitPart(zip: string, role: KitRole) {
  if (!(await stat(zip).catch(() => null))) return null;
  const entry = (await listZip(zip)).find((e) => e.name === KIT_FILES[role].file);
  return entry ? openStoredEntry(zip, entry) : null;
}

export type KitMeta = { ms: number; bytes: number };
export const kitMetaFile = (zip: string) => `${zip}.meta`;
export const writeKitMeta = (zip: string, meta: KitMeta) => writeFile(kitMetaFile(zip), JSON.stringify(meta));
export async function readKitMeta(zip: string): Promise<KitMeta | null> {
  try {
    const m = JSON.parse(await readFile(kitMetaFile(zip), "utf8")) as KitMeta;
    return Number.isFinite(m?.ms) && Number.isFinite(m?.bytes) ? m : null;
  } catch {
    return null;
  }
}
