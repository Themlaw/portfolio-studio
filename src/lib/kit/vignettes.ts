/**
 * Vignettes du kit : maquette schématique du site (aux couleurs du thème) où
 * la zone de l'élément est surlignée en rose. Une capture réelle demanderait
 * un navigateur au moment de l'export (absent de l'image distroless, et
 * lourd) : la maquette dit la même chose — où l'élément apparaît.
 */
import type { Theme } from "@/themes/schema";

import type { ElementId } from "./spec";

type Colors = Theme["tokens"]["color"];

export const HIGHLIGHT = "#d0006f";
const hl = (inner: string, fill = 0.22) => `<g fill="${HIGHLIGHT}" fill-opacity="${fill}" stroke="${HIGHLIGHT}" stroke-width="5">${inner}</g>`;
/** Grande zone (tout le paysage, tout le fond) : contour appuyé, voile léger pour garder la maquette lisible. */
const hlArea = (x: number, y: number, w: number, h: number) => hl(`<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke-width="8"/>`, 0.08);

/** Bandeau du site : signature à gauche, menu à droite. */
function header(c: Colors, w: number, h: number, active = -1, signatureHl = false): string {
  const hh = Math.round(h * 0.12);
  const items = [0, 1, 2, 3]
    .map((i) => {
      const x = w * 0.58 + i * w * 0.095;
      const under = i === active ? `<rect x="${x}" y="${hh * 0.68}" width="${w * 0.07}" height="${Math.max(3, hh * 0.07)}" fill="${c.primary}"/>` : "";
      return `<rect x="${x}" y="${hh * 0.42}" width="${w * 0.07}" height="${Math.max(3, hh * 0.1)}" rx="2" fill="${c.inkSoft}"/>${under}`;
    })
    .join("");
  const sig = `<path d="M${w * 0.05} ${hh * 0.6} q ${w * 0.02} ${-hh * 0.4} ${w * 0.04} 0 t ${w * 0.04} 0 t ${w * 0.04} 0" fill="none" stroke="${c.ink}" stroke-width="${Math.max(2, hh * 0.08)}" stroke-linecap="round"/>`;
  const sigBox = signatureHl ? hl(`<rect x="${w * 0.035}" y="${hh * 0.12}" width="${w * 0.155}" height="${hh * 0.76}" rx="6"/>`) : "";
  return `<rect width="${w}" height="${hh}" fill="${c.bg}"/>${sig}${items}<line x1="0" y1="${hh}" x2="${w}" y2="${hh}" stroke="${c.line}" stroke-width="2"/>${sigBox}`;
}

/** Paysage d'accueil : 5 plans, du ciel au premier plan, et le nom. */
function landscape(c: Colors, w: number, top: number, bottom: number): string {
  const fills = [c.bgDeep, c.line, c.tertiary, c.inkSoft, c.ink];
  const span = bottom - top;
  let out = `<rect x="0" y="${top}" width="${w}" height="${span}" fill="${fills[0]}"/>`;
  for (let i = 1; i < 5; i++) {
    const y = top + span * (0.38 + i * 0.12);
    out += `<path d="M0 ${bottom} L0 ${y} C ${w * 0.25} ${y - span * 0.08} ${w * 0.55} ${y + span * 0.07} ${w} ${y - span * 0.03} L ${w} ${bottom} Z" fill="${fills[i]}"/>`;
  }
  out += `<rect x="${w * 0.08}" y="${top + span * 0.36}" width="${w * 0.36}" height="${span * 0.1}" rx="4" fill="${c.ink}"/>`;
  out += `<rect x="${w * 0.08}" y="${top + span * 0.5}" width="${w * 0.26}" height="${span * 0.035}" rx="3" fill="${c.ink}" fill-opacity="0.7"/>`;
  return out;
}

/** Planche : titre, trois images en rangée, flèches sur les bords (lot médias), barre du rail. */
function strip(c: Colors, w: number, top: number, opts: { tape?: boolean; arrowsHl?: boolean; railHl?: boolean; playHl?: boolean; frames?: boolean } = {}): string {
  const fw = w * 0.27;
  const fh = fw * 0.75;
  let out = `<rect x="${w * 0.06}" y="${top}" width="${w * 0.34}" height="${w * 0.03}" rx="3" fill="${c.ink}"/>`;
  const fy = top + w * 0.07;
  for (let i = 0; i < 3; i++) {
    const x = w * 0.06 + i * (fw + w * 0.04);
    out += `<rect x="${x}" y="${fy}" width="${fw}" height="${fh}" fill="${[c.tertiary, c.secondary, c.inkSoft][i]}" fill-opacity="0.75"/>`;
    if (opts.tape) {
      const t = `<rect x="${x + fw * 0.36}" y="${fy - fh * 0.06}" width="${fw * 0.28}" height="${fh * 0.13}" fill="#e7d39a" transform="rotate(-4 ${x + fw / 2} ${fy})"/>`;
      out += t + hl(`<rect x="${x + fw * 0.33}" y="${fy - fh * 0.1}" width="${fw * 0.34}" height="${fh * 0.2}" rx="4"/>`);
    }
    if (i === 1) {
      const px = x + fw / 2;
      const py = fy + fh / 2;
      const r = fw * 0.09;
      out += `<circle cx="${px}" cy="${py}" r="${r}" fill="${c.bg}"/><path d="M${px - r * 0.35} ${py - r * 0.5} L ${px + r * 0.55} ${py} L ${px - r * 0.35} ${py + r * 0.5} Z" fill="${c.ink}"/>`;
      if (opts.playHl) out += hl(`<circle cx="${px}" cy="${py}" r="${r * 1.4}"/>`);
    }
  }
  // Flèches sur les bords de la bande, à mi-hauteur des images (pastilles).
  const ay = fy + fh / 2;
  const r = w * 0.028;
  for (const [cx, dir] of [[w * 0.035, -1], [w * 0.965, 1]] as const) {
    out += `<circle cx="${cx}" cy="${ay}" r="${r}" fill="${c.surface}" stroke="${c.line}" stroke-width="2"/><path d="M${cx - dir * r * 0.3} ${ay - r * 0.45} L ${cx + dir * r * 0.3} ${ay} L ${cx - dir * r * 0.3} ${ay + r * 0.45}" fill="none" stroke="${c.ink}" stroke-width="${w * 0.006}" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (opts.arrowsHl) out += hl(`<circle cx="${cx}" cy="${ay}" r="${r * 1.35}"/>`);
  }
  const ry = fy + fh + w * 0.04;
  out += `<rect x="${w * 0.06}" y="${ry}" width="${w * 0.88}" height="${Math.max(2, w * 0.004)}" fill="${c.line}"/><rect x="${w * 0.06}" y="${ry - w * 0.002}" width="${w * 0.5}" height="${Math.max(3, w * 0.008)}" fill="${c.primary}"/>`;
  if (opts.railHl) out += hl(`<rect x="${w * 0.045}" y="${ry - w * 0.016}" width="${w * 0.91}" height="${w * 0.036}" rx="6"/>`);
  return out;
}

/** Image agrandie : voile sombre, image au centre dans son cadre, croix en haut à droite. */
function lightbox(c: Colors, w: number, h: number, frameHl: boolean, closeHl: boolean): string {
  const iw = w * 0.46;
  const ih = h * 0.62;
  const x = (w - iw) / 2;
  const y = (h - ih) / 2;
  const b = w * 0.025;
  let out = `<rect width="${w}" height="${h}" fill="#1d1f24"/>`;
  out += `<rect x="${x - b}" y="${y - b}" width="${iw + 2 * b}" height="${ih + 2 * b}" fill="${c.bg}"/><rect x="${x}" y="${y}" width="${iw}" height="${ih}" fill="${c.tertiary}"/>`;
  if (frameHl) out += hl(`<path fill-rule="evenodd" d="M${x - b * 1.6} ${y - b * 1.6} h ${iw + b * 3.2} v ${ih + b * 3.2} h ${-(iw + b * 3.2)} Z M${x} ${y} v ${ih} h ${iw} v ${-ih} Z"/>`);
  const cx = w * 0.93;
  const cy = h * 0.09;
  const s = w * 0.022;
  out += `<path d="M${cx - s} ${cy - s} L ${cx + s} ${cy + s} M ${cx + s} ${cy - s} L ${cx - s} ${cy + s}" stroke="#f5f5f5" stroke-width="${w * 0.006}" stroke-linecap="round"/>`;
  if (closeHl) out += hl(`<circle cx="${cx}" cy="${cy}" r="${s * 2.2}"/>`);
  return out;
}

/** Entrées des collections : trois grandes images légendées ; cadre de la première surligné. */
function collectionEntries(c: Colors, w: number, top: number, h: number): string {
  const gap = w * 0.04;
  const tw = (w * 0.88 - 2 * gap) / 3;
  const th = tw * 1.15;
  const y = top + (h - top - th - w * 0.07) / 2;
  const b = w * 0.018;
  let out = `<rect x="0" y="${top}" width="${w}" height="${h - top}" fill="${c.bg}"/>`;
  for (let i = 0; i < 3; i++) {
    const x = w * 0.06 + i * (tw + gap);
    out += `<rect x="${x}" y="${y}" width="${tw}" height="${th}" fill="${c.surface}"/><rect x="${x + b}" y="${y + b}" width="${tw - 2 * b}" height="${th - 2 * b}" fill="${[c.tertiary, c.inkSoft, c.line][i]}"/>`;
    out += `<rect x="${x}" y="${y + th + w * 0.025}" width="${tw * 0.45}" height="${Math.max(3, w * 0.012)}" rx="2" fill="${c.ink}"/>`;
  }
  const x0 = w * 0.06;
  out += hl(`<path fill-rule="evenodd" d="M${x0 - b * 0.6} ${y - b * 0.6} h ${tw + b * 1.2} v ${th + b * 1.2} h ${-(tw + b * 1.2)} Z M${x0 + b} ${y + b} v ${th - 2 * b} h ${tw - 2 * b} v ${-(th - 2 * b)} Z"/>`);
  return out;
}

/** Fond de page en papier : grain discret partout où il n'y a pas de contenu. */
function paperBackground(c: Colors, w: number, top: number, h: number): string {
  const dots: string[] = [];
  const step = Math.max(8, Math.round(w / 40));
  for (let y = top + step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) dots.push(`<circle cx="${x}" cy="${y}" r="${Math.max(1, step / 9)}"/>`);
  return `<rect x="0" y="${top}" width="${w}" height="${h - top}" fill="${c.bg}"/><g fill="${c.inkSoft}" fill-opacity="0.35">${dots.join("")}</g>`;
}

/** Maquette du site, `w` × `h` px, zone de l'élément surlignée. */
export function vignetteSvg(el: ElementId, c: Colors, w: number, h: number): string {
  const hh = Math.round(h * 0.12);
  let body = "";
  switch (el) {
    case "paysage":
      body = header(c, w, h) + landscape(c, w, hh, h) + hlArea(4, hh + 4, w - 8, h - hh - 8);
      break;
    case "signature":
      body = landscape(c, w, hh, h) + header(c, w, h, -1, true);
      break;
    case "papier":
      body = paperBackground(c, w, hh, h) + hlArea(4, hh + 4, w - 8, h - hh - 8) + strip(c, w, hh + h * 0.1) + header(c, w, h, 0);
      break;
    case "cadre":
      body = collectionEntries(c, w, hh, h) + header(c, w, h, -1);
      break;
    case "trait": {
      const ry = hh + h * 0.08;
      body =
        paperBackground(c, w, hh, h) +
        strip(c, w, ry + h * 0.06, { railHl: true }) +
        `<rect x="${w * 0.06}" y="${ry}" width="${w * 0.88}" height="${Math.max(2, h * 0.008)}" fill="${c.line}"/>` +
        hl(`<rect x="${w * 0.045}" y="${ry - h * 0.025}" width="${w * 0.91}" height="${h * 0.055}" rx="6"/>`) +
        header(c, w, h, 0) +
        hl(`<rect x="${w * 0.57}" y="${hh * 0.55}" width="${w * 0.09}" height="${hh * 0.32}" rx="5"/>`);
      break;
    }
    case "icones":
      body = paperBackground(c, w, hh, h) + strip(c, w, hh + h * 0.08, { arrowsHl: true, playHl: true }) + header(c, w, h, 0);
      break;
    case "scotch":
      body = paperBackground(c, w, hh, h) + strip(c, w, hh + h * 0.1, { tape: true }) + header(c, w, h, 0);
      break;
    case "siteicon":
      // Lot 83 : un onglet de navigateur, l'icône surlignée à gauche du nom.
      body =
        `<rect width="${w}" height="${h}" fill="${c.bgDeep}"/>` +
        `<rect x="${w * 0.04}" y="${h * 0.14}" width="${w * 0.5}" height="${h * 0.2}" rx="8" fill="${c.bg}"/>` +
        hl(`<rect x="${w * 0.065}" y="${h * 0.19}" width="${h * 0.1}" height="${h * 0.1}" rx="4"/>`) +
        `<rect x="${w * 0.065 + h * 0.14}" y="${h * 0.22}" width="${w * 0.24}" height="${Math.max(3, h * 0.035)}" rx="2" fill="${c.ink}"/>` +
        `<rect y="${h * 0.34}" width="${w}" height="${h * 0.66}" fill="${c.bg}"/>`;
      break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><clipPath id="v"><rect width="${w}" height="${h}" rx="10"/></clipPath></defs><g clip-path="url(#v)">${body}</g><rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="10" fill="none" stroke="#8a8f98" stroke-width="3"/></svg>`;
}

/** Icônes : la croix vit dans l'image agrandie, une 2e vignette la montre. */
export function closeVignetteSvg(c: Colors, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><clipPath id="v"><rect width="${w}" height="${h}" rx="10"/></clipPath></defs><g clip-path="url(#v)">${lightbox(c, w, h, false, true)}</g><rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="10" fill="none" stroke="#8a8f98" stroke-width="3"/></svg>`;
}
