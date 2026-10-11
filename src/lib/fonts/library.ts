/**
 * Polices Google téléchargées UNE fois par le serveur et servies par le site
 * (`/fonts/<empreinte>.woff2`, src/app/fonts/[file]/route.ts) : le navigateur
 * des visiteurs ne contacte jamais Google (RGPD), la CSP ne change pas.
 *
 * - Famille : uniquement du catalogue embarqué (src/themes/google-fonts.json) ;
 *   hôtes fixes (fonts.googleapis.com pour la feuille, fonts.gstatic.com pour
 *   les fichiers), jamais une adresse venue du client ; redirections refusées.
 * - Sous-ensembles latin + latin-ext, woff2 seulement (signature contrôlée),
 *   un style (graisse × italique) à la fois : celui que l'artiste applique.
 * - Bornes : FONT_LIMITS (familles, styles, taille d'un fichier et du total).
 * - Fichiers dans le volume de données (<DATA_DIR>/fonts), nommés par leur
 *   empreinte ; liste dans le réglage `fontLibrary`.
 * Toute erreur réseau donne un message clair et rien n'est enregistré.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { googleFamily, nearestWeight } from "@/themes/google-fonts";

import { dataDir, getDb, getSqlite, schema } from "../db";
import { done, fail, type ActionResult } from "../edit/result";
import { parseJson } from "../json";
import { FONT_FILE, FONT_LIMITS, googleCssUrl, hasFace, libraryFiles, parseGoogleCss, readLibrary, SUBSETS, unusedFamilies, type Face, type FontLibrary } from "./faces";
import { fontUsage } from "./usage";

/** Navigateur récent : Google ne sert le woff2 qu'à un agent qui le comprend. */
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TIMEOUT_MS = 12_000;

export function fontsDir(): string {
  return path.join(dataDir(), "fonts");
}

export function readFontLibrary(): FontLibrary {
  return readLibrary(parseJson(getDb().select().from(schema.settings).where(eq(schema.settings.key, "fontLibrary")).get()?.value));
}

function writeLibrary(lib: FontLibrary): void {
  const v = JSON.stringify(lib);
  getDb().insert(schema.settings).values({ key: "fontLibrary", value: v }).onConflictDoUpdate({ target: schema.settings.key, set: { value: v } }).run();
}

/** Lit au plus `max` octets d'une réponse (coupée au-delà : erreur). */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) throw new Error("fichier trop gros");
  const reader = res.body?.getReader();
  if (!reader) throw new Error("réponse vide");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error("fichier trop gros");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function get(url: string, max: number, accept: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return readCapped(res, max);
}

const isWoff2 = (b: Buffer) => b.length > 48 && b.subarray(0, 4).toString("latin1") === "wOF2";

/** Range un fichier par son empreinte ; `created` : il n'existait pas (à retirer si l'installation échoue). */
async function store(bytes: Buffer, dir = fontsDir()): Promise<{ file: string; created: boolean }> {
  const file = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.woff2`;
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, file);
  try {
    await stat(target);
    return { file, created: false };
  } catch {
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, target);
    return { file, created: true };
  }
}

/**
 * Verrou du processus : installations, ramasse-miettes et suppressions de
 * polices passent l'une après l'autre (un fichier écrit par une installation
 * en cours n'est jamais pris pour un orphelin, deux installations ne
 * dépassent jamais ensemble les bornes). La bibliothèque elle-même s'écrit
 * dans une transaction IMMEDIATE (relue et revérifiée au moment d'écrire).
 */
let chain: Promise<unknown> = Promise.resolve();
function withFontLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

/** Fichiers .woff2 du dossier que la bibliothèque ne cite plus : supprimés. */
async function removeOrphanFiles(lib: FontLibrary): Promise<number> {
  const keep = libraryFiles(lib);
  let names: string[] = [];
  try {
    names = await readdir(fontsDir());
  } catch {
    return 0;
  }
  let n = 0;
  for (const name of names) {
    if (!FONT_FILE.test(name) || keep.has(name)) continue;
    await rm(path.join(fontsDir(), name), { force: true });
    n++;
  }
  return n;
}

/** Retire de la bibliothèque les familles qu'aucun style n'utilise (hors `keep`), puis leurs fichiers. */
async function collectUnlocked(keep: string[] = []): Promise<{ removed: string[]; files: number; library: FontLibrary }> {
  const used = [...fontUsage().keys()];
  const sqlite = getSqlite();
  const { removed, library } = sqlite
    .transaction(() => {
      const lib = readFontLibrary();
      const gone = unusedFamilies(lib, used, keep);
      for (const f of gone) delete lib[f];
      if (gone.length) writeLibrary(lib);
      return { removed: gone, library: lib };
    })
    .immediate();
  const files = await removeOrphanFiles(library);
  if (removed.length) console.log(`[fonts] polices inutilisées retirées : ${removed.join(", ")} (${files} fichier(s))`);
  return { removed, files, library };
}

/** Ramasse-miettes des polices (après une publication, ou à la demande). */
export function collectFonts(keep: string[] = []): Promise<{ removed: string[]; files: number; library: FontLibrary }> {
  return withFontLock(() => collectUnlocked(keep));
}

export type FontRow = { family: string; styles: number; bytes: number; uses: string[] };

/** Écran « Polices téléchargées » : familles, poids, usages. */
export function fontLibraryRows(): { rows: FontRow[]; total: number; limits: typeof FONT_LIMITS } {
  const lib = readFontLibrary();
  const usage = fontUsage();
  const rows = Object.entries(lib).map(([family, faces]) => ({
    family,
    styles: new Set(faces.map((f) => `${f.weight}${f.italic ? "i" : ""}`)).size,
    bytes: faces.reduce((n, f) => n + f.bytes, 0),
    uses: usage.get(family) ?? [],
  }));
  return { rows, total: rows.reduce((n, r) => n + r.bytes, 0), limits: FONT_LIMITS };
}

/** Supprime une police téléchargée qu'aucun style n'utilise. */
export function deleteFont(familyIn: unknown): Promise<ActionResult<{ library: FontLibrary }>> {
  return withFontLock(async () => {
    const family = typeof familyIn === "string" ? familyIn.slice(0, 80) : "";
    const uses = fontUsage().get(family) ?? [];
    if (uses.length) return fail(`« ${family} » est utilisée (${uses.slice(0, 3).join(", ")}) : retire-la de ces styles d'abord.`);
    const sqlite = getSqlite();
    const library = sqlite
      .transaction(() => {
        const lib = readFontLibrary();
        if (!Object.hasOwn(lib, family)) return null;
        delete lib[family];
        writeLibrary(lib);
        return lib;
      })
      .immediate();
    if (!library) return fail("Cette police n'est plus dans la bibliothèque.");
    await removeOrphanFiles(library);
    return done({ library });
  });
}

/** Message quand la place est prise par des polices toutes utilisées. */
function fullMessage(what: string): string {
  const usage = fontUsage();
  const list = Object.keys(readFontLibrary())
    .map((f) => `${f} (${(usage.get(f) ?? []).slice(0, 2).join(", ")})`)
    .slice(0, 6)
    .join(" ; ");
  return `${what}, et toutes servent encore : ${list}. Remplace une de ces polices dans tes styles (ou dans les brouillons), puis réessaie ; Réglages → Polices téléchargées montre où chacune est utilisée.`;
}

export type InstallResult = { family: string; weight: number; italic: boolean; library: FontLibrary; installed: boolean };

/**
 * Télécharge un style d'une famille (s'il manque) : feuille css2, puis les
 * fichiers latin et latin-ext. Rien n'est enregistré si un fichier échoue.
 */
export function installGoogleFont(familyIn: unknown, weightIn: unknown, italicIn: unknown): Promise<ActionResult<InstallResult>> {
  return withFontLock(() => installUnlocked(familyIn, weightIn, italicIn));
}

async function installUnlocked(familyIn: unknown, weightIn: unknown, italicIn: unknown): Promise<ActionResult<InstallResult>> {
  const g = typeof familyIn === "string" ? googleFamily(familyIn) : undefined;
  if (!g) return fail("Police inconnue : choisis-la dans le catalogue.");
  const italic = italicIn === true && g.italics.length > 0;
  const weight = nearestWeight(g, typeof weightIn === "number" && Number.isFinite(weightIn) ? weightIn : 400, italic);
  let lib = readFontLibrary();
  if (hasFace(lib, g.family, weight, italic)) return done({ family: g.family, weight, italic, library: lib, installed: false });
  // Quota : seules les polices utilisées comptent ; les autres sont retirées d'abord.
  if (!lib[g.family] && Object.keys(lib).length >= FONT_LIMITS.families) {
    lib = (await collectUnlocked([g.family])).library;
    if (Object.keys(lib).length >= FONT_LIMITS.families) return fail(fullMessage(`${FONT_LIMITS.families} polices téléchargées au plus`));
  }
  const styles = new Set((lib[g.family] ?? []).map((f) => `${f.weight}${f.italic ? "i" : ""}`));
  if (styles.size >= FONT_LIMITS.facesPerFamily) return fail(`${FONT_LIMITS.facesPerFamily} styles au plus par police.`);

  const created: string[] = [];
  const cleanup = () => Promise.all(created.map((f) => rm(path.join(fontsDir(), f), { force: true })));
  let faces: Face[];
  try {
    const css = (await get(googleCssUrl(g.family, weight, italic), FONT_LIMITS.cssBytes, "text/css,*/*;q=0.1")).toString("utf8");
    const wanted = parseGoogleCss(css).filter((f) => (SUBSETS as readonly string[]).includes(f.subset) && f.weight === weight && f.italic === italic);
    if (!wanted.some((f) => f.subset === "latin")) throw new Error("sous-ensemble latin absent");
    faces = [];
    for (const f of wanted) {
      const bytes = await get(f.url, FONT_LIMITS.fileBytes, "font/woff2,*/*;q=0.1");
      if (!isWoff2(bytes)) throw new Error("fichier woff2 invalide");
      const stored = await store(bytes);
      if (stored.created) created.push(stored.file);
      faces.push({ weight, italic, subset: f.subset as Face["subset"], file: stored.file, range: f.range, bytes: bytes.length });
    }
  } catch (error) {
    await cleanup();
    console.error(`[fonts] « ${g.family} » ${weight}${italic ? " italique" : ""} : ${(error as Error).message}`);
    return fail(`Impossible de télécharger « ${g.family} » (réseau ou Google Fonts indisponible). La police n'est pas appliquée : réessaie plus tard.`);
  }
  const added = faces.reduce((n, f) => n + f.bytes, 0);
  const size = (l: FontLibrary) => Object.values(l).flat().reduce((n, f) => n + f.bytes, 0);
  // Place pleine : polices inutilisées retirées, puis nouvelle vérification.
  if (size(readFontLibrary()) + added > FONT_LIMITS.totalBytes) await collectUnlocked([g.family]);
  // Écriture : relue et revérifiée dans la même transaction.
  const sqlite = getSqlite();
  const outcome = sqlite
    .transaction((): { library: FontLibrary } | { refused: string } => {
      const current = readFontLibrary();
      if (hasFace(current, g.family, weight, italic)) return { library: current };
      if (!current[g.family] && Object.keys(current).length >= FONT_LIMITS.families) return { refused: "families" };
      if (size(current) + added > FONT_LIMITS.totalBytes) return { refused: "bytes" };
      current[g.family] = [...(current[g.family] ?? []), ...faces];
      writeLibrary(current);
      return { library: current };
    })
    .immediate();
  if ("refused" in outcome) {
    await cleanup();
    return fail(fullMessage(outcome.refused === "families" ? `${FONT_LIMITS.families} polices téléchargées au plus` : "Place réservée aux polices pleine"));
  }
  return done({ family: g.family, weight, italic, library: outcome.library, installed: true });
}

/** Fichier d'une police téléchargée (nom contrôlé), ou null. */
export async function readFontFile(file: string): Promise<Buffer | null> {
  if (!FONT_FILE.test(file)) return null;
  try {
    return await readFile(path.join(fontsDir(), file));
  } catch {
    return null;
  }
}

/**
 * Aperçu d'une famille dans le menu des polices (admin) : sous-ensemble
 * minuscule limité aux lettres de son nom (`text=`), téléchargé par le
 * serveur et gardé en cache disque. null si indisponible.
 */
export async function previewFont(familyIn: string): Promise<Buffer | null> {
  const g = googleFamily(familyIn);
  if (!g) return null;
  const dir = path.join(fontsDir(), "preview");
  const key = createHash("sha256").update(g.family).digest("hex").slice(0, 16);
  const cachedFile = path.join(dir, `${key}.woff2`);
  try {
    return await readFile(cachedFile);
  } catch {}
  try {
    const weight = nearestWeight(g, 400, false);
    const css = (await get(googleCssUrl(g.family, weight, false, `${g.family}Aa`), FONT_LIMITS.cssBytes, "text/css,*/*;q=0.1")).toString("utf8");
    const face = parseGoogleCss(css)[0];
    if (!face) return null;
    const bytes = await get(face.url, 200_000, "font/woff2,*/*;q=0.1");
    if (!isWoff2(bytes)) return null;
    await mkdir(dir, { recursive: true });
    const tmp = `${cachedFile}.${process.pid}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, cachedFile);
    return bytes;
  } catch (error) {
    console.error(`[fonts] aperçu « ${g.family} » : ${(error as Error).message}`);
    return null;
  }
}
