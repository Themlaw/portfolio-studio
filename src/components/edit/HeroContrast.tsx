"use client";

import { useEffect, useRef, useState } from "react";

import { contrastRatio } from "@/themes/palette";

/**
 * Lisibilité des textes de l'ouverture sur le fond choisi dans l'éditeur.
 *
 * Mesure PAR PIXEL, comme `check:contrast:render` mais dans le navigateur de
 * l'éditeur : l'image (réduite) est rééchantillonnée sous chaque ligne de texte
 * avec la même géométrie que le rendu (cover + point focal + zoom du cadrage,
 * décalage de la parallaxe), puis le contraste WCAG est calculé avec la couleur
 * du texte ; le 5e centile (`P5`) doit passer le seuil (4,5:1, 3:1 en grand
 * corps). Les textes à halo (`.hero-halo`) comptent la part du fond recouverte
 * par le halo (`HALO_COVER`, estimation : le halo n'est pas rejoué).
 * Aucun effet sans fond choisi (le décor du thème est vérifié par le script).
 */
const P5 = 0.05;
const HALO_COVER = 0.8;
const GRID = [7, 3] as const;
const MAX_SIDE = 192;

type Rgb = [number, number, number];
type Measure = { ratio: number; need: number; label: string; top: number; left: number };
type Verdict = (Measure & { all: Measure[] }) | null;

const ctx2d = (() => {
  let c: CanvasRenderingContext2D | null = null;
  return () => (c ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true }));
})();

/** Couleur CSS quelconque → rgb + alpha (le navigateur normalise). */
function parseColor(css: string): { rgb: Rgb; a: number } | null {
  const c = ctx2d();
  if (!c || !css) return null;
  c.clearRect(0, 0, 1, 1);
  c.fillStyle = "transparent";
  c.fillStyle = css;
  c.fillRect(0, 0, 1, 1);
  const d = c.getImageData(0, 0, 1, 1).data;
  // Alpha lu sur fond transparent : la couleur est prémultipliée par le canevas.
  const a = d[3] / 255;
  if (a === 0) return { rgb: [0, 0, 0], a: 0 };
  return { rgb: [Math.round(d[0] / a), Math.round(d[1] / a), Math.round(d[2] / a)].map((v) => Math.min(255, v)) as Rgb, a };
}

const hex = (c: Rgb) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const ratioOf = (a: Rgb, b: Rgb) => contrastRatio(hex(a), hex(b));

let cache: { key: string; w: number; h: number; data: Uint8ClampedArray } | null = null;
function pixels(media: HTMLImageElement | HTMLVideoElement): { w: number; h: number; data: Uint8ClampedArray; iw: number; ih: number } | null {
  const iw = media instanceof HTMLImageElement ? media.naturalWidth : media.videoWidth;
  const ih = media instanceof HTMLImageElement ? media.naturalHeight : media.videoHeight;
  if (!iw || !ih) return null;
  const key = media instanceof HTMLImageElement ? media.currentSrc : "";
  if (key && cache?.key === key) return { ...cache, iw, ih };
  const k = Math.min(1, MAX_SIDE / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * k));
  const h = Math.max(1, Math.round(ih * k));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d", { willReadFrequently: true });
  if (!c) return null;
  try {
    c.drawImage(media, 0, 0, w, h);
    const data = c.getImageData(0, 0, w, h).data;
    if (key) cache = { key, w, h, data };
    return { w, h, data, iw, ih };
  } catch {
    return null; // image d'une autre origine : non mesurable
  }
}

/** Plus mauvais texte de l'ouverture (ratio / seuil le plus bas), ou null (rien à mesurer). */
export function measureHero(host: HTMLElement): Verdict {
  const media = host.querySelector<HTMLImageElement | HTMLVideoElement>(".hero-backdrop img, .hero-backdrop video");
  if (!media) return null;
  const px = pixels(media);
  if (!px) return null;
  const cs = getComputedStyle(media);
  const W = media.offsetWidth;
  const H = media.offsetHeight;
  if (!W || !H) return null;
  const wrap = media.closest<HTMLElement>(".hero-backdrop") ?? media;
  const wr = wrap.getBoundingClientRect();
  // Cadrage : zoom (matrice de transformation) autour de l'origine, point focal (object-position).
  const zoom = cs.transform && cs.transform !== "none" ? new DOMMatrix(cs.transform).a || 1 : 1;
  const [ox, oy] = cs.transformOrigin.split(" ").map((v) => parseFloat(v));
  const [fx, fy] = cs.objectPosition.split(" ").map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : 0.5));
  const s = Math.max(W / px.iw, H / px.ih);
  const offX = (W - px.iw * s) * (fx ?? 0.5);
  const offY = (H - px.ih * s) * (fy ?? 0.5);
  const at = (vx: number, vy: number): Rgb => {
    const lx = vx - wr.left;
    const ly = vy - wr.top;
    const bx = ox + (lx - ox) / zoom;
    const by = oy + (ly - oy) / zoom;
    const ix = Math.min(px.iw - 1, Math.max(0, (bx - offX) / s));
    const iy = Math.min(px.ih - 1, Math.max(0, (by - offY) / s));
    const cx = Math.min(px.w - 1, Math.floor((ix / px.iw) * px.w));
    const cy = Math.min(px.h - 1, Math.floor((iy / px.ih) * px.h));
    const o = (cy * px.w + cx) * 4;
    return [px.data[o], px.data[o + 1], px.data[o + 2]];
  };

  const all: Measure[] = [];
  const texts = host.querySelectorAll<HTMLElement>("h1, .eyebrow, [data-hero-text='role']");
  for (const el of texts) {
    if (!el.textContent?.trim() || el.closest(".pe-layer")) continue;
    const style = getComputedStyle(el);
    const fg = parseColor(style.color);
    if (!fg || fg.a === 0) continue;
    const haloColor = el.classList.contains("hero-halo") || el.closest(".hero-halo") ? parseColor(style.getPropertyValue("--halo").trim() || getComputedStyle(document.documentElement).getPropertyValue("--color-hero-halo").trim()) : null;
    const halo = haloColor && haloColor.a > 0 ? haloColor : null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 2 && r.height > 2);
    const ratios: number[] = [];
    for (const r of rects) {
      for (let i = 0; i < GRID[0]; i++) {
        for (let j = 0; j < GRID[1]; j++) {
          const vx = r.left + ((i + 0.5) / GRID[0]) * r.width;
          const vy = r.top + ((j + 0.5) / GRID[1]) * r.height;
          let bg = at(vx, vy);
          if (halo) bg = bg.map((v, k) => v * (1 - HALO_COVER * halo.a) + halo.rgb[k] * HALO_COVER * halo.a) as Rgb;
          // Texte translucide : mélangé au fond.
          const f = fg.a < 1 ? (fg.rgb.map((v, k) => v * fg.a + bg[k] * (1 - fg.a)) as Rgb) : fg.rgb;
          ratios.push(ratioOf(f, bg));
        }
      }
    }
    if (!ratios.length) continue;
    ratios.sort((a, b) => a - b);
    const p5 = ratios[Math.floor((ratios.length - 1) * P5)];
    const size = parseFloat(style.fontSize);
    const bold = parseInt(style.fontWeight, 10) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const label = el.matches("h1") ? "le nom" : el.matches("[data-hero-text='role']") ? "le métier" : el.closest("[data-inline='scroll']") || el.matches("[data-inline='scroll']") ? "l'indicateur de défilement" : "l'étiquette";
    all.push({ ratio: Math.round(p5 * 100) / 100, need, label, top: rects[0].top + window.scrollY, left: rects[0].left + window.scrollX });
  }
  if (!all.length) return null;
  const worst = all.reduce((a, b) => (b.ratio / b.need < a.ratio / a.need ? b : a));
  return { ...worst, all };
}

/**
 * Avertissement posé en haut de l'ouverture quand un texte n'est plus lisible sur le fond choisi.
 * Remesure au chargement d'une image, au redimensionnement et à intervalle régulier.
 */
export default function HeroContrast() {
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const run = () => {
      // Seules les ouvertures à fond visuel (calques, projecteur) portent `data-edit-media`.
      const section = document.querySelector<HTMLElement>(".hero[data-edit-media]");
      if (!section) {
        setVerdict(null);
        return;
      }
      const v = measureHero(section);
      const next = v && v.ratio < v.need ? v : null;
      setVerdict((prev) => (prev && next && prev.ratio === next.ratio && prev.label === next.label ? prev : next));
      (window as unknown as { __heroContrast?: Verdict }).__heroContrast = v;
      const r = section.getBoundingClientRect();
      const top = Math.round(r.top + window.scrollY);
      const left = Math.round(r.left + window.scrollX);
      setAnchor((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    };
    const later = (ms = 250) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(run, ms);
    };
    later(400);
    // Le cadrage, le fond et la parallaxe changent le DOM sans événement fiable
    // (styles réécrits à chaque image) : une mesure légère toutes les 1,2 s suffit.
    const poll = setInterval(() => document.visibilityState === "visible" && run(), 1200);
    const onLoad = () => later(50);
    const onResize = () => later();
    document.addEventListener("load", onLoad, true);
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer.current);
      clearInterval(poll);
      document.removeEventListener("load", onLoad, true);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  if (!verdict || !anchor) return null;
  return (
    <p className="pe-hero-warn" role="status" data-testid="hero-contrast-warning" data-measures={JSON.stringify(verdict.all.map((m) => [m.label, m.ratio, m.need]))} style={{ top: anchor.top + 12, left: anchor.left + 16 }}>
      Sur ce fond, {verdict.label} est peu lisible ({verdict.ratio.toLocaleString("fr-FR")}:1, il faut {verdict.need.toLocaleString("fr-FR")}:1). Choisis une image plus calme, plus sombre ou plus claire, ou recadre-la.
    </p>
  );
}
