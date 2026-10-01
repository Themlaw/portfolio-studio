/**
 * Manifeste d'un kit exporté : empreinte des pixels de chaque emplacement,
 * telle que l'import la recalcule (pixels replacés dans la boîte, alpha ≤ 8
 * remis à zéro). Un emplacement dont l'empreinte n'a pas bougé est
 * « inchangé » : pas reconverti, l'asset actuel du thème est gardé.
 *
 * Le kit v2 porte son identifiant d'export dans un nom de calque de `_guides`
 * (Photoshop garde les noms de calques ; il réécrit le XMP). Sans identifiant
 * (kit v1, calque supprimé), le manifeste est retrouvé par le contenu : celui
 * dont le plus d'emplacements correspondent, s'il y en a au moins la moitié.
 * Fichiers : ${DATA_DIR}/cache/kits/manifests/<exportId>.json (+ aperçus PNG).
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type { Rgba } from "./formats";
import { SLOTS } from "./spec";

export type KitManifest = {
  exportId: string;
  themeId: string;
  /** Empreinte du thème exporté (export-job.ts). */
  themeVersion: string;
  kitVersion: number;
  slots: Record<string, { hash: string }>;
  /** Aperçus « avant » (fichiers PNG à côté du manifeste), par emplacement. */
  previews?: Record<string, string>;
};

/** Empreinte des pixels d'un emplacement (RVBA dans sa boîte). */
export function frameHash(img: Rgba): string {
  return createHash("sha256").update(img.data).digest("hex").slice(0, 24);
}

/** Pixels d'un raster d'export tels que l'import les relira (alpha ≤ 8 → 0). */
export function asImported(img: Rgba): Rgba {
  const data = Buffer.from(img.data);
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] <= 8) data.writeUInt32LE(0, i);
  return { width: img.width, height: img.height, data };
}

export const exportIdOf = (themeId: string, version: string, kitVersion: number) =>
  `k2-${createHash("sha256").update(`${themeId}:${version}:${kitVersion}`).digest("hex").slice(0, 12)}`;

export async function saveManifest(dir: string, manifest: KitManifest): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(/* turbopackIgnore: true */ dir, `${manifest.exportId}.json`), JSON.stringify(manifest, null, 1));
}

export async function loadManifests(dir: string): Promise<KitManifest[]> {
  const out: KitManifest[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!name.endsWith(".json")) continue;
    try {
      const m = JSON.parse(await readFile(path.join(/* turbopackIgnore: true */ dir, name), "utf8")) as KitManifest;
      if (m && typeof m.exportId === "string" && m.slots && typeof m.slots === "object") out.push(m);
    } catch {
      // manifeste illisible : ignoré
    }
  }
  return out;
}

export type Reference = { manifest: KitManifest; how: "identifiant" | "contenu"; matches: number };

/**
 * Kit d'origine : par identifiant, sinon par le contenu (≥ la moitié des
 * emplacements identiques). `themeId` : seuls les kits de CE thème servent de
 * référence ; un kit reconnu d'un autre thème est rendu à part (`foreign`),
 * pour que la revue le dise au lieu de marquer des éléments « inchangés ».
 */
export function findReference(exportId: string | null, hashes: Map<string, string>, manifests: KitManifest[], themeId?: string): { reference: Reference | null; foreign: Reference | null } {
  const count = (m: KitManifest) => [...hashes].filter(([id, h]) => m.slots[id]?.hash === h).length;
  const pick = (list: KitManifest[]): Reference | null => {
    if (exportId) {
      const m = list.find((x) => x.exportId === exportId);
      if (m) return { manifest: m, how: "identifiant", matches: count(m) };
    }
    let best: Reference | null = null;
    for (const m of list) {
      const n = count(m);
      if (!best || n > best.matches) best = { manifest: m, how: "contenu", matches: n };
    }
    return best && best.matches >= Math.ceil(SLOTS.length / 2) ? best : null;
  };
  if (themeId === undefined) return { reference: pick(manifests), foreign: null };
  const reference = pick(manifests.filter((m) => m.themeId === themeId));
  if (reference) return { reference, foreign: null };
  return { reference: null, foreign: pick(manifests.filter((m) => m.themeId !== themeId)) };
}

/** Aperçu PNG réduit d'un emplacement (plans : 640 px de large ; le reste : 256 px au plus). */
export async function writePreview(img: Rgba, file: string, wide: boolean): Promise<void> {
  await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
    .resize(wide ? { width: 640 } : { width: 256, height: 256, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(file);
}
