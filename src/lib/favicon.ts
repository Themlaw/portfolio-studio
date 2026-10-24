/**
 * Icône de l'onglet (lots 52 et 83) : le rendu des fichiers. Le PLAN (d'où vient l'icône, couleurs, empreinte) est dans
 * favicon-plan.ts ; ici, sharp fabrique :
 *   16 / 32 / 48 / 180 / 192 / 512 px en PNG, `maskable-512.png` (Android : le dessin tient dans les 60 % du milieu),
 *   `favicon.ico` (16, 32, 48) et, pour le monogramme, `icon.svg` avec sa variante sombre (prefers-color-scheme).
 *
 * Deux circuits :
 *  - une IMAGE de la médiathèque (recadrée en carré) est déclinée à l'enregistrement du réglage (buildFavicons) et rangée sous
 *    `icons/<média>-<empreinte>/` ;
 *  - un monogramme, un logo ou le calque « Icône » du kit sont produits à la demande, une fois par empreinte, puis gardés sous
 *    `icons-auto/<empreinte>/` (le thème en ligne change : nouvelle empreinte, nouveaux fichiers).
 * Exception assumée à « pas de sharp dans une requête » : sources minuscules (≤ 1 Mpx), un seul thread, une fois par empreinte.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";

import { eq } from "drizzle-orm";
import sharp from "sharp";

import { KIT_FONTS } from "@/lib/kit/fonts";
import type { FontId } from "@/themes/schema";

import { getDb, schema } from "./db";
import { rectPixels, toUnits, type Rect } from "./images/crop";
import { parseVariants } from "./images/variants";
import type { IconPlan } from "./favicon-plan";
import { ICON_SIZES, MASKABLE_FILE } from "./seo-schema";
import { getStorage } from "./storage";

sharp.concurrency(1);
sharp.cache(false);

const S = 512;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const transparent = { r: 0, g: 0, b: 0, alpha: 0 } as const;
const blank = () => sharp({ create: { width: S, height: S, channels: 4, background: transparent } });

export type IconSet = Record<string, Buffer>;
export type FaviconResult = { ok: true; dir: string } | { ok: false; message: string };

/* ---- Formes et lettres --------------------------------------------------------------------------------------------------- */

/** Fond du monogramme : rond ou carré arrondi ; `null` pour « sans fond ». */
function shapeSvg(shape: string, bg: string): string | null {
  if (shape === "round") return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><circle cx="${S / 2}" cy="${S / 2}" r="${S / 2}" fill="${bg}"/></svg>`;
  if (shape === "squircle") return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="${S}" height="${S}" rx="${Math.round(S * 0.22)}" fill="${bg}"/></svg>`;
  return null;
}

/** Cadre où tiennent les lettres (fractions de l'icône) selon la forme. */
const LETTER_BOX = { round: { w: 0.6, h: 0.44 }, squircle: { w: 0.68, h: 0.5 }, none: { w: 0.92, h: 0.72 } } as const;
/** Icône « maskable » : tout le dessin dans les 60 % du milieu (marge de sécurité de 20 % de chaque côté). */
const SAFE = 0.6;

const fontFile = (id: FontId) => path.join(/* turbopackIgnore: true */ process.cwd(), "public", "kit", "fonts", KIT_FONTS[id].file);

/** Les lettres, d'une couleur, centrées sur leur encre dans un carré transparent de 512 px, tenant dans `box` (fractions). */
async function lettersRaster(letters: string, fontId: FontId, ink: string, box: { w: number; h: number }): Promise<Buffer> {
  const font = KIT_FONTS[fontId];
  const render = async (size: number) =>
    sharp({ text: { text: `<span foreground="${ink}">${esc(letters)}</span>`, fontfile: fontFile(fontId), font: `${font.pango} ${size}`, rgba: true, dpi: 72 } })
      .trim({ threshold: 1 })
      .png()
      .toBuffer({ resolveWithObject: true });
  let size = 320;
  let { data, info } = await render(size);
  const fit = Math.min((box.w * S) / info.width, (box.h * S) / info.height);
  if (Math.abs(fit - 1) > 0.02) {
    size = Math.max(8, Math.floor(size * fit));
    ({ data, info } = await render(size));
  }
  return blank()
    .composite([{ input: data, left: Math.round((S - info.width) / 2), top: Math.round((S - info.height) / 2) }])
    .png()
    .toBuffer();
}

type Colors = { bg: string; ink: string };

/** Monogramme : forme + lettres (512 px, transparent hors de la forme). */
async function monoMaster(plan: IconPlan, colors: Colors): Promise<Buffer> {
  const letters = await lettersRaster(plan.letters, plan.fontId, colors.ink, LETTER_BOX[plan.shape]);
  const svg = shapeSvg(plan.shape, colors.bg);
  const base = svg ? sharp(Buffer.from(svg)) : blank();
  return base.composite([{ input: letters }]).png().toBuffer();
}

/** Monogramme « maskable » : fond plein jusqu'aux bords, lettres dans la zone de sécurité. */
async function monoMaskable(plan: IconPlan, colors: Colors): Promise<Buffer> {
  const bg = plan.shape === "none" ? plan.backgroundColor : colors.bg;
  const letters = await lettersRaster(plan.letters, plan.fontId, colors.ink, { w: SAFE * 0.8, h: SAFE * 0.6 });
  return sharp({ create: { width: S, height: S, channels: 4, background: bg } }).composite([{ input: letters }]).png().toBuffer();
}

/* ---- Images : logo, calque du kit, image choisie ------------------------------------------------------------------------ */

async function readKey(key: string): Promise<Buffer | null> {
  const storage = getStorage();
  if (!(await storage.stat(key))) return null;
  const chunks: Buffer[] = [];
  for await (const c of await storage.getStream(key)) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

/** Image du kit (logo ou calque « Icône ») : sa version WebP (ou SVG), lue dans le stockage. */
async function kitBytes(plan: IconPlan): Promise<Buffer | null> {
  const k = plan.kit;
  const url = k?.webp ?? k?.svg ?? k?.avif;
  const m = url ? /^\/media\/(kit\/[0-9a-f]{16}\.(?:webp|svg|avif))$/.exec(url) : null;
  return m ? readKey(m[1]) : null;
}

/** Recolore une forme (son alpha) d'une seule couleur. */
const tint = (shape: Buffer, w: number, h: number, hex: string) => sharp({ create: { width: w, height: h, channels: 4, background: hex } }).composite([{ input: shape, blend: "dest-in" }]).png().toBuffer();

/** Logo du thème posé sur le fond (rond, carré arrondi ou rien), rogné au plus près et centré. */
async function logoMaster(plan: IconPlan, colors: Colors, bytes: Buffer, forMask = false): Promise<Buffer> {
  const box = forMask ? { w: SAFE * 0.8, h: SAFE * 0.8 } : LETTER_BOX[plan.shape];
  const side = Math.min(box.w, box.h * 1.3) * S;
  const logo = await sharp(bytes, { density: 300, limitInputPixels: 24_000_000 })
    .ensureAlpha()
    .trim({ threshold: 1 })
    .resize(Math.round(side), Math.round(side), { fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = logo.info;
  const input = plan.tinted ? await tint(logo.data, w, h, colors.ink) : logo.data;
  const svg = forMask ? null : shapeSvg(plan.shape, colors.bg);
  const base = forMask ? sharp({ create: { width: S, height: S, channels: 4, background: colors.bg } }) : svg ? sharp(Buffer.from(svg)) : blank();
  return base.composite([{ input, left: Math.round((S - w) / 2), top: Math.round((S - h) / 2) }]).png().toBuffer();
}

/** Calque « Icône » du kit ou image recadrée : pleine case. */
const coverMaster = (bytes: Buffer) => sharp(bytes, { density: 300, limitInputPixels: 24_000_000 }).rotate().ensureAlpha().resize(S, S, { fit: "cover", position: "centre" }).png().toBuffer();

/** Couleur moyenne d'une image (aplatie sur blanc) : fond de l'icône « maskable ». */
async function averageHex(master: Buffer): Promise<string> {
  const { data } = await sharp(master).flatten({ background: "#ffffff" }).resize(1, 1, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  return `#${[data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Image pleine case → « maskable » : fond de sa couleur moyenne, image réduite dans la zone de sécurité. */
async function insetMaskable(master: Buffer): Promise<Buffer> {
  const inner = Math.round(S * SAFE);
  const small = await sharp(master).resize(inner, inner, { fit: "fill" }).png().toBuffer();
  return sharp({ create: { width: S, height: S, channels: 4, background: await averageHex(master) } }).composite([{ input: small, left: Math.round((S - inner) / 2), top: Math.round((S - inner) / 2) }]).png().toBuffer();
}

/* ---- Fichiers de l'ensemble ---------------------------------------------------------------------------------------------- */

/** ICO (16, 32, 48) : des PNG dans le conteneur, lus par tous les navigateurs récents. */
export function icoOf(pngs: { size: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = head.length + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const e = i * 16;
    dir[e] = size >= 256 ? 0 : size;
    dir[e + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, dir, ...pngs.map((p) => p.data)]);
}

const resized = (master: Buffer, size: number) => sharp(master).resize(size, size, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();

/** Tous les fichiers d'une icône à partir de son dessin de 512 px et de sa version « maskable ». */
export async function packSet(master: Buffer, maskable: Buffer, svg?: string): Promise<IconSet> {
  const set: IconSet = {};
  for (const size of ICON_SIZES) set[`${size}.png`] = size === S ? await sharp(master).png({ compressionLevel: 9 }).toBuffer() : await resized(master, size);
  set[MASKABLE_FILE] = await sharp(maskable).png({ compressionLevel: 9 }).toBuffer();
  set["favicon.ico"] = icoOf([16, 32, 48].map((size) => ({ size, data: set[`${size}.png`] })));
  if (svg) set["icon.svg"] = Buffer.from(svg);
  return set;
}

/** SVG du monogramme : forme + lettres (masque), variante sombre par `prefers-color-scheme`. */
async function monoSvg(plan: IconPlan): Promise<string> {
  const lettersWhite = await lettersRaster(plan.letters, plan.fontId, "#ffffff", LETTER_BOX[plan.shape]);
  const mask = await sharp(lettersWhite).flatten({ background: "#000000" }).greyscale().png({ compressionLevel: 9 }).toBuffer();
  const shape =
    plan.shape === "round"
      ? `<circle class="b" cx="${S / 2}" cy="${S / 2}" r="${S / 2}"/>`
      : plan.shape === "squircle"
        ? `<rect class="b" width="${S}" height="${S}" rx="${Math.round(S * 0.22)}"/>`
        : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">` +
    `<style>.b{fill:${plan.light.bg}}.l{fill:${plan.light.ink}}@media (prefers-color-scheme:dark){.b{fill:${plan.dark.bg}}.l{fill:${plan.dark.ink}}}</style>` +
    `<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}"><image width="${S}" height="${S}" xlink:href="data:image/png;base64,${mask.toString("base64")}"/></mask></defs>` +
    `${shape}<rect class="l" width="${S}" height="${S}" mask="url(#m)"/></svg>`
  );
}

/** Dessin de 512 px de l'icône (et sa version maskable) d'un plan qui n'est pas une image choisie ; null : source illisible. */
async function masterOf(plan: IconPlan, variant: "light" | "dark" = "light"): Promise<{ master: Buffer; maskable: Buffer } | null> {
  const colors = variant === "dark" ? plan.dark : plan.light;
  if (plan.source === "mono") return { master: await monoMaster(plan, colors), maskable: await monoMaskable(plan, colors) };
  const bytes = await kitBytes(plan);
  if (!bytes) return null;
  try {
    if (plan.source === "kit") {
      const master = await coverMaster(bytes);
      return { master, maskable: await insetMaskable(master) };
    }
    return { master: await logoMaster(plan, colors, bytes), maskable: await logoMaster(plan, colors, bytes, true) };
  } catch (error) {
    console.error("[favicon] image du kit illisible, monogramme à la place", error);
    return null;
  }
}

/** Plan de repli quand l'image du kit ne se lit pas : le monogramme. */
const asMono = (plan: IconPlan): IconPlan => ({ ...plan, source: "mono", kit: null, tinted: true });

/* ---- Lecture d'un fichier de l'icône (route /site-icon, /favicon.ico) -------------------------------------------------- */

export const ICON_FILES: readonly string[] = [...ICON_SIZES.map((s) => `${s}.png`), MASKABLE_FILE, "favicon.ico", "icon.svg"];
const MAX_KEPT = 4;
const pending = new Map<string, Promise<IconSet>>();

async function putAll(prefix: string, set: IconSet) {
  const storage = getStorage();
  for (const [file, data] of Object.entries(set)) await storage.put(`${prefix}/${file}`, Readable.from([data]));
}

/** Tous les fichiers d'un plan qui n'est pas une image choisie (monogramme, logo, calque du kit) ; l'image du kit illisible laisse le monogramme. */
export async function renderSet(plan: IconPlan): Promise<IconSet> {
  let use = plan;
  let made = await masterOf(use);
  if (!made) {
    use = asMono(plan);
    made = await masterOf(use);
  }
  return packSet(made!.master, made!.maskable, use.source === "mono" ? await monoSvg(use) : undefined);
}

/** Ensemble d'un plan « auto » : gardé sous icons-auto/<empreinte>/, fabriqué une seule fois même si dix requêtes arrivent ensemble. */
function autoSet(plan: IconPlan): Promise<IconSet> {
  let p = pending.get(plan.fp);
  if (!p) {
    p = (async () => {
      const set = await renderSet(plan);
      await putAll(`icons-auto/${plan.fp}`, set);
      return set;
    })().finally(() => {
      // Une fois rangé dans le stockage, le prochain accès le relit : on ne garde en mémoire que les dernières empreintes.
      setTimeout(() => pending.delete(plan.fp), 60_000).unref();
      if (pending.size > MAX_KEPT) pending.delete(pending.keys().next().value as string);
    });
    pending.set(plan.fp, p);
  }
  return p;
}

/** Icône d'une image d'avant le lot 83 : il manque le 16 px, la maskable et l'ICO. Reconstruits depuis son 512 px, une fois. */
async function completeImageDir(dir: string): Promise<void> {
  const master = await readKey(`${dir}/512.png`);
  if (!master) return;
  const set = await packSet(master, await insetMaskable(master));
  const storage = getStorage();
  for (const [file, data] of Object.entries(set)) if (!(await storage.stat(`${dir}/${file}`))) await storage.put(`${dir}/${file}`, Readable.from([data]));
}

/** Octets d'un fichier de l'icône du plan, ou null (fichier inconnu, icon.svg d'une icône qui n'est pas un monogramme). */
export async function readIcon(plan: IconPlan, file: string): Promise<Buffer | null> {
  if (!ICON_FILES.includes(file)) return null;
  if (file === "icon.svg" && plan.source !== "mono") return null;
  if (plan.source === "image" && plan.dir) {
    const key = `${plan.dir}/${file}`;
    let data = await readKey(key);
    if (!data) {
      await completeImageDir(plan.dir);
      data = await readKey(key);
    }
    return data;
  }
  const kept = await readKey(`icons-auto/${plan.fp}/${file}`);
  if (kept) return kept;
  return (await autoSet(plan))[file] ?? null;
}

/* ---- Image choisie : déclinée à l'enregistrement ---------------------------------------------------------------------- */

const cropTag = (crop: Rect | null) => {
  if (!crop) return "";
  const u = toUnits(crop);
  return `-c${createHash("sha1").update(`${u.x},${u.y},${u.w},${u.h}`).digest("hex").slice(0, 6)}`;
};

/** Rend une image de la médiathèque (recadrée en carré si `crop`) : dessin de 512 px. Null : image inutilisable. */
async function imageMaster(mediaId: number, crop: Rect | null): Promise<{ master: Buffer; dir: string } | { message: string }> {
  const row = getDb().select().from(schema.media).where(eq(schema.media.id, mediaId)).get();
  if (!row || row.deletedAt || row.status !== "ready" || row.kind !== "image") return { message: "Choisis une image de la médiathèque (pas une vidéo ni un PDF)." };
  const storage = getStorage();
  const variants = parseVariants(row.variants);
  const webp = variants?.files.filter((f) => f.format === "webp").sort((a, b) => a.w - b.w) ?? [];
  // Avec un recadrage, la source est assez grande pour qu'une petite partie de l'image reste nette.
  const wanted = crop ? 1600 : 512;
  const source = webp.find((f) => Math.max(f.w, f.h) >= wanted) ?? webp.at(-1);
  const key = source?.key ?? (row.mime === "image/svg+xml" ? row.key : null);
  const file = key ? await storage.localPath(key) : null;
  if (!file) return { message: "Cette image n'est pas utilisable comme icône : choisis-en une autre." };
  const dir = `icons/${row.id}-${(row.sha256 ?? "seed").slice(0, 8)}${cropTag(crop)}`;
  const opts = { limitInputPixels: 24_000_000, density: row.mime === "image/svg+xml" ? 600 : undefined };
  let input = sharp(file, opts).rotate();
  if (crop) {
    const oriented = await input.png().toBuffer({ resolveWithObject: true });
    const px = rectPixels(toUnits(crop), oriented.info.width, oriented.info.height);
    input = sharp(oriented.data).extract({ left: px.left, top: px.top, width: px.w, height: px.h });
  }
  return { master: await input.ensureAlpha().resize(S, S, { fit: "cover", position: "centre" }).png().toBuffer(), dir };
}

/** Décline une image en icône (tous les fichiers), rangée sous icons/<média>-<empreinte>/. */
export async function buildFavicons(mediaId: number, crop: Rect | null = null): Promise<FaviconResult> {
  try {
    const made = await imageMaster(mediaId, crop);
    if ("message" in made) return { ok: false, message: made.message };
    await putAll(made.dir, await packSet(made.master, await insetMaskable(made.master)));
    return { ok: true, dir: made.dir };
  } catch (error) {
    console.error(`[favicon] média ${mediaId} : déclinaison impossible`, error);
    return { ok: false, message: "Cette image n'a pas pu être transformée en icône : essaie-en une autre." };
  }
}

/* ---- Aperçu et avertissements -------------------------------------------------------------------------------------------- */

/** Écart moyen entre le rendu 16 px et sa version floutée, en part de l'écart de clarté du rendu (0 : aplat ; 0,1 : un monogramme ; 0,3 et plus : une photo ou un damier fin). */
export async function measureDetail(master: Buffer): Promise<{ detail: number; range: number }> {
  // Le détail se mesure sur gris moyen (ni le blanc ni le noir n'ajoutent un bord à une icône sans fond), rapporté à l'écart de clarté
  // (une icône très contrastée a des bords plus marqués sans être plus fine) ; l'écart de clarté : le meilleur de l'onglet clair et sombre.
  const grey = (bg: string) => sharp(master).flatten({ background: bg }).resize(16, 16, { kernel: "lanczos3" }).greyscale().png().toBuffer();
  const rangeOf = async (bg: string) => {
    const a = await sharp(await grey(bg)).raw().toBuffer();
    return Math.max(...a) - Math.min(...a);
  };
  const small = await grey("#808080");
  const [a, b] = await Promise.all([sharp(small).raw().toBuffer(), sharp(small).blur(1.2).raw().toBuffer()]);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  const range = Math.max(await rangeOf("#ffffff"), await rangeOf("#202124"));
  return { detail: sum / a.length / Math.max(range, 1), range };
}

/** Au-delà, l'icône est une bouillie à 16 px. */
export const DETAIL_LIMIT = 0.2;
/** En deçà, on ne voit presque rien (image terne ou uniforme). */
export const RANGE_MIN = 40;

export function warningsOf(m: { detail: number; range: number }): string[] {
  const out: string[] = [];
  if (m.detail > DETAIL_LIMIT) out.push("Cette image est trop détaillée pour une si petite icône : à 16 pixels, on ne verra qu'une tache. Une forme simple et grosse, ou un monogramme, se lit mieux.");
  if (m.range < RANGE_MIN) out.push("Cette icône manque de contraste : à 16 pixels, elle se fond dans l'onglet. Prends des couleurs plus éloignées l'une de l'autre.");
  return out;
}

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;

export type FaviconPreview = {
  source: IconPlan["source"];
  fallback: IconPlan["fallback"];
  /** Clair : 16 px (taille réelle), 48 px (agrandi), 180 px (écran d'accueil). Sombre : 16 et 48 px. */
  light: { s16: string; s48: string; s180: string };
  dark: { s16: string; s48: string };
  warnings: string[];
};

/** Aperçu d'un plan (réglage pas encore enregistré, thème en ligne) : images en data: URL, avertissements. */
export async function previewIcon(plan: IconPlan, imageDir?: string | null): Promise<FaviconPreview | { message: string }> {
  let use = plan;
  let light: Buffer | null = null;
  let dark: Buffer | null = null;
  if (plan.source === "image") {
    const dir = imageDir ?? plan.dir;
    light = dir ? await readKey(`${dir}/512.png`) : null;
    dark = light;
    if (!light) return { message: "Choisis d'abord une image de la médiathèque." };
  } else {
    let made = await masterOf(plan);
    if (!made) {
      use = asMono(plan);
      made = (await masterOf(use))!;
    }
    light = made.master;
    dark = use.source === "mono" || use.source === "logo" ? (await masterOf(use, "dark"))!.master : light;
  }
  const lightBuf = light!;
  const darkBuf = dark!;
  const px = (m: Buffer, s: number) => resized(m, s).then(dataUrl);
  return {
    source: use.source,
    fallback: plan.fallback,
    light: { s16: await px(lightBuf, 16), s48: await px(lightBuf, 48), s180: await px(lightBuf, 180) },
    dark: { s16: await px(darkBuf, 16), s48: await px(darkBuf, 48) },
    warnings: warningsOf(await measureDetail(lightBuf)),
  };
}
