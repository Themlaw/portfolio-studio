/**
 * « Appliquer au thème » (écran de revue d'un import de kit) : crée une COPIE
 * BROUILLON du thème avec les nouveaux assets — jamais le thème en ligne
 * remplacé sans validation. Emplacement redessiné → fichiers rangés par leur
 * contenu sous /media/kit/<sha256 16>.<ext> ; inchangé, absent ou en erreur →
 * l'asset actuel du thème est gardé. Palette suggérée : seulement si demandée,
 * et seulement si elle passe le contraste AA.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { done, fail, type ActionResult } from "@/lib/edit/result";
import { slugify } from "@/lib/slug";
import { getStorage } from "@/lib/storage";
import { AA, contrastReport } from "@/themes/contrast";
import { PAPER_OVER_HERO_DEFAULT, ThemeSchema, type KitAssets, type KitImage, type KitPlan, type Theme } from "@/themes/schema";

import { loadSavedTheme } from "./export-job";
import type { KitReport, SlotReport } from "./import";
import { getKitImport, importOutDir, writeImportMeta } from "./import-job";
import { arrowMirror, isApplicable, mirrorBitmap, mirrorSvg } from "./mirror";
import { SLOTS } from "./spec";

const FIRST_VIEW = ["hero/plan-1", "hero/plan-2", "hero/plan-3", "hero/plan-4", "hero/plan-5", "signature", "papier"];

export { arrowMirror, isApplicable };

/** Palette suggérée appliquée aux couleurs du thème (rôles présents seulement). */
export function withPalette(colors: Theme["tokens"]["color"], report: KitReport): Theme["tokens"]["color"] {
  const roles = report.palette?.roles ?? {};
  const out = { ...colors };
  for (const key of ["bg", "bgDeep", "ink", "inkSoft", "primary", "secondary", "tertiary"] as const) if (roles[key]) out[key] = roles[key]!;
  return out;
}

/** La palette suggérée passe-t-elle le contraste AA sur ce thème ? (couples en échec) */
export function paletteFailures(theme: Theme, report: KitReport): string[] {
  if (!report.palette) return [];
  return contrastReport(withPalette(theme.tokens.color, report))
    .filter((p) => !p.ok)
    .map((p) => `${p.label} : ${p.ratio.toFixed(2)}:1 (il faut ${AA}:1)`);
}

/* ---- Poids au premier affichage ----------------------------------------- */

async function urlBytes(url: string | undefined): Promise<number> {
  if (!url) return 0;
  if (url.startsWith("/media/")) return (await getStorage().stat(url.slice("/media/".length)))?.size ?? 0;
  const file = path.join(/* turbopackIgnore: true */ process.cwd(), "public", url.replace(/^\//, ""));
  return (await stat(file).catch(() => null))?.size ?? 0;
}
const imageBytes = (k: KitImage | null | undefined) => (k ? urlBytes(k.svg ?? k.avif) : Promise.resolve(0));

/** Poids actuel (servi) d'un emplacement du premier affichage pour ce thème. */
async function currentBytes(theme: Theme, id: string): Promise<number> {
  const kit = theme.assets.kit;
  const m = id.match(/^hero\/plan-(\d)$/);
  if (m) {
    const n = Number(m[1]) - 1;
    const plan = kit?.plans?.[n];
    return plan ? imageBytes(plan) : urlBytes(theme.assets.heroLayers?.[n]);
  }
  if (id === "signature") return imageBytes(kit?.signature);
  if (id === "papier") return imageBytes(kit?.paper?.image);
  return 0;
}

/** Total au premier affichage APRÈS application (nouveaux assets + assets gardés). */
export async function firstViewTotal(theme: Theme, report: KitReport): Promise<{ before: number; after: number }> {
  let before = 0;
  let after = 0;
  for (const id of FIRST_VIEW) {
    const cur = await currentBytes(theme, id);
    const slot = report.slots.find((s) => s.id === id);
    before += cur;
    after += slot && isApplicable(slot) ? (slot.bytes ?? 0) : cur;
  }
  return { before, after };
}

/* ---- Application ---------------------------------------------------------- */

export type ApplyOptions = { palette: boolean; mirror: boolean };

export async function applyKitImport(themeId: string, importId: string, opts: ApplyOptions): Promise<ActionResult<{ id: string }>> {
  // L'import doit appartenir au thème de l'écran (sinon : inconnu).
  const state = await getKitImport(importId, themeId);
  if (!state?.report) return fail("Cet import n'est pas terminé ou n'existe plus.");
  const { meta, report } = state;
  if (!report.ok && report.problem) return fail(report.problem);
  const source = loadSavedTheme(meta.themeId);
  if (!source) return fail("Le thème d'origine n'existe plus.");
  const changed = report.slots.filter(isApplicable);
  if (changed.length === 0 && !(opts.palette && report.palette)) return fail("Rien à appliquer : aucun élément n'a été redessiné.");
  if (opts.palette && paletteFailures(source, report).length) return fail("La palette suggérée ne passe pas le contraste : applique sans la palette, puis ajuste les couleurs dans l'éditeur.");

  const storage = getStorage();
  const outDir = importOutDir(importId);
  /** Fichier rangé par son contenu : /media/kit/<sha256 16>.<ext>. */
  const put = async (file: string): Promise<string> => {
    const data = await readFile(path.join(/* turbopackIgnore: true */ outDir, path.basename(file)));
    const ext = path.extname(file).slice(1);
    const key = `kit/${createHash("sha256").update(data).digest("hex").slice(0, 16)}.${ext}`;
    if (!(await storage.stat(key))) await storage.put(key, Readable.from(data));
    return `/media/${key}`;
  };
  const image = async (s: SlotReport): Promise<KitImage> => {
    const spec = SLOTS.find((x) => x.id === s.id)!;
    const w = spec.crop ? s.box!.w : spec.size.w;
    const h = spec.crop ? s.box!.h : spec.size.h;
    const out: KitImage = { w, h, ...(s.thumbhash ? { thumbhash: s.thumbhash } : {}) };
    const svg = s.files!.find((f) => f.endsWith(".svg"));
    if (svg) out.svg = await put(svg);
    else {
      out.avif = await put(s.files!.find((f) => f.endsWith(".avif"))!);
      out.webp = await put(s.files!.find((f) => f.endsWith(".webp"))!);
    }
    return out;
  };
  const get = (id: string) => changed.find((s) => s.id === id);

  const prev: KitAssets = source.assets.kit ?? {};
  const kit: KitAssets = { ...prev };
  const plans: (KitPlan | null)[] = [0, 1, 2, 3, 4].map((i) => prev.plans?.[i] ?? null);
  for (let n = 1; n <= 5; n++) {
    const s = get(`hero/plan-${n}`);
    if (s) plans[n - 1] = { ...(await image(s)), x: s.box!.x, y: s.box!.y };
  }
  if (plans.some(Boolean)) kit.plans = plans;
  const sig = get("signature");
  if (sig) kit.signature = await image(sig);
  const paper = get("papier");
  if (paper) kit.paper = { image: await image(paper), overHero: prev.paper?.overHero ?? PAPER_OVER_HERO_DEFAULT };
  const frame = get("cadre");
  if (frame) kit.frame = { image: await image(frame), slice: [48, 48, 48, 48] };
  const stroke = get("trait");
  if (stroke) kit.stroke = await image(stroke);
  const icons = { ...(prev.icons ?? {}) };
  for (const [id, key] of [
    ["icones/fleche-gauche", "arrowLeft"],
    ["icones/fleche-droite", "arrowRight"],
    ["icones/fermer", "close"],
    ["icones/lecture", "play"],
  ] as const) {
    const s = get(id);
    if (s) icons[key] = await image(s);
  }
  // Paire de flèches : miroir de la flèche redessinée (retournement, sans re-tracer).
  const pair = opts.mirror ? arrowMirror(report) : null;
  if (pair) {
    const src = await image(pair.from);
    const flipped: KitImage = { w: src.w, h: src.h };
    const store = async (data: Buffer, ext: string) => {
      const key = `kit/${createHash("sha256").update(data).digest("hex").slice(0, 16)}.${ext}`;
      if (!(await storage.stat(key))) await storage.put(key, Readable.from(data));
      return `/media/${key}`;
    };
    if (src.svg) flipped.svg = await store(Buffer.from(mirrorSvg(await readFile(path.join(/* turbopackIgnore: true */ outDir, path.basename(pair.from.files!.find((f) => f.endsWith(".svg"))!)), "utf8"))), "svg");
    else {
      flipped.avif = await store(await mirrorBitmap(await readFile(path.join(/* turbopackIgnore: true */ outDir, path.basename(pair.from.files!.find((f) => f.endsWith(".avif"))!))), "avif"), "avif");
      flipped.webp = await store(await mirrorBitmap(await readFile(path.join(/* turbopackIgnore: true */ outDir, path.basename(pair.from.files!.find((f) => f.endsWith(".webp"))!))), "webp"), "webp");
    }
    icons[pair.to === "icones/fleche-gauche" ? "arrowLeft" : "arrowRight"] = flipped;
  }
  if (Object.keys(icons).length) kit.icons = icons;
  const tape = get("accessoires/scotch");
  if (tape) kit.tape = await image(tape);

  // Copie brouillon : nouvel identifiant, jamais active.
  const db = getDb();
  const baseName = source.name.replace(/ \((?:copie|kit)(?: \d+)?\)$/, "");
  const base = `${slugify(baseName) || "theme"}-kit`;
  let id = base;
  let n = 1;
  while (db.select().from(schema.themes).where(eq(schema.themes.id, id)).get()) id = `${base}-${++n}`;
  const name = n === 1 ? `${baseName} (kit)` : `${baseName} (kit ${n})`;
  const parsed = ThemeSchema.safeParse({
    ...source,
    id,
    name,
    preset: false,
    tokens: opts.palette && report.palette ? { ...source.tokens, color: withPalette(source.tokens.color, report) } : source.tokens,
    // Scotch redessiné : visible avec la variante « scotch » des planches.
    variants: tape ? { ...source.variants, strip: "taped" } : source.variants,
    assets: { ...source.assets, kit },
  });
  if (!parsed.success) {
    console.error("[kit] application refusée", parsed.error.issues.slice(0, 3));
    return fail("Les éléments importés ne forment pas un thème valide. Renvoie le kit ; si ça recommence, signale-le.");
  }
  db.insert(schema.themes).values({ id, name, preset: false, data: JSON.stringify(parsed.data) }).run();
  await writeImportMeta({ ...meta, appliedThemeId: id });
  return done({ id });
}
