/**
 * Choix du format d'un calque du kit (prototype, phase 6b) : vectorisation
 * (vtracer via @neplex/vectorizer, puis SVGO avec removeScripts), bitmap
 * (AVIF + WebP par sharp), détection des textures, raccord d'une tuile,
 * ThumbHash.
 */
import { ColorMode, Hierarchical, PathSimplifyMode, vectorizeRaw, type Config } from "@neplex/vectorizer";
import sharp from "sharp";
import { optimize } from "svgo";
import { rgbaToThumbHash } from "thumbhash";

export type Rgba = { width: number; height: number; data: Buffer };

/** SVG retenu s'il pèse au plus 1,5 × l'AVIF et compte au plus 500 chemins. */
export const SVG_MAX_RATIO = 1.5;
export const SVG_MAX_PATHS = 500;
/** Plus grand côté vectorisé (au-delà : réduit avant tracé, le SVG reste net). */
export const VECTOR_MAX_SIDE = 1920;

const COLOR: Config = {
  colorMode: ColorMode.Color,
  hierarchical: Hierarchical.Stacked,
  filterSpeckle: 8,
  colorPrecision: 6,
  layerDifference: 24,
  mode: PathSimplifyMode.Spline,
  cornerThreshold: 60,
  lengthThreshold: 4,
  maxIterations: 10,
  spliceThreshold: 45,
  pathPrecision: 1,
};
const BINARY: Config = { ...COLOR, colorMode: ColorMode.Binary, filterSpeckle: 4 };

/**
 * Aplat ou texture ? Couleurs quantifiées (5 bits) des pixels opaques : si
 * les 8 plus fréquentes couvrent au moins 90 % des pixels, c'est un aplat
 * (le reste : bords antialiasés) ; sinon texture, grain ou dégradé.
 */
export function textureStats(img: Rgba): { coverage8: number; coverage1: number; dominant: string; distinct: number; textured: boolean } {
  const counts = new Map<number, number>();
  let opaque = 0;
  const step = Math.max(1, Math.floor((img.width * img.height) / 400_000)); // échantillonnage
  for (let p = 0; p < img.width * img.height; p += step) {
    const i = p * 4;
    if (img.data[i + 3] < 200) continue;
    opaque++;
    const key = ((img.data[i] >> 3) << 10) | ((img.data[i + 1] >> 3) << 5) | (img.data[i + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 8).reduce((a, [, n]) => a + n, 0);
  const coverage8 = opaque ? top / opaque : 1;
  const coverage1 = opaque && ranked.length ? ranked[0][1] / opaque : 1;
  // Couleur dominante : moyenne exacte des pixels de la classe la plus fréquente.
  let dominant = "#000000";
  if (ranked.length) {
    const key = ranked[0][0];
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let p = 0; p < img.width * img.height; p += step) {
      const i = p * 4;
      if (img.data[i + 3] < 200) continue;
      if ((((img.data[i] >> 3) << 10) | ((img.data[i + 1] >> 3) << 5) | (img.data[i + 2] >> 3)) !== key) continue;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n++;
    }
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
    dominant = `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  return { coverage8, coverage1, dominant, distinct: counts.size, textured: coverage8 < 0.9 };
}

/** Une seule couleur (aux bords antialiasés près) ? Écart moyen à la couleur dominante. */
export function monoStats(img: Rgba): { mono: boolean; spread: number } {
  let n = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 200) continue;
    r += img.data[i];
    g += img.data[i + 1];
    b += img.data[i + 2];
    n++;
  }
  if (!n) return { mono: true, spread: 0 };
  r /= n;
  g /= n;
  b /= n;
  let d = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 200) continue;
    d += Math.abs(img.data[i] - r) + Math.abs(img.data[i + 1] - g) + Math.abs(img.data[i + 2] - b);
  }
  const spread = d / n / 3;
  return { mono: spread < 18, spread };
}

/** Boîte des pixels non transparents (alpha > 8), ou null si le calque est vide. */
export function alphaBox(img: Rgba): { x: number; y: number; w: number; h: number } | null {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function crop(img: Rgba, box: { x: number; y: number; w: number; h: number }): Rgba {
  const out = Buffer.alloc(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) img.data.copy(out, y * box.w * 4, ((box.y + y) * img.width + box.x) * 4, ((box.y + y) * img.width + box.x + box.w) * 4);
  return { width: box.w, height: box.h, data: out };
}

/**
 * Part de pixels semi-transparents parmi les pixels visibles : vtracer ne
 * garde pas une transparence partielle (scotch, voile…) → bitmap.
 */
export function translucentShare(img: Rgba): number {
  let visible = 0;
  let partial = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    const a = img.data[i];
    if (a <= 8) continue;
    visible++;
    if (a < 230) partial++;
  }
  return visible ? partial / visible : 0;
}

/** Part de pixels opaques (alpha ≥ 250). */
export function opaqueShare(img: Rgba): number {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] >= 250) n++;
  return n / (img.width * img.height);
}

const raw = (img: Rgba) => sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } });

/**
 * `fine` : dessins aux traits ou grains fins (logo, papier, trait), réduits ensuite à l'écran :
 * qualité plus haute et sous-échantillonnage des couleurs désactivé (sinon les traits fins
 * de couleur bavent). Quelques dizaines de Ko de plus, pour des éléments peu nombreux.
 */
export async function encodeBitmap(img: Rgba, fine = false): Promise<{ avif: Buffer; webp: Buffer }> {
  const avif = await raw(img).avif(fine ? { quality: 78, effort: 4, chromaSubsampling: "4:4:4" } : { quality: 50, effort: 4 }).toBuffer();
  const webp = await raw(img).webp(fine ? { quality: 92, alphaQuality: 100, effort: 4, smartSubsample: false } : { quality: 78, alphaQuality: 90, effort: 4 }).toBuffer();
  return { avif, webp };
}

const SVGO_PLUGINS = [
  // SVGO 4 : preset-default garde déjà la viewBox.
  "preset-default",
  "removeScripts",
  "removeDimensions",
] as const;

/**
 * Vectorise un calque (couleur, ou forme binaire pour un masque), puis SVGO.
 * `mask` : forme seule (noir), teintée ensuite par le thème (mask-image).
 */
export type VectorTuning = Partial<Config>;

export async function vectorizeLayer(
  img: Rgba,
  mode: "color" | "mask" | "flat",
  fill?: string,
  tuning?: Partial<Config>,
  maxSide = VECTOR_MAX_SIDE,
): Promise<{ svg: string; paths: number; scale: number }> {
  let src = img;
  let scale = 1;
  const side = Math.max(img.width, img.height);
  if (side > maxSide) {
    scale = maxSide / side;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    src = { width: w, height: h, data: await raw(img).resize(w, h, { kernel: "lanczos3" }).raw().toBuffer() };
  }
  let input = src.data;
  if (mode === "color") {
    // Bords antialiasés : alpha binarisé, sinon vtracer trace des liserés pâles.
    input = Buffer.from(src.data);
    for (let i = 3; i < input.length; i += 4) input[i] = input[i] > 127 ? 255 : 0;
  }
  if (mode === "mask" || mode === "flat") {
    // Binaire : forme (alpha > 50 %) en noir sur blanc, opaque.
    input = Buffer.alloc(src.data.length);
    for (let i = 0; i < src.data.length; i += 4) {
      const on = src.data[i + 3] > 127;
      input[i] = input[i + 1] = input[i + 2] = on ? 0 : 255;
      input[i + 3] = 255;
    }
  }
  let svg = await vectorizeRaw(input, { width: src.width, height: src.height }, { ...(mode === "color" ? COLOR : BINARY), ...tuning });
  if (mode !== "color") svg = svg.replace(/fill="#(?:fff|ffffff)"/gi, 'fill="none"');
  // Aplat d'une couleur : la forme (tracée sur l'alpha) prend la couleur dominante.
  if (mode === "flat" && fill) svg = svg.replace(/fill="#0{3}(?:0{3})?"/gi, `fill="${fill}"`);
  // Taille d'origine : le tracé a pu être fait sur une image réduite.
  svg = svg.replace(/<svg([^>]*?)width="(\d+)"([^>]*?)height="(\d+)"/, (_m, a, w, b, h) => `<svg${a}viewBox="0 0 ${w} ${h}"${b}`);
  const optimized = optimize(svg, { multipass: true, floatPrecision: 1, plugins: SVGO_PLUGINS as unknown as never[] }).data;
  const paths = (optimized.match(/<path\b/g) ?? []).length;
  return { svg: optimized, paths, scale };
}

/**
 * Fidélité du contour d'un SVG à son calque d'origine, à la résolution réelle :
 * masques alpha (> 50 %) de l'original et du SVG rendu.
 *  - iou : intersection / union des deux masques ;
 *  - deviation : pixels différents / longueur du contour d'origine, soit
 *    l'écart moyen du bord en px (0 = identique ; un tremblement « fait main »
 *    de ± 2 px lissé donne ~1).
 */
export async function contourFidelity(original: Rgba, rendered: string | Buffer): Promise<{ iou: number; deviation: number }> {
  const { data } = await sharp(typeof rendered === "string" ? Buffer.from(rendered) : rendered, { density: 72 })
    .resize(original.width, original.height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = original.width;
  const h = original.height;
  const on = (buf: Buffer, x: number, y: number) => buf[(y * w + x) * 4 + 3] > 127;
  let inter = 0;
  let union = 0;
  let diff = 0;
  let edge = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = on(original.data, x, y);
      const b = on(data, x, y);
      if (a && b) inter++;
      if (a || b) union++;
      if (a !== b) diff++;
      if (a && ((x > 0 && !on(original.data, x - 1, y)) || (x < w - 1 && !on(original.data, x + 1, y)) || (y > 0 && !on(original.data, x, y - 1)) || (y < h - 1 && !on(original.data, x, y + 1)))) edge++;
    }
  }
  return { iou: union ? inter / union : 1, deviation: diff / Math.max(edge, 1) };
}

/**
 * Raccord d'une tuile : écart moyen entre bords opposés (gauche/droite,
 * haut/bas), rapporté à l'écart moyen entre deux colonnes voisines intérieures.
 * ≈ 1 : la couture ne se voit pas ; ≫ 1 : elle se voit.
 */
export function seamStats(img: Rgba): { edge: number; interior: number; ratio: number } {
  const px = (x: number, y: number) => (y * img.width + x) * 4;
  const diff = (a: number, b: number) => (Math.abs(img.data[a] - img.data[b]) + Math.abs(img.data[a + 1] - img.data[b + 1]) + Math.abs(img.data[a + 2] - img.data[b + 2])) / 3;
  let edge = 0;
  let interior = 0;
  for (let y = 0; y < img.height; y++) {
    edge += diff(px(0, y), px(img.width - 1, y));
    interior += diff(px(img.width >> 1, y), px((img.width >> 1) + 1, y));
  }
  for (let x = 0; x < img.width; x++) {
    edge += diff(px(x, 0), px(x, img.height - 1));
    interior += diff(px(x, img.height >> 1), px(x, (img.height >> 1) + 1));
  }
  edge /= img.width + img.height;
  interior /= img.width + img.height;
  return { edge, interior, ratio: edge / Math.max(interior, 0.5) };
}

/**
 * SVG étirable : sans `preserveAspectRatio="none"`, un SVG à viewBox garde ses
 * proportions (xMidYMid meet) même sous `mask-size: 100% 100%` ; un trait de
 * 1168 × 42 tenu dans 920 × 8 px n'y occupait que 220 px au centre.
 */
export function stretchableSvg(svg: string): string {
  return /preserveAspectRatio=/.test(svg) ? svg : svg.replace(/<svg\b/, '<svg preserveAspectRatio="none"');
}

/** Seuils de l'indicateur de répétition d'une tuile (voir tileRepeatStats). */
export const TILE_REPEAT = { rho: 0.5, contrast: 1.5 };

/**
 * Répétition visible d'une tuile : un grain se répète sans se voir, un motif à
 * l'échelle de la tuile (rayures, damier, tache) dessine la grille.
 * Luminance ramenée à ≤ 128 px (moyenne par zone : le grain fin s'annule, le
 * motif reste), puis autocorrélation circulaire normalisée à des fractions de
 * la période (1/2, 1/3, 1/4 en x, y et diagonale) : ~0 pour un grain, ~±1 pour
 * un motif périodique. `contrast` : écart type (niveaux) de cette luminance
 * réduite ; un motif imperceptible ne compte pas.
 */
export function tileRepeatStats(img: Rgba): { rho: number; contrast: number } {
  const f = Math.max(1, Math.ceil(Math.max(img.width, img.height) / 128));
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const lum = new Float64Array(w * h);
  for (let y = 0; y < h * f; y++) {
    for (let x = 0; x < w * f; x++) {
      const i = (y * img.width + x) * 4;
      lum[Math.floor(y / f) * w + Math.floor(x / f)] += 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
    }
  }
  let mean = 0;
  for (let i = 0; i < lum.length; i++) mean += (lum[i] /= f * f);
  mean /= lum.length;
  let variance = 0;
  for (let i = 0; i < lum.length; i++) variance += (lum[i] -= mean) ** 2;
  variance /= lum.length;
  if (variance < 1e-6) return { rho: 0, contrast: 0 };
  let rho = 0;
  for (const d of [2, 3, 4]) {
    for (const [dx, dy] of [[Math.round(w / d), 0], [0, Math.round(h / d)], [Math.round(w / d), Math.round(h / d)]]) {
      let c = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c += lum[y * w + x] * lum[((y + dy) % h) * w + ((x + dx) % w)];
      rho = Math.max(rho, Math.abs(c / lum.length / variance));
    }
  }
  return { rho, contrast: Math.sqrt(variance) };
}

/** ThumbHash (aperçu flou ~25 octets) d'un calque. */
export async function thumbHashOf(img: Rgba): Promise<string> {
  const { data, info } = await raw(img).resize(100, 100, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString("base64");
}

/**
 * Réduction d'un élément dessiné en grand (kit v4) à sa taille d'usage :
 * lanczos3, alpha prémultiplié par libvips (pas de liseré sombre ni clair au
 * bord d'une forme détourée). Ce qui est quasi transparent (alpha ≤ 8) est
 * remis à zéro, comme à l'import d'un kit mono-fichier.
 */
export async function reduceTo(img: Rgba, width: number, height: number): Promise<Rgba> {
  if (img.width === width && img.height === height) return img;
  const data = await raw(img).resize(width, height, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] <= 8) data.writeUInt32LE(0, i);
  return { width, height, data };
}
