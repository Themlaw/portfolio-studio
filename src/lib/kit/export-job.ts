/**
 * Export du kit PSD d'un thème, à la demande (admin) :
 *  - version = empreinte de l'état ENREGISTRÉ du thème ; fichier en cache dans
 *    ${DATA_DIR}/cache/kits/<thème>-<version>.psd (un thème modifié : nouvelle
 *    version, les anciennes sont purgées) ;
 *  - génération par un job « kit » de la file LOURDE (jamais en même temps
 *    qu'une conversion vidéo), dans un processus enfant (child.ts) ;
 *  - le manifeste de l'export (empreintes, aperçus) reste dans
 *    cache/kits/manifests : l'import y reconnaît les emplacements inchangés.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, desc, eq, inArray } from "drizzle-orm";

import { dataDir, getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { getStorage } from "@/lib/storage";
import { siteNameFor } from "@/lib/site-schema";
import { PRESETS } from "@/themes/presets";
import { ThemeSchema, type Theme } from "@/themes/schema";

import { readStoredSeo } from "@/lib/edit/seo";
import { readIcon } from "@/lib/favicon";
import { planIcon } from "@/lib/favicon-plan";

import { exportIdOf, loadManifests } from "./manifest";
import { KIT_V4_VERSION } from "./spec";
import { themeVersion } from "./version";

/** Durée maximale d'un export (au-delà : processus tué, job en échec). */
const EXPORT_TIMEOUT_MS = Number(process.env.KIT_EXPORT_MAX_DURATION_S || 120) * 1000;
/**
 * Plafond de mémoire résidente du processus enfant (export ou import) : lue
 * dans /proc/<pid>/status toutes les 200 ms, processus tué au-delà. Pas de
 * prlimit dans l'image distroless ; le tas JS est en plus borné
 * (--max-old-space-size). Mesuré : export 346 Mo, import du fichier réel 153 Mo.
 */
export const KIT_CHILD_MAX_RSS_MB = Number(process.env.KIT_CHILD_MAX_RSS_MB || 650);
const KIT_CHILD_HEAP_MB = 256;
/** Sortie gardée du processus enfant (une ligne JSON attendue). */
const MAX_CHILD_OUTPUT = 64 * 1024;

export const kitDir = () => path.join(/* turbopackIgnore: true */ dataDir(), "cache", "kits");
/** Manifestes des kits exportés (empreintes, aperçus « avant ») : gardés, petits, l'import en a besoin. */
export const manifestDir = () => path.join(/* turbopackIgnore: true */ kitDir(), "manifests");
/** Archive en cache : thème, état enregistré, version du FORMAT du kit (un kit v3 en cache n'est pas resservi). */
export const kitFile = (themeId: string, version: string) => path.join(/* turbopackIgnore: true */ kitDir(), `${themeId}-${version}-v${KIT_V4_VERSION}.zip`);

/** Nom du site (réglages, lu en base : le worker n'a pas le cache de Next). */
export function kitSiteName(): string {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, "site")).get();
  const site = parseJson(row?.value) as { name?: unknown } | null;
  return siteNameFor(site?.name, "fr").trim() || "Portfolio";
}

/** Version du kit d'un thème : son état enregistré, le nom du site et l'icône actuelle du site (pré-remplie dans la case « Icône du site », lot 83). */
export const kitVersion = (theme: Theme) => {
  const siteName = kitSiteName();
  return themeVersion(theme, `${siteName}\n${planIcon(readStoredSeo(), theme, siteName).fp}`);
};

/** Thème enregistré (base, sinon preset livré), jamais l'aperçu en cours d'édition. */
export function loadSavedTheme(id: string): Theme | null {
  const row = getDb().select().from(schema.themes).where(eq(schema.themes.id, id)).get();
  if (row) {
    const parsed = ThemeSchema.safeParse(parseJson(row.data));
    return parsed.success ? parsed.data : null;
  }
  return PRESETS[id] ?? null;
}

/** Supprime les kits en cache d'un thème (sauf, éventuellement, une version). */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Kit en cache de CE thème : `<id>-<hex12>-v<n>.zip` (ou `.psd` des anciens formats) exactement (un thème « a-b » n'est pas « a »). */
const kitFileRe = (themeId: string) => new RegExp(`^${escapeRe(themeId)}-[0-9a-f]{12}-v\\d+\\.(?:zip|psd)(\\.tmp|\\.parts)?$`);

export async function purgeKits(themeId: string, keep?: string): Promise<void> {
  const re = kitFileRe(themeId);
  for (const name of await readdir(kitDir()).catch(() => [] as string[])) {
    if (re.test(name) && (!keep || name !== path.basename(kitFile(themeId, keep)))) {
      await rm(path.join(/* turbopackIgnore: true */ kitDir(), name), { force: true, recursive: true });
    }
  }
}

/** Cache des kits borné : au plus MAX_CACHED_KITS archives (ou anciens PSD), les plus anciennes supprimées. */
export const MAX_CACHED_KITS = 20;
export async function capKitCache(max = MAX_CACHED_KITS): Promise<number> {
  const dir = kitDir();
  const files: { name: string; mtime: number }[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!name.endsWith(".zip") && !name.endsWith(".psd")) continue;
    const info = await stat(path.join(/* turbopackIgnore: true */ dir, name)).catch(() => null);
    if (info) files.push({ name, mtime: info.mtimeMs });
  }
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files.slice(max)) await rm(path.join(/* turbopackIgnore: true */ dir, f.name), { force: true });
  return Math.max(0, files.length - max);
}

/** Thème supprimé : ses kits en cache, ses manifestes et leurs aperçus. */
export async function purgeKitData(themeId: string): Promise<void> {
  await purgeKits(themeId);
  const dir = manifestDir();
  for (const m of await loadManifests(dir)) {
    if (m.themeId !== themeId) continue;
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (name === `${m.exportId}.json` || name.startsWith(`${m.exportId}--`)) await rm(path.join(/* turbopackIgnore: true */ dir, name), { force: true });
    }
  }
}

export type KitExportState =
  | { ready: true; version: string }
  | { ready: false; version: string; status: "queued" | "running" | "failed"; error?: string };

/** État de l'export (et mise en file s'il le faut). */
export async function requestKitExport(theme: Theme, wake: () => void): Promise<KitExportState> {
  const version = kitVersion(theme);
  if (existsSync(kitFile(theme.id, version))) return { ready: true, version };
  const db = getDb();
  const jobs = db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.kind, "kit"))
    .orderBy(desc(schema.jobs.id))
    .all()
    .filter((j) => j.payload?.themeId === theme.id && j.payload?.version === version);
  const live = jobs.find((j) => j.status === "queued" || j.status === "running");
  if (live) return { ready: false, version, status: live.status as "queued" | "running" };
  db.insert(schema.jobs).values({ kind: "kit", payload: { themeId: theme.id, version } }).run();
  wake();
  return { ready: false, version, status: "queued" };
}

/** Dernier échec d'export de cette version (affiché par l'interface). */
export function lastKitFailure(themeId: string, version: string): string | null {
  const job = getDb()
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.kind, "kit"), inArray(schema.jobs.status, ["failed"])))
    .orderBy(desc(schema.jobs.id))
    .all()
    .find((j) => j.payload?.themeId === themeId && j.payload?.version === version);
  return job?.error ?? null;
}

/** Commande du processus enfant : bundle du standalone, sinon source via tsx (dev). */
function childCommand(): string[] {
  const bundled = path.join(/* turbopackIgnore: true */ process.cwd(), "kit-child.cjs");
  const heap = `--max-old-space-size=${KIT_CHILD_HEAP_MB}`;
  if (existsSync(bundled)) return [process.execPath, "--expose-gc", heap, bundled];
  return [process.execPath, "--expose-gc", heap, "--import", "tsx", path.join(/* turbopackIgnore: true */ process.cwd(), "src/lib/kit/child.ts")];
}

export type ChildResult = { ok: boolean; error?: string; bytes?: number; ms?: number; peakMb?: number; oom?: number | null; reportOk?: boolean; problem?: string | null };

/** Processus enfant en cours (un seul : file lourde) ; tué avant d'en lancer un autre. */
const G = globalThis as typeof globalThis & { __portfolioKitChild?: number };

/** Mémoire résidente d'un processus (Mo), ou null s'il n'existe plus. */
function rssMb(pid: number): number | null {
  try {
    const kb = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1];
    return kb ? Number(kb) / 1024 : null;
  } catch {
    return null;
  }
}

/**
 * Processus enfant (export ou import), sous nice, environnement minimal,
 * durée et mémoire bornées (tué au-delà, résultat en échec lisible).
 */
export function runKitChild(input: object, timeoutMs = EXPORT_TIMEOUT_MS): Promise<ChildResult> {
  const publicDir = path.join(/* turbopackIgnore: true */ process.cwd(), "public");
  // Un enfant précédent encore vivant (hors conteneur, worker relancé…) : tué.
  if (G.__portfolioKitChild && rssMb(G.__portfolioKitChild) !== null) {
    try {
      process.kill(G.__portfolioKitChild, "SIGKILL");
    } catch {
      // déjà parti
    }
  }
  return new Promise((resolve) => {
    const [cmd, ...args] = childCommand();
    // nice : la génération ne ralentit pas le site ; environnement minimal (aucun secret).
    const child = spawn("nice", ["-n", "10", cmd, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        NODE_ENV: process.env.NODE_ENV ?? "production",
        MALLOC_ARENA_MAX: "2",
        MALLOC_MMAP_THRESHOLD_: "131072",
        FONTCONFIG_FILE: path.join(/* turbopackIgnore: true */ publicDir, "kit/fonts.conf"),
        XDG_CACHE_HOME: "/tmp",
        HOME: "/tmp",
      },
    });
    G.__portfolioKitChild = child.pid;
    // Priorité OOM maximale (l'enfant l'écrit aussi lui-même au démarrage).
    try {
      if (child.pid) writeFileSync(`/proc/${child.pid}/oom_score_adj`, "1000");
    } catch {
      // non permis ou hors Linux : l'enfant s'en charge
    }
    let out = "";
    let err = "";
    let killed: "temps" | "mémoire" | null = null;
    let peak = 0;
    child.stdout.on("data", (d) => (out = (out + d).slice(-MAX_CHILD_OUTPUT)));
    child.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    const kill = (why: "temps" | "mémoire") => {
      killed ??= why;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => kill("temps"), timeoutMs);
    const watch = setInterval(() => {
      const mb = child.pid ? rssMb(child.pid) : null;
      if (mb === null) return;
      peak = Math.max(peak, mb);
      if (mb > KIT_CHILD_MAX_RSS_MB) kill("mémoire");
    }, 200);
    child.on("close", (code) => {
      clearTimeout(timer);
      clearInterval(watch);
      if (G.__portfolioKitChild === child.pid) G.__portfolioKitChild = undefined;
      if (killed) {
        resolve({ ok: false, error: killed === "temps" ? "kit : trop de temps" : `kit : mémoire dépassée (${Math.round(peak)} Mo, plafond ${KIT_CHILD_MAX_RSS_MB} Mo)` });
        return;
      }
      const last = out.trim().split("\n").pop() ?? "";
      try {
        resolve(JSON.parse(last));
      } catch {
        resolve({ ok: false, error: `kit : code ${code} ${err.trim().split("\n").pop() ?? ""}` });
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

/** Asset du kit d'un thème pour le pré-remplissage : fichier local, taille servie, position (plans). */
export type KitAssetFile = {
  file: string;
  w: number;
  h: number;
  x?: number;
  y?: number;
  /** Lot 99 : le fichier est le dessin en COULEURS D'ORIGINE (trait, flèches) : replacé tel quel dans le calque, jamais teinté. */
  colored?: true;
};

/**
 * Fichiers des éléments dessinés déjà appliqués au thème (`theme.assets.kit`),
 * par emplacement : le kit d'une copie « (kit) » repart des dessins de
 * l'artiste (aller-retour sans fin). SVG de préférence, sinon WebP.
 */
export async function kitAssetFiles(theme: Theme): Promise<Record<string, KitAssetFile>> {
  const kit = theme.assets.kit;
  const out: Record<string, KitAssetFile> = {};
  if (kit) await addKitAssets(theme, kit, out);
  // Lot 83 : la case « Icône du site » montre l'icône ACTUELLE du site (logo, monogramme ou image) tant que le calque n'est pas dessiné.
  if (!out["icone-site"]) {
    try {
      const png = await readIcon(planIcon(readStoredSeo(), theme, kitSiteName()), "512.png");
      if (png) {
        await mkdir(kitDir(), { recursive: true });
        const file = path.join(/* turbopackIgnore: true */ kitDir(), `icone-site-${theme.id.replace(/[^a-zA-Z0-9-]/g, "_")}.png`);
        await writeFile(file, png);
        out["icone-site"] = { file, w: 512, h: 512 };
      }
    } catch (error) {
      console.error("[kit] icône actuelle du site indisponible, case laissée au gabarit", error);
    }
  }
  return out;
}

async function addKitAssets(theme: Theme, kit: NonNullable<Theme["assets"]["kit"]>, out: Record<string, KitAssetFile>): Promise<void> {
  const storage = getStorage();
  const add = async (slotId: string, img: { svg?: string; webp?: string; color?: { webp: string }; w: number; h: number; x?: number; y?: number } | null | undefined) => {
    // Lot 99 : le dessin en couleurs d'origine d'abord (l'aller-retour garde la barre et les flèches telles que dessinées).
    const colorUrl = img?.color?.webp;
    const url = colorUrl ?? img?.svg ?? img?.webp;
    if (!img || !url?.startsWith("/media/")) return;
    const file = await storage.localPath(url.slice("/media/".length));
    if (file) out[slotId] = { file, w: img.w, h: img.h, ...(img.x !== undefined ? { x: img.x, y: img.y } : {}), ...(colorUrl ? { colored: true as const } : {}) };
  };
  for (let n = 0; n < 5; n++) await add(`hero/plan-${n + 1}`, kit.plans?.[n]);
  await add("signature", kit.signature);
  await add("icone-site", kit.icon);
  await add("papier", kit.paper?.image);
  await add("cadre", kit.frame?.image);
  await add("trait", kit.stroke);
  await add("icones/fleche-gauche", kit.icons?.arrowLeft);
  await add("icones/fleche-droite", kit.icons?.arrowRight);
  await add("icones/fermer", kit.icons?.close);
  await add("icones/lecture", kit.icons?.play);
  await add("accessoires/scotch", kit.tape);
  // Curseurs : le PNG 2x (64 × 64, la case du kit) ; x, y = point chaud (px CSS).
  for (const [slotId, c] of [
    ["curseur/normal", kit.cursors?.default],
    ["curseur/clic", kit.cursors?.pointer],
  ] as const) {
    if (!c) continue;
    const file = await storage.localPath(c.png2x.slice("/media/".length));
    if (file) out[slotId] = { file, w: 64, h: 64, x: c.x, y: c.y };
  }
}

/** Job « kit » (file lourde) : génère le PSD de la version demandée. */
export async function runKitJob(job: { id: number; payload: Record<string, unknown> | null }): Promise<void> {
  const db = getDb();
  const finish = (status: "done" | "failed", error: string | null = null) =>
    db.update(schema.jobs).set({ status, error, updatedAt: new Date() }).where(eq(schema.jobs.id, job.id)).run();
  const themeId = String(job.payload?.themeId ?? "");
  const theme = loadSavedTheme(themeId);
  if (!theme) return void finish("failed", "Ce thème n'existe plus.");
  const siteName = kitSiteName();
  const version = kitVersion(theme);
  // Le thème a changé depuis la demande : la nouvelle version sera demandée à son tour.
  if (version !== job.payload?.version) return void finish("done");
  await mkdir(kitDir(), { recursive: true });
  const result = await runKitChild({
    mode: "export",
    theme,
    publicDir: path.join(/* turbopackIgnore: true */ process.cwd(), "public"),
    out: kitFile(themeId, version),
    exportId: exportIdOf(themeId, version, KIT_V4_VERSION),
    themeVersion: version,
    siteName,
    assets: await kitAssetFiles(theme),
    manifestDir: manifestDir(),
  });
  if (!result.ok) {
    console.error(`[kit] export du thème ${themeId} : échec`, result.error);
    await rm(`${kitFile(themeId, version)}.tmp`, { force: true });
    return void finish(
      "failed",
      /mémoire/.test(result.error ?? "")
        ? "La génération du kit a dépassé la mémoire permise. Réessaie quand aucune vidéo n'est en conversion ; si ça recommence, signale-le."
        : "La génération du kit a échoué. Réessaie ; si ça recommence, vérifie l'espace disque du serveur.",
    );
  }
  await purgeKits(themeId, version);
  await capKitCache();
  console.log(`[kit] thème ${themeId} : kit ${version} généré (${Math.round((result.bytes ?? 0) / 1024)} Ko, ${result.ms} ms, pic ${result.peakMb} Mo, oom ${result.oom})`);
  finish("done");
}
