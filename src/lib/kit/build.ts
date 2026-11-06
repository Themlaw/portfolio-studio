/**
 * Export du kit PSD v2 (docs/THEME-KIT.md, spec.ts) : un groupe par élément,
 * chacun sur sa carte (titre, vignette du site où l'élément est surligné,
 * consignes en ≥ 36 px), emplacements pré-remplis avec l'asset actuel du
 * thème (calques SVG du hero rastérisés par sharp), sinon ce que le site
 * affiche aujourd'hui (nom en police de titre, flèches « ← », scotch CSS…) ; `_guides` verrouillé (cases, hauteurs utiles, zone
 * du titre, marges du cadre, identifiant d'export) ; LISEZ-MOI tout en haut.
 * Le manifeste (empreinte de chaque emplacement, aperçus « avant ») permet à
 * l'import de reconnaître ce qui n'a pas été redessiné.
 */
import { mkdir, open, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writePsdBuffer, type Layer, type Psd } from "ag-psd";
import sharp, { type OutputInfo, type OverlayOptions } from "sharp";

import { ensureAgPsd } from "./ag-psd-node";
import { asImported, frameHash, saveManifest, writePreview, type KitManifest } from "./manifest";
import { ALL_SLOTS, BOARD, CURSOR, CURSOR_DEFAULT_HOTSPOT, CURSOR_DRAWING_LAYER, DOC, element, ELEMENTS, EXPORT_ID_PREFIX, frameOf, GUIDES_GROUP, HERO, HOTSPOT_LAYER, ICON_STEP, KIT_VERSION, PREVIEW_LAYER, README_FRAME, README_LAYER, README_LINES, SWATCH, TITLE_ZONE, zonesWidth, type ElementSpec, type SlotSpec } from "./spec";
import { KIT_FONTS } from "./fonts";
import { closeVignetteSvg, HIGHLIGHT, vignetteSvg } from "./vignettes";
import { isAuto, isNuance, NUANCE_KEYS, parseColor, resolvePalette } from "@/themes/palette";
import type { Theme } from "@/themes/schema";

export type Raster = { width: number; height: number; data: Uint8ClampedArray };

export const toRaster = ({ data, info }: { data: Buffer; info: OutputInfo }): Raster => ({ width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) });

export async function rasterSvg(svg: string | Buffer, width: number, height: number): Promise<Raster> {
  return toRaster(
    await sharp(typeof svg === "string" ? Buffer.from(svg) : svg, { density: 144 })
      .resize(width, height, { fit: "cover" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  );
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Taille des textes (px à 100 %) : consignes ≥ 36 px (demande de l'artiste : lisible sans zoomer). */
export const TEXT = { title: 44, body: 36, readmeTitle: 48, readme: 40, label: 36 } as const;

/**
 * Texte rendu par sharp (Pango) depuis le fichier de police du dépôt
 * (public/kit/Figtree.ttf, OFL) : aucune police système (image distroless).
 * `width` : retour à la ligne (px).
 */
export async function textRaster(markup: string, fontFile: string, size: number, width?: number, family = "Figtree"): Promise<Raster> {
  return toRaster(
    await sharp({ text: { text: markup, fontfile: fontFile, font: `${family} ${size}`, rgba: true, dpi: 72, spacing: Math.round(size * 0.15), ...(width ? { width, wrap: "word" as const } : {}) } })
      .raw()
      .toBuffer({ resolveWithObject: true }),
  );
}
export const rawInput = (r: Raster) => ({ input: Buffer.from(r.data.buffer, r.data.byteOffset, r.data.length), raw: { width: r.width, height: r.height, channels: 4 as const } });

/**
 * Ce que le site affiche AUJOURD'HUI pour un emplacement sans asset dessiné
 * (l'artiste voit ce qu'elle remplace) : flèches « ← » / « → » et croix « ✕ »
 * des boutons, triangle de lecture, scotch CSS translucide, passe-partout
 * (`.mat`), trait droit, fond uni ou pointillé. La signature (nom du site dans
 * la police de titre) est rendue à part (signatureRaster).
 */
export function currentLookSvg(slot: SlotSpec, theme: Theme, scale = 1): string {
  const c = theme.tokens.color;
  const { w, h } = slot.size;
  // `scale` (kit v4) : même dessin vectoriel rendu à la taille de la grande case.
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">`;
  const arrow = (dir: 1 | -1) => {
    // « ← » : trait horizontal et pointe, épaisseur d'un glyphe fin.
    const [tip, tail] = dir < 0 ? [24, 104] : [104, 24];
    return `<path d="M${tail} 64 H${tip} M${tip - dir * 26} 38 L${tip} 64 L${tip - dir * 26} 90" fill="none" stroke="${c.ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
  };
  switch (slot.kind) {
    case "plan": {
      const n = Number(slot.id.split("-").pop());
      const top = h - (slot.usefulHeight ?? h);
      if (n === 1) return `${open}<rect width="${w}" height="${h}" fill="${c.bgDeep}"/></svg>`;
      const fills = [c.bgDeep, c.line, c.tertiary, c.inkSoft, c.ink];
      const y = top + 60;
      return `${open}<path d="M0 ${h} L0 ${y} C ${w * 0.25} ${y - 80} ${w * 0.5} ${y + 90} ${w * 0.75} ${y} S ${w} ${y - 40} ${w} ${y} L ${w} ${h} Z" fill="${fills[n - 1]}"/></svg>`;
    }
    case "signature":
      return `${open}</svg>`;
    case "appicon":
      // Lot 83 : sans icône actuelle fournie, un carré arrondi de la couleur d'action.
      return `${open}<rect width="${w}" height="${h}" rx="${Math.round(w * 0.22)}" fill="${c.primary}"/></svg>`;
    case "tile": {
      if (theme.variants.texture !== "paper-dots") return `${open}<rect width="${w}" height="${h}" fill="${c.bg}"/></svg>`;
      // Points de 1 px tous les 22 px CSS (tuile affichée à 50 % : ~44 px ici), encre à 3,5 %.
      const step = w / 12;
      const dots: string[] = [];
      for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) dots.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2"/>`);
      return `${open}<rect width="${w}" height="${h}" fill="${c.bg}"/><g fill="${c.ink}" fill-opacity="0.035">${dots.join("")}</g></svg>`;
    }
    case "nine": {
      if (theme.variants.lightbox !== "passe-partout") return `${open}</svg>`;
      // Passe-partout : fond « surface », coins arrondis du thème, centre ouvert.
      const r = Math.min(24, parseFloat(theme.tokens.radius.sm) * 2 || 0);
      const m = 48;
      return `${open}<path fill-rule="evenodd" fill="${c.surface}" d="M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z M${m} ${m} V${h - m} H${w - m} V${m} Z"/></svg>`;
    }
    case "stroke":
      // Soulignement et filets : un trait droit, régulier.
      return `${open}<rect x="10" y="${h / 2 - 12}" width="${w - 20}" height="24" rx="12" fill="${c.primary}"/></svg>`;
    case "icon": {
      const key = slot.id.split("/")[1];
      if (key === "fleche-gauche") return `${open}${arrow(-1)}</svg>`;
      if (key === "fleche-droite") return `${open}${arrow(1)}</svg>`;
      if (key === "fermer") return `${open}<path d="M36 36 L92 92 M92 36 L36 92" stroke="${c.ink}" stroke-width="8" stroke-linecap="round"/></svg>`;
      // Triangle de lecture du site (viewBox 16 × 18), agrandi et centré.
      return `${open}<path d="M2 1.5 14.5 9 2 16.5Z" transform="translate(20 16) scale(5.333)" fill="${c.ink}"/></svg>`;
    }
    case "vicon": {
      // Lot 121 : l'icône vidéo ACTUELLE du site (mêmes tracés que src/components/video-icons.tsx), centrée dans la case.
      const d = VIDEO_DEFAULTS[slot.id.slice(6)];
      const ink = c.ink;
      return `${open}<svg x="${(w - d.w) / 2}" y="${(h - d.h) / 2}" width="${d.w}" height="${d.h}" viewBox="${d.vb}">${d.body(ink)}</svg></svg>`;
    }
    case "vbadge":
      // Fond du badge actuel : carré arrondi translucide de la couleur « surface » du thème.
      return `${open}<rect width="${w}" height="${h}" rx="${Math.round(w * 0.22)}" fill="${c.surface}" fill-opacity="0.82"/></svg>`;
    case "swatch":
      // Pastilles : swatchRaster (pixels exacts).
      return `${open}</svg>`;
    case "cursor":
      // Représentation des curseurs du système (flèche, main), noir au contour blanc, en 2x.
      return slot.cursor === "pointer"
        ? `${open}<path d="${HAND_PATH}" fill="#000000" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/></svg>`
        : `${open}<path d="${ARROW_PATH}" fill="#000000" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/></svg>`;
    case "tape":
      // Scotch CSS : surface à 58 %, bords en pointillés (encre 10 %), de travers (-3°).
      return `${open}<g transform="rotate(-3 ${w / 2} ${h / 2})"><rect x="44" y="47" width="312" height="72" fill="${c.ink}" fill-opacity="0.06"/><rect x="44" y="44" width="312" height="72" fill="${c.surface}" fill-opacity="0.58"/><path d="M44 44 V116 M356 44 V116" stroke="${c.ink}" stroke-opacity="0.1" stroke-width="3" stroke-dasharray="7 5"/></g></svg>`;
  }
}

/** Lot 121 : tracés des icônes vidéo du site (mêmes que video-icons.tsx), taille posée dans la case 128 × 128. */
const SOUND_BODY = (ink: string) => `<path d="M4 9h4l5-4v14l-5-4H4Z" fill="${ink}"/>`;
const VIDEO_DEFAULTS: Record<string, { vb: string; w: number; h: number; body: (ink: string) => string }> = {
  lecture: { vb: "0 0 16 18", w: 84, h: 94, body: (i) => `<path d="M2 1.5 14.5 9 2 16.5Z" fill="${i}"/>` },
  pause: { vb: "0 0 12 14", w: 76, h: 88, body: (i) => `<rect x="1" y="1" width="3.5" height="12" fill="${i}"/><rect x="7.5" y="1" width="3.5" height="12" fill="${i}"/>` },
  boucle: { vb: "0 0 24 24", w: 100, h: 100, body: (i) => `<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" stroke="${i}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` },
  son: { vb: "0 0 24 24", w: 100, h: 100, body: (i) => `${SOUND_BODY(i)}<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="${i}" stroke-width="1.8" stroke-linecap="round" fill="none"/>` },
  muet: { vb: "0 0 24 24", w: 100, h: 100, body: (i) => `${SOUND_BODY(i)}<path d="m16 9 5 6m0-6-5 6" stroke="${i}" stroke-width="2" stroke-linecap="round" fill="none"/>` },
  "plein-ecran": { vb: "0 0 24 24", w: 100, h: 100, body: (i) => `<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="${i}" stroke-width="2" fill="none" stroke-linecap="round"/>` },
  "quitter-plein-ecran": { vb: "0 0 24 24", w: 100, h: 100, body: (i) => `<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke="${i}" stroke-width="2" fill="none" stroke-linecap="round"/>` },
};

/* ---- Curseurs (lot 4) ---- */
/** Flèche du système (case 64 × 64, 2x) : pointe en (4, 4). */
const ARROW_PATH = "M4 4 L4 50 L15 39 L22 55 L29 52 L22 36 L37 36 Z";
/** Main du système : bout de l'index en (26, 4). */
const HAND_PATH =
  "M22 8 Q22 3 26.5 3 Q31 3 31 8 L31 26 Q31 22 35.5 22 Q40 22 40 26.5 L40 28 Q40 24 44.5 24 Q49 24 49 28.5 L49 31 Q49 27 52.5 27 Q56 27 56 31 L56 46 Q56 60 42 60 L30 60 Q22 60 17 52 L9 40 Q7 36 10.5 34.5 Q14 33 17 37 L22 43 Z";
/** Repère du point chaud : anneau rose de 11 × 11 px centré sur le point (son centre fait foi à l'import). */
export const HOTSPOT_R = 5;
export async function hotspotRaster(scale = 1): Promise<Raster> {
  const d = (2 * HOTSPOT_R + 1) * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${(HOTSPOT_R - 1) * scale}" fill="none" stroke="${HIGHLIGHT}" stroke-width="${2 * scale}"/></svg>`;
  return toRaster(await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
}
/* ---- fin Curseurs (lot 4) ---- */

/**
 * Pastille de la palette, pixels écrits directement (pas de rendu SVG : la
 * couleur exacte, transparence comprise, sans arrondi de rééchantillonnage) :
 * carré aux coins arrondis, bords nets.
 */
export function swatchRaster(color: string, size: number): Raster {
  const p = parseColor(color) ?? { rgb: [0, 0, 0] as [number, number, number], alpha: 1 };
  const a = Math.round(p.alpha * 255);
  const data = new Uint8ClampedArray(size * size * 4);
  const r = 22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(r - x - 0.5, x + 0.5 - (size - r), 0);
      const dy = Math.max(r - y - 0.5, y + 0.5 - (size - r), 0);
      if (dx * dx + dy * dy > r * r) continue;
      data.set([p.rgb[0], p.rgb[1], p.rgb[2], a], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

/** Nom du site dans la police de titre du thème, à sa graisse, encre sur transparent, centré dans la case. */
export async function signatureRaster(theme: Theme, siteName: string, publicDir: string, slot: SlotSpec, scale = 1): Promise<Raster> {
  const font = KIT_FONTS[theme.tokens.font.display];
  const file = path.join(/* turbopackIgnore: true */ publicDir, "kit", "fonts", font.file);
  const markup = `<span foreground="${theme.tokens.color.ink}">${esc(siteName)}</span>`;
  const { w, h } = slot.size;
  let size = 170 * scale;
  let text = await textRaster(markup, file, size, undefined, font.pango);
  const fit = Math.min((w - 80 * scale) / text.width, (h - 40 * scale) / text.height, 1);
  if (fit < 1) {
    size = Math.floor(size * fit);
    text = await textRaster(markup, file, size, undefined, font.pango);
  }
  const { data, info } = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ ...rawInput(text), left: Math.round((w - text.width) / 2), top: Math.round((h - text.height) / 2) }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  return toRaster({ data, info });
}

/** Hauteur réservée au titre, au-dessus de chaque carte. */
export const TITLE_H = 62;

/**
 * Carte d'un élément (calque « Aperçu — ne pas modifier », sous ses
 * emplacements) : fond blanc percé à l'endroit des cases, titre au-dessus,
 * phrase « où », vignette, consignes, libellés des icônes.
 */
async function cardRaster(el: ElementSpec, colors: Theme["tokens"]["color"], fontFile: string, autoKeys: Set<string> = new Set()): Promise<{ raster: Raster; x: number; y: number }> {
  const b = el.board;
  const H = b.h + TITLE_H;
  const slots = ALL_SLOTS.filter((s) => s.element === el.id);
  // Cases percées (la transparence du calque reste visible dans Photoshop).
  const holes = slots.map((s) => {
    const f = frameOf(s, "v2");
    return `M${f.x - b.x} ${f.y - b.y + TITLE_H} h ${f.w} v ${f.h} h ${-f.w} Z`;
  });
  const card = `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${H}"><path fill-rule="evenodd" fill="#ffffff" stroke="#b9bdc6" stroke-width="3" d="M1.5 ${TITLE_H + 1.5} h ${b.w - 3} v ${b.h - 3} h ${-(b.w - 3)} Z ${holes.join(" ")}"/></svg>`;
  const parts: OverlayOptions[] = [];
  const title = await textRaster(`<span foreground="#1f2226"><b>${esc(el.title)}</b></span>`, fontFile, TEXT.title);
  parts.push({ ...rawInput(title), left: 4, top: Math.max(0, TITLE_H - title.height - 6) });

  // Panneau à droite des cases.
  const compact = el.id === "palette" || el.id === "curseur";
  // Palette, curseurs : les libellés sous les cases sont plus larges que les cases.
  const px = BOARD.pad + zonesWidth(el) + (el.id === "palette" ? SWATCH.col - SWATCH.size : el.id === "curseur" ? CURSOR.step - CURSOR.size : 0) + BOARD.gap;
  const pw = el.id === "paysage" ? BOARD.heroPanel : compact ? b.w - px - BOARD.pad : BOARD.panel;
  let py = TITLE_H + BOARD.pad;
  const where = await textRaster(`<span foreground="#1f2226">${esc(el.where)}</span>`, fontFile, TEXT.body, pw);
  parts.push({ ...rawInput(where), left: px, top: py });
  py += where.height + 22;
  const rules = el.rules.map((r) => `• ${esc(r)}`).join("\n");
  if (el.id === "paysage") {
    const vw = pw - 20;
    const vh = Math.round(vw * 0.62);
    parts.push({ input: Buffer.from(vignetteSvg(el.id, colors, vw, vh)), left: px, top: py });
    py += vh + 26;
    const text = await textRaster(`<span foreground="#1f2226">${rules}</span>`, fontFile, TEXT.body, pw);
    parts.push({ ...rawInput(text), left: px, top: py });
    py += text.height;
  } else if (compact) {
    // Palette, curseurs : pas de vignette (les pastilles et les cases parlent d'elles-mêmes).
    const text = await textRaster(`<span foreground="#1f2226">${rules}</span>`, fontFile, TEXT.body, pw);
    parts.push({ ...rawInput(text), left: px, top: py });
    py += text.height;
  } else {
    const vw = 400;
    const vh = el.id === "icones" ? 170 : 250;
    parts.push({ input: Buffer.from(vignetteSvg(el.id, colors, vw, vh)), left: px, top: py });
    if (el.id === "icones") parts.push({ input: Buffer.from(closeVignetteSvg(colors, vw, vh)), left: px, top: py + vh + 20 });
    const text = await textRaster(`<span foreground="#1f2226">${rules}</span>`, fontFile, TEXT.body, pw - vw - 40);
    parts.push({ ...rawInput(text), left: px + vw + 40, top: py });
    py += Math.max(text.height, el.id === "icones" ? 2 * vh + 20 : vh);
  }
  if (py > H - 12) throw new Error(`carte « ${el.group} » : le panneau déborde (${py} > ${H - 12} px)`);

  // Libellés sous les icônes, les pastilles et les curseurs.
  if (el.id === "icones" || compact) {
    const step = el.id === "icones" ? ICON_STEP : el.id === "palette" ? SWATCH.col : CURSOR.step;
    for (const s of slots) {
      const f = frameOf(s, "v2");
      // Pastille : la base en gras, la nuance dessous ; « auto » si elle suit sa base.
      const name = s.kind === "cursor" ? s.layer : s.label;
      const text = s.kind === "swatch" && s.paletteKey && !isNuance(s.paletteKey) ? `<b>${esc(name)}</b>` : esc(name) + (s.paletteKey && autoKeys.has(s.paletteKey) ? " (auto)" : "");
      const label = await textRaster(`<span foreground="#1f2226">${text}</span>`, fontFile, TEXT.label, step - 16);
      if (label.width > step - 16) throw new Error(`libellé trop large : ${s.label}`);
      const top = f.y - b.y + TITLE_H + f.h + 14;
      if (top + label.height > H - 6) throw new Error(`libellé hors de la carte : ${s.label}`);
      parts.push({ ...rawInput(label), left: f.x - b.x, top });
    }
  }
  const { data, info } = await sharp(Buffer.from(card)).ensureAlpha().composite(parts).raw().toBuffer({ resolveWithObject: true });
  return { raster: toRaster({ data, info }), x: b.x, y: b.y - TITLE_H };
}

/** Repères d'un élément (dans `_guides`, au-dessus) : cases, hauteurs utiles, zone du titre, marges du cadre. */
async function guidesRaster(el: ElementSpec, fontFile: string): Promise<{ raster: Raster; x: number; y: number }> {
  const b = el.board;
  const parts: string[] = [];
  const labels: { x: number; y: number; text: string; color: string }[] = [];
  const rect = (x: number, y: number, w: number, h: number, color: string, dash = "") =>
    parts.push(`<rect x="${x - 2}" y="${y - 2}" width="${w + 4}" height="${h + 4}" fill="none" stroke="${color}" stroke-width="3" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`);
  const slots = ALL_SLOTS.filter((s) => s.element === el.id);
  for (const s of slots) {
    const f = frameOf(s, "v2");
    const x = f.x - b.x;
    const y = f.y - b.y;
    rect(x, y, f.w, f.h, HIGHLIGHT);
    if (s.slice) {
      const { top, right, bottom, left } = s.slice;
      for (const [x1, y1, x2, y2] of [
        [x + left, y, x + left, y + f.h],
        [x + f.w - right, y, x + f.w - right, y + f.h],
        [x, y + top, x + f.w, y + top],
        [x, y + f.h - bottom, x + f.w, y + f.h - bottom],
      ]) {
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#00a36c" stroke-width="2" stroke-dasharray="6 6"/>`);
      }
    }
  }
  if (el.id === "paysage") {
    const f = frameOf(ALL_SLOTS[0], "v2");
    const ox = f.x - b.x;
    const oy = f.y - b.y;
    rect(ox + TITLE_ZONE.x, oy + TITLE_ZONE.y, TITLE_ZONE.w, TITLE_ZONE.h, HIGHLIGHT, "18 10");
    labels.push({ x: ox + TITLE_ZONE.x + 16, y: oy + TITLE_ZONE.y + 12, text: "Zone du titre : décor calme", color: HIGHLIGHT });
    for (const s of slots.filter((s) => s.usefulHeight && s.usefulHeight < HERO.height)) {
      const y = oy + HERO.height - s.usefulHeight!;
      parts.push(`<line x1="${ox}" y1="${y}" x2="${ox + HERO.width}" y2="${y}" stroke="#0077cc" stroke-width="3" stroke-dasharray="14 8"/>`);
      labels.push({ x: ox + HERO.width - 640, y: y - 48, text: `${s.label} : hauteur utile ${s.usefulHeight} px`, color: "#0077cc" });
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}">${parts.join("")}</svg>`;
  const texts = await Promise.all(
    labels.map(async (l) => ({ ...rawInput(await textRaster(`<span foreground="${l.color}" background="#ffffffcc"> ${esc(l.text)} </span>`, fontFile, TEXT.label)), left: l.x, top: Math.max(0, l.y) })),
  );
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().composite(texts).raw().toBuffer({ resolveWithObject: true });
  return { raster: toRaster({ data, info }), x: b.x, y: b.y };
}

/** LISEZ-MOI : cadre jaune pâle, titre en gras, cinq lignes (police du dépôt). */
async function readmeRaster(fontFile: string): Promise<Raster> {
  const { w, h } = README_FRAME;
  const [title, ...rules] = README_LINES;
  const head = await textRaster(`<span foreground="#1f2226"><b>${esc(title)}</b></span>`, fontFile, TEXT.readmeTitle);
  const body = await textRaster(`<span foreground="#1f2226">${rules.map(esc).join("\n")}</span>`, fontFile, TEXT.readme, w - 60);
  if (14 + head.height + 8 + body.height > h - 6) throw new Error(`LISEZ-MOI : le texte déborde (${14 + head.height + 8 + body.height} > ${h - 6} px)`);
  const box = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" fill="#fffbe6" stroke="${HIGHLIGHT}" stroke-width="3"/></svg>`;
  const { data, info } = await sharp(Buffer.from(box))
    .ensureAlpha()
    .composite([
      { ...rawInput(head), left: 30, top: 14 },
      { ...rawInput(body), left: 30, top: 14 + head.height + 8 },
    ])
    .raw()
    .toBuffer({ resolveWithObject: true });
  return toRaster({ data, info });
}

/**
 * Calque rogné à son contenu (comme Photoshop l'enregistre) : un plan 2 à 5
 * n'occupe que sa hauteur utile, la mémoire de l'export baisse d'autant.
 * L'import replace chaque calque dans sa case : sans effet sur l'empreinte.
 */
export function layerAt(name: string, x: number, y: number, r: Raster, extra: Partial<Layer> = {}): Layer {
  let top = r.height;
  let bottom = -1;
  let left = r.width;
  let right = -1;
  for (let yy = 0; yy < r.height; yy++) {
    for (let xx = 0; xx < r.width; xx++) {
      if (r.data[(yy * r.width + xx) * 4 + 3] === 0) continue;
      if (yy < top) top = yy;
      if (yy > bottom) bottom = yy;
      if (xx < left) left = xx;
      if (xx > right) right = xx;
    }
  }
  let img = r;
  if (bottom < 0) {
    img = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    top = left = 0;
  } else if (top > 0 || left > 0 || right < r.width - 1 || bottom < r.height - 1) {
    const w = right - left + 1;
    const h = bottom - top + 1;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++) data.set(r.data.subarray(((top + yy) * r.width + left) * 4, ((top + yy) * r.width + left + w) * 4), yy * w * 4);
    img = { width: w, height: h, data };
  }
  return { name, left: x + left, top: y + top, right: x + left + img.width, bottom: y + top + img.height, imageData: img, ...extra };
}
/** Mesure de l'export par étape (KIT_MEM_DEBUG=1 : pic et RSS courant sur stderr). */
export const memStep = (step: string) => {
  if (process.env.KIT_MEM_DEBUG) console.error(`[kit-mem] ${step} : pic ${Math.round(process.resourceUsage().maxRSS / 1024)} Mo, rss ${Math.round(process.memoryUsage().rss / 1048576)} Mo`);
};
/** Ramasse-miettes explicite (processus enfant lancé avec --expose-gc). */
export const gc = () => (globalThis as { gc?: () => void }).gc?.();
export const LOCKED = { protected: { transparency: true, composite: true, position: true } };

export type KitBuildStats = { layers: number; prefilled: string[]; placeholders: string[]; exportId: string };
/** `compositeFile` : garder le rendu composite (PNG) à cet endroit (captures). */
/** `assets` : fichiers des éléments déjà dessinés du thème, par emplacement (export-job.kitAssetFiles). */
export type BuildOptions = {
  exportId: string;
  themeVersion: string;
  siteName: string;
  manifestDir?: string;
  compositeFile?: string;
  assets?: Record<string, { file: string; w: number; h: number; x?: number; y?: number; colored?: true }>;
};

/**
 * Élément déjà dessiné (kit appliqué au thème) replacé dans sa case : plan à
 * sa position, case entière (tuile, cadre, icônes) étirée à la case, forme
 * rognée (signature, trait, scotch) centrée. Forme d'une couleur (masque) :
 * teinte du site (encre ; trait : primaire).
 */
async function kitAssetRaster(slot: SlotSpec, asset: NonNullable<BuildOptions["assets"]>[string], theme: Theme): Promise<Raster> {
  const { w: W, h: H } = slot.size;
  const whole = !slot.crop;
  const w = whole ? W : Math.min(W, asset.w);
  const h = whole ? H : Math.min(H, asset.h);
  let img = sharp(await readFile(asset.file), { density: 144 }).resize(w, h, { fit: "fill" }).ensureAlpha();
  if (slot.mono && !asset.colored) {
    const alpha = await img.extractChannel(3).raw().toBuffer();
    const hex = slot.kind === "stroke" ? theme.tokens.color.primary : theme.tokens.color.ink;
    img = sharp({ create: { width: w, height: h, channels: 3, background: hex } }).joinChannel(alpha, { raw: { width: w, height: h, channels: 1 } });
  }
  const piece = await img.raw().toBuffer();
  const left = slot.kind === "plan" ? (asset.x ?? 0) : Math.round((W - w) / 2);
  const top = slot.kind === "plan" ? (asset.y ?? 0) : Math.round((H - h) / 2);
  const { data, info } = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: piece, raw: { width: w, height: h, channels: 4 }, left, top }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  return toRaster({ data, info });
}

/** PSD (v1) sans sa dernière section (image composite) : en-tête et sections de longueur connue. */
export function psdWithoutComposite(psd: Buffer): Buffer {
  let pos = 26;
  for (let i = 0; i < 3; i++) pos += 4 + psd.readUInt32BE(pos); // mode couleur, ressources, calques et masques
  return psd.subarray(0, pos);
}

/** PackBits d'une ligne (format de compression RLE des PSD), dans un tampon réutilisé. */
function packBits(row: Uint8Array, out: Buffer): Buffer {
  let o = 0;
  let i = 0;
  while (i < row.length) {
    let run = 1;
    while (i + run < row.length && run < 128 && row[i + run] === row[i]) run++;
    if (run > 1) {
      out[o++] = 257 - run;
      out[o++] = row[i];
      i += run;
      continue;
    }
    let lit = 1;
    while (i + lit < row.length && lit < 128 && !(i + lit + 1 < row.length && row[i + lit] === row[i + lit + 1])) lit++;
    out[o++] = lit - 1;
    for (let k = 0; k < lit; k++) out[o++] = row[i + k];
    i += lit;
  }
  return Buffer.from(out.subarray(0, o));
}

/**
 * Section « image composite » d'un PSD RVB 8 bits sans alpha, depuis un
 * fichier au format natif de libvips (`.v` : en-tête de 64 octets puis les
 * pixels RVB(A) entrelacés, non compressés ; l'alpha éventuel est ignoré) lu ligne à ligne sur le disque :
 * aucun décodage (un PNG relu en flux coûtait ~120 Mo de plus au pic).
 * Compression RLE, comptes d'octets de toutes les lignes de toutes les
 * couches, puis les lignes couche par couche.
 */
export async function compositeRle(file: string, channels: number, size: { width: number; height: number } = DOC): Promise<Buffer> {
  const { width, height } = size;
  const rows: Buffer[][] = [[], [], []];
  const stride = width * channels;
  const line = Buffer.alloc(stride);
  const plane = new Uint8Array(width);
  const scratch = Buffer.alloc(width + Math.ceil(width / 128) + 8);
  const fh = await open(file, "r");
  try {
    for (let y = 0; y < height; y++) {
      const { bytesRead } = await fh.read(line, 0, stride, VIPS_HEADER + y * stride);
      if (bytesRead !== stride) throw new Error(`composite : ligne ${y} incomplète`);
      for (let c = 0; c < 3; c++) {
        for (let x = 0; x < width; x++) plane[x] = line[x * channels + c];
        rows[c].push(packBits(plane, scratch));
      }
    }
  } finally {
    await fh.close();
  }
  const counts = Buffer.alloc(3 * height * 2);
  let i = 0;
  for (const channel of rows) for (const r of channel) counts.writeUInt16BE(r.length, 2 * i++);
  const head = Buffer.alloc(2);
  head.writeUInt16BE(1, 0);
  return Buffer.concat([head, counts, ...rows[0], ...rows[1], ...rows[2]]);
}
/** En-tête du format natif de libvips (.v). */
export const VIPS_HEADER = 64;

/** PSD du kit pour un thème. `publicDir` : dossier public/ (assets actuels du thème). */
export async function buildKit(theme: Theme, publicDir: string, opts: BuildOptions): Promise<{ psd: Buffer; stats: KitBuildStats; manifest: KitManifest }> {
  ensureAgPsd();
  // Mémoire : pas de cache libvips (jusqu'à 50 Mo), un seul fil.
  sharp.cache(false);
  sharp.concurrency(1);
  const colors = theme.tokens.color;
  const fontFile = path.join(/* turbopackIgnore: true */ publicDir, "kit", "Figtree.ttf");
  const prefilled: string[] = [];
  const placeholders: string[] = [];
  const heroAssets = theme.assets.heroLayers ?? [];
  const manifest: KitManifest = { exportId: opts.exportId, themeId: theme.id, themeVersion: opts.themeVersion, kitVersion: KIT_VERSION, slots: {}, previews: {}, colors: {}, hotspots: {} };
  // Palette : valeurs effectives exportées (comparées à l'import) et nuances « auto ».
  const resolved = resolvePalette(colors, theme.tokens.palette);
  const autoKeys = new Set<string>(NUANCE_KEYS.filter((k) => isAuto(colors, theme.tokens.palette, k)));

  const slotLayer = async (slot: SlotSpec): Promise<Layer> => {
    let raster: Raster | null = null;
    const drawn = opts.assets?.[slot.id];
    if (drawn) {
      raster = await kitAssetRaster(slot, drawn, theme);
      prefilled.push(slot.id);
    }
    if (!raster && slot.kind === "plan") {
      const asset = heroAssets[Number(slot.id.split("-").pop()) - 1];
      if (asset) {
        const file = path.join(/* turbopackIgnore: true */ publicDir, asset.replace(/^\//, ""));
        raster = await rasterSvg(await readFile(file), HERO.width, HERO.height);
        prefilled.push(slot.id);
      }
    }
    if (!raster && slot.kind === "swatch") {
      const value = resolved[slot.paletteKey!];
      manifest.colors![slot.paletteKey!] = value;
      raster = swatchRaster(value, slot.size.w);
    }
    if (!raster && slot.kind === "signature") {
      raster = await signatureRaster(theme, opts.siteName, publicDir, slot);
      placeholders.push(slot.id);
    }
    if (!raster) {
      raster = await rasterSvg(currentLookSvg(slot, theme), slot.size.w, slot.size.h);
      placeholders.push(slot.id);
    }
    // Empreinte telle que l'import la recalculera ; aperçu « avant ».
    const imported = asImported({ width: raster.width, height: raster.height, data: Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.length) });
    manifest.slots[slot.id] = { hash: frameHash(imported) };
    if (opts.manifestDir && slot.kind !== "swatch") {
      const file = `${opts.exportId}--${slot.id.replace(/\//g, "--")}.png`;
      await writePreview(imported, path.join(opts.manifestDir, file), slot.kind === "plan");
      manifest.previews![slot.id] = file;
    }
    const f = frameOf(slot, "v2");
    return layerAt(slot.layer, f.x, f.y, raster);
  };
  if (opts.manifestDir) await (await import("node:fs/promises")).mkdir(opts.manifestDir, { recursive: true });

  // Ordre ag-psd : du bas vers le haut. Éléments 7 → 1, puis _guides, puis LISEZ-MOI.
  const ordered = ELEMENTS.filter((e) => e.id !== "siteicon" && e.id !== "video").sort((a, b) => b.group.localeCompare(a.group, "fr", { numeric: true }));
  const children: Layer[] = [];
  const guides: Layer[] = [];
  const hotspotImg = await hotspotRaster();
  for (const el of ordered) {
    const card = await cardRaster(el, colors, fontFile, autoKeys);
    const inner: Layer[] = [layerAt(PREVIEW_LAYER, card.x, card.y, card.raster, LOCKED)];
    // Emplacements : plan 1 au fond (le dernier de la liste est au-dessus).
    const slots = ALL_SLOTS.filter((s) => s.element === el.id);
    const stack = el.id === "icones" || el.id === "palette" || el.id === "curseur" ? [...slots].reverse() : slots;
    for (const s of stack) {
      if (s.kind !== "cursor") {
        inner.push(await slotLayer(s));
        continue;
      }
      // Curseur : un groupe « Normal » / « Clic » = le dessin et le repère du point chaud (au-dessus).
      const drawing = await slotLayer(s);
      drawing.name = CURSOR_DRAWING_LAYER;
      const asset = opts.assets?.[s.id];
      const hs = asset?.x !== undefined && asset.y !== undefined ? { x: asset.x * 2, y: asset.y * 2 } : CURSOR_DEFAULT_HOTSPOT[s.cursor!];
      manifest.hotspots![s.id] = hs;
      const f = frameOf(s, "v2");
      const marker = layerAt(HOTSPOT_LAYER, f.x + hs.x - HOTSPOT_R, f.y + hs.y - HOTSPOT_R, hotspotImg);
      inner.push({ name: s.layer, opened: true, children: [drawing, marker] });
    }
    children.push({ name: el.group, opened: el.id === "paysage" || el.id === "palette", children: inner });
    const g = await guidesRaster(el, fontFile);
    guides.unshift(layerAt(`repères · ${el.group}`, g.x, g.y, g.raster, LOCKED));
    // Rasters pleine case (avant rognage, copies d'empreinte) : rendus tout de suite.
    gc();
    memStep(el.group);
  }
  memStep("éléments rendus");
  // Identifiant d'export : dans un nom de calque (Photoshop garde les noms), à droite de la dernière rangée.
  const idText = await textRaster(`<span foreground="#6b7078">identifiant du kit :\n${opts.exportId}\n(ne pas supprimer)</span>`, fontFile, 22);
  const last = element("scotch").board;
  if (last.x + last.w + 24 + idText.width > DOC.width) throw new Error("identifiant du kit : pas de place");
  guides.push(layerAt(`${EXPORT_ID_PREFIX}${opts.exportId} — ne pas supprimer`, DOC.width - idText.width - 16, last.y, idText, LOCKED));
  children.push({ name: GUIDES_GROUP, opened: false, ...LOCKED, children: guides });
  children.push(layerAt(README_LAYER, README_FRAME.x, README_FRAME.y, await readmeRaster(fontFile), LOCKED));

  // Image composite (aperçus hors Photoshop ; Photoshop recompose à partir
  // des calques) : fond gris de plan de travail. Composée en flux vers un PNG
  // sur disque, puis réencodée ligne à ligne à la place du composite vide
  // d'ag-psd : jamais deux copies de 4000 × 4000 en mémoire (export < 400 Mo).
  const flat: { r: Raster; x: number; y: number }[] = [];
  const collect = (list: Layer[]) => {
    for (const l of list) {
      if (l.children) collect(l.children);
      else if (l.imageData) flat.push({ r: l.imageData as Raster, x: l.left ?? 0, y: l.top ?? 0 });
    }
  };
  collect(children);
  const layerCount = flat.length;
  // Format natif de libvips (.v, non compressé, ~75 Mo) : relu ligne à ligne sans
  // décodage. Sur le disque des données (à côté des manifestes), jamais dans /tmp :
  // un tmpfs le compterait dans la mémoire (du conteneur). Restes d'un export tué
  // (plafond mémoire, durée) : supprimés avant.
  const workDir = opts.manifestDir ? path.dirname(opts.manifestDir) : os.tmpdir();
  await mkdir(workDir, { recursive: true });
  await purgeStaleComposites(workDir);
  const compositeFile = path.join(workDir, `kit-composite-${process.pid}-${Date.now()}.v`);
  try {
    await sharp({ create: { width: DOC.width, height: DOC.height, channels: 3, background: { r: 214, g: 216, b: 221 } } })
      .composite(flat.map(({ r, x, y }) => ({ ...rawInput(r), left: x, top: y })))
      .toFile(compositeFile);
    const vh = await sharp(compositeFile).metadata();
    if (vh.width !== DOC.width || vh.height !== DOC.height || !vh.channels || vh.channels < 3 || vh.depth !== "uchar") throw new Error(`composite : format inattendu (${vh.width} × ${vh.height}, ${vh.channels} canaux, ${vh.depth})`);
    flat.length = 0;
    memStep("composite");

    gc();
    // Document déclaré en 1 × 1 à l'écriture : ag-psd alloue sinon un tampon de
    // travail de 8 × largeur × hauteur et un composite vide de 4 × l × h (≈ 230 Mo
    // pour 4000 × 4880) qu'on jette aussitôt. Les calques gardent leurs
    // coordonnées absolues ; la vraie taille est réécrite dans l'en-tête (octets
    // 14 et 18) et le vrai composite ajouté ensuite (export-kit.mts relit le tout).
    const psd: Psd = { width: 1, height: 1, children };
    const blank = writePsdBuffer(psd, { noBackground: true });
    // Calques rendus avant le réencodage du composite (pic de l'export).
    children.length = 0;
    guides.length = 0;
    gc();
    memStep("PSD écrit");
    const head = Buffer.from(psdWithoutComposite(blank));
    head.writeUInt32BE(DOC.height, 14);
    head.writeUInt32BE(DOC.width, 18);
    const buffer = Buffer.concat([head, await compositeRle(compositeFile, vh.channels)]);
    memStep("composite RLE");
    if (opts.compositeFile) await sharp(compositeFile).png({ compressionLevel: 1 }).toFile(opts.compositeFile);
    if (opts.manifestDir) await saveManifest(opts.manifestDir, manifest);
    return { psd: buffer, stats: { layers: layerCount, prefilled, placeholders, exportId: opts.exportId }, manifest };
  } finally {
    await rm(compositeFile, { force: true });
  }
}

/** Composites `.v` laissés par un export tué (processus disparu). */
export async function purgeStaleComposites(dir: string): Promise<void> {
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const m = /^kit-composite-(\d+)-\d+\.v$/.exec(name);
    if (!m || Number(m[1]) === process.pid) continue;
    let alive = true;
    try {
      process.kill(Number(m[1]), 0);
    } catch {
      alive = false;
    }
    if (!alive) await rm(path.join(/* turbopackIgnore: true */ dir, name), { force: true });
  }
}
