/**
 * Export / import d'un thème (Admin → Thèmes) : une archive ZIP
 *   theme.json                       { format, version, theme }
 *   assets/<sha256 16>.<svg|avif|webp|png>  éléments dessinés du kit référencés
 *                                    (png : curseurs du lot 4, 32 et 64 px)
 *
 * Import = surface d'envoi : archive bornée et lue défensivement (zip.ts),
 * enveloppe et thème validés par zod SANS clé inconnue (aucun CSS libre : le
 * thème ne porte que des tokens filtrés par le schéma), contraste AA exigé
 * (même règle que l'éditeur, palette normalisée et voile compris : lot 4),
 * images vérifiées par signature + en-tête (sharp
 * metadata, aucun décodage), SVG en liste blanche, contenu ré-adressé par son
 * propre hash (le nom fourni doit correspondre), aucun chemin ni URL externe.
 * Le thème importé est une copie non livrée, jamais mise en ligne d'office.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { eq } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";

import { getDb, getSqlite, schema } from "@/lib/db";
import { slugify } from "@/lib/slug";
import { getStorage } from "@/lib/storage";
import { sniffImage } from "@/lib/upload/sniff";
import { normalizePalette } from "@/themes/palette";
import { ThemeSchema, type Theme } from "@/themes/schema";
import { unknownKeys } from "@/themes/strict";

import { svgProblem } from "./svg-check";
import { readZip, writeZip, ZipError, type ZipEntry } from "./zip";

export const PACKAGE_FORMAT = "portfolio-theme";
export const PACKAGE_VERSION = 1;

/** Bornes de l'archive importée. */
export const IMPORT_LIMITS = {
  /** Archive envoyée (octets). */
  maxZipBytes: 12 * 1024 * 1024,
  maxEntries: 40,
  /** Par fichier décompressé : un asset du kit (AVIF/WebP) reste bien en dessous. */
  maxEntryBytes: 6 * 1024 * 1024,
  maxTotalBytes: 30 * 1024 * 1024,
  maxRatio: 60,
  maxThemeJsonBytes: 64 * 1024,
  /** Côté et surface des images (le schéma borne déjà w/h à 4096). */
  maxSide: 8192,
  maxPixels: 4096 * 4096,
} as const;

const KIT_PATH = /^\/media\/kit\/([0-9a-f]{16})\.(svg|avif|webp|png)$/;
const ASSET_ENTRY = /^assets\/([0-9a-f]{16})\.(svg|avif|webp|png)$/;

/**
 * Côtés exigés (px) de chaque PNG de curseur (lot 4) : 32 (1x) et 64 (2x). Le
 * schéma n'accepte un PNG que là. Un même fichier cité en 1x ET en 2x exige
 * les deux côtés : il est donc refusé.
 */
function cursorSides(theme: Pick<Theme, "assets">): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const add = (p: string, side: number) => out.set(p, [...(out.get(p) ?? []), side]);
  const c = theme.assets.kit?.cursors;
  for (const cur of [c?.default, c?.pointer]) {
    if (!cur) continue;
    add(cur.png, 32);
    add(cur.png2x, 64);
  }
  return out;
}

export class ThemeImportError extends Error {}

/** Tous les chemins /media/kit/… d'un thème (assets du kit, à toute profondeur). */
export function kitPaths(theme: Pick<Theme, "assets">): string[] {
  const out = new Set<string>();
  const visit = (v: unknown) => {
    if (typeof v === "string") {
      if (KIT_PATH.test(v)) out.add(v);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(theme.assets.kit);
  return [...out].sort();
}

async function readStored(key: string): Promise<Buffer | null> {
  const storage = getStorage();
  if (!(await storage.stat(key))) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of await storage.getStream(key)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/* ---- Export ------------------------------------------------------------------ */

export async function exportThemePackage(theme: Theme): Promise<Buffer> {
  const entries: ZipEntry[] = [];
  const manifest = { format: PACKAGE_FORMAT, version: PACKAGE_VERSION, exportedAt: new Date().toISOString(), theme };
  entries.push({ name: "theme.json", data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n") });
  for (const p of kitPaths(theme)) {
    const data = await readStored(p.slice("/media/".length));
    // Asset manquant sur ce serveur : exporté sans, l'import le signalera.
    if (data) entries.push({ name: `assets/${path.basename(p)}`, data });
  }
  return writeZip(entries);
}

/* ---- Import ------------------------------------------------------------------ */

const Envelope = z
  .object({
    format: z.literal(PACKAGE_FORMAT),
    version: z.literal(PACKAGE_VERSION),
    exportedAt: z.string().max(40).optional(),
    theme: z.record(z.string().max(40), z.unknown()),
  })
  .strict();

type ParsedPackage = { theme: Theme; assets: Map<string, { ext: string; data: Buffer }> };

/** Lecture + validation complète, sans rien écrire. */
export async function parseThemePackage(buf: Buffer): Promise<ParsedPackage> {
  if (buf.length > IMPORT_LIMITS.maxZipBytes) throw new ThemeImportError(`Archive trop grosse : ${IMPORT_LIMITS.maxZipBytes / 1024 / 1024} Mo au plus.`);
  let entries: ZipEntry[];
  try {
    entries = readZip(buf, IMPORT_LIMITS);
  } catch (error) {
    if (error instanceof ZipError) throw new ThemeImportError(error.message);
    throw error;
  }
  const manifestEntry = entries.find((e) => e.name === "theme.json");
  if (!manifestEntry) throw new ThemeImportError("Archive sans theme.json : ce n'est pas un thème exporté depuis Admin → Thèmes.");
  if (manifestEntry.data.length > IMPORT_LIMITS.maxThemeJsonBytes) throw new ThemeImportError("theme.json est trop gros.");

  const assets = new Map<string, { ext: string; data: Buffer }>();
  for (const entry of entries) {
    if (entry.name === "theme.json") continue;
    const m = ASSET_ENTRY.exec(entry.name);
    if (!m) throw new ThemeImportError(`Fichier inattendu dans l'archive : « ${entry.name.slice(0, 80)} ». Seuls theme.json et assets/ sont acceptés.`);
    assets.set(`/media/kit/${m[1]}.${m[2]}`, { ext: m[2], data: entry.data });
  }

  let json: unknown;
  try {
    json = JSON.parse(manifestEntry.data.toString("utf8"));
  } catch {
    throw new ThemeImportError("theme.json n'est pas un JSON valide.");
  }
  const envelope = Envelope.safeParse(json);
  if (!envelope.success) throw new ThemeImportError("theme.json n'a pas le format attendu (thème exporté depuis Admin → Thèmes, version 1).");

  // id et preset sont réattribués : on valide avec des valeurs neutres.
  const candidate = { ...envelope.data.theme, id: "import", preset: false };
  const parsed = ThemeSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ThemeImportError(`Thème invalide : ${first.path.join(".")} — ${first.message}${parsed.error.issues.length > 1 ? ` (et ${parsed.error.issues.length - 1} autre(s))` : ""}.`);
  }
  const extra = unknownKeys(candidate, parsed.data);
  if (extra.length) throw new ThemeImportError(`Réglages inconnus refusés : ${extra.slice(0, 5).join(", ")}.`);
  // Palette (lot 4) : nuances « auto » recalculées depuis leurs bases, jamais
  // la valeur de l'archive (même règle que l'enregistrement d'un thème).
  const theme: Theme = { ...parsed.data, tokens: { ...parsed.data.tokens, color: normalizePalette(parsed.data.tokens.color, parsed.data.tokens.palette) } };
  // Lisibilité (lot 29) : un thème importé peu contrasté est accepté, l'éditeur de thème le signale.

  // Calques du hero : uniquement des fichiers livrés avec le site (aucun envoi possible ici).
  for (const layer of theme.assets.heroLayers ?? []) {
    if (!existsSync(path.join(/* turbopackIgnore: true */ process.cwd(), "public", layer.slice(1)))) {
      throw new ThemeImportError(`Calque du décor introuvable sur ce site : ${layer}.`);
    }
  }

  // Éléments dessinés : chaque chemin référencé est dans l'archive ou déjà sur ce serveur.
  const used = new Map<string, { ext: string; data: Buffer }>();
  const sides = cursorSides(theme);
  for (const p of kitPaths(theme)) {
    const asset = assets.get(p);
    if (!asset) {
      if (await getStorage().stat(p.slice("/media/".length))) continue;
      throw new ThemeImportError(`Élément dessiné manquant dans l'archive : ${path.basename(p)}.`);
    }
    const hash = createHash("sha256").update(asset.data).digest("hex").slice(0, 16);
    if (`/media/kit/${hash}.${asset.ext}` !== p) throw new ThemeImportError(`${path.basename(p)} : contenu différent de son nom (fichier modifié ?).`);
    if (asset.ext === "svg") {
      const problem = svgProblem(asset.data);
      if (problem) throw new ThemeImportError(`${path.basename(p)} refusé : ${problem}.`);
    } else {
      const type = sniffImage(asset.data.subarray(0, 64));
      if (!type || type.ext !== asset.ext) throw new ThemeImportError(`${path.basename(p)} : ce n'est pas une image ${asset.ext.toUpperCase()}.`);
      // En-tête seulement (aucun décodage des pixels).
      const meta = await sharp(asset.data, { limitInputPixels: false }).metadata().catch(() => null);
      if (!meta?.width || !meta.height) throw new ThemeImportError(`${path.basename(p)} : image illisible.`);
      if (meta.width > IMPORT_LIMITS.maxSide || meta.height > IMPORT_LIMITS.maxSide || meta.width * meta.height > IMPORT_LIMITS.maxPixels) {
        throw new ThemeImportError(`${path.basename(p)} : image trop grande (${meta.width} × ${meta.height} px).`);
      }
      // Curseur (lot 4) : PNG exactement 32 × 32 (1x) ou 64 × 64 (2x), comme à l'import du kit.
      if (asset.ext === "png") {
        const wanted = sides.get(p);
        if (!wanted) throw new ThemeImportError(`${path.basename(p)} : un PNG n'est accepté que pour un curseur.`);
        const side = wanted.find((n) => meta.width !== n || meta.height !== n);
        if (side) throw new ThemeImportError(`${path.basename(p)} : curseur de ${meta.width} × ${meta.height} px, il faut ${side} × ${side}.`);
      }
    }
    used.set(p, asset);
  }
  return { theme, assets: used };
}

/** Importe l'archive : nouvelle ligne de thème (non livrée, non active). */
export async function importThemePackage(buf: Buffer): Promise<{ id: string; name: string }> {
  const { theme, assets } = await parseThemePackage(buf);
  const storage = getStorage();
  for (const [p, asset] of assets) {
    const key = p.slice("/media/".length);
    if (!(await storage.stat(key))) await storage.put(key, Readable.from(asset.data));
  }
  const db = getDb();
  const taken = (id: string) => Boolean(db.select({ id: schema.themes.id }).from(schema.themes).where(eq(schema.themes.id, id)).get());
  const nameTaken = (name: string) => Boolean(db.select({ id: schema.themes.id }).from(schema.themes).where(eq(schema.themes.name, name)).get());
  const baseName = theme.name.replace(/ \(importé(?: \d+)?\)$/, "").slice(0, 64);
  const base = (slugify(baseName) || "theme").slice(0, 60);
  // Nom et identifiant libres choisis ET écrits dans une même transaction
  // IMMEDIATE ; deux imports simultanés du même nom (autre processus) : la
  // contrainte d'unicité fait recommencer avec le suffixe suivant, jamais une 500.
  for (let attempt = 0; ; attempt++) {
    try {
      return getSqlite()
        .transaction(() => {
          let name = baseName;
          for (let n = 1; nameTaken(name); n++) name = n === 1 ? `${baseName} (importé)` : `${baseName} (importé ${n})`;
          let id = base;
          for (let n = 1; taken(id); n++) id = `${base}-import${n === 1 ? "" : `-${n}`}`;
          const row: Theme = ThemeSchema.parse({ ...theme, id, name, preset: false });
          db.insert(schema.themes).values({ id, name, preset: false, data: JSON.stringify(row) }).run();
          return { id, name };
        })
        .immediate();
    } catch (error) {
      if (attempt < 5 && /UNIQUE|constraint/i.test(String((error as Error)?.message))) continue;
      throw error;
    }
  }
}
