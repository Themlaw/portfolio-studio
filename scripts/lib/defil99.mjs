/**
 * Dessins SYNTHÉTIQUES du lot 99 (jamais le kit de l'artiste) : la barre de défilement (calque « Trait ») et les flèches du kit, en
 * dégradés de couleurs avec saturation variable. Partagés par scripts/kit-poc/simulate-multi.mts (qui les pose dans les PSD du kit) et
 * par scripts/e2e-defilement99.mjs (qui en fait la référence au pixel près).
 */

/** Barre : case de 2400 × 160, dégradé rouge → orange → vert → bleu, éclaircie en haut (saturation plus faible), assombrie en bas. */
export const barSvg = (w = 2400, h = 160) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 2400 160"><defs>` +
  `<linearGradient id="h" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#e63946"/><stop offset="0.33" stop-color="#f4a300"/><stop offset="0.66" stop-color="#2a9d8f"/><stop offset="1" stop-color="#3a4fd7"/></linearGradient>` +
  `<linearGradient id="v" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.3"/></linearGradient>` +
  `</defs><rect x="40" y="24" width="2320" height="112" rx="56" fill="url(#h)"/><rect x="40" y="24" width="2320" height="112" rx="56" fill="url(#v)"/></svg>`;

/** Flèches : dessin de 368 × 320, posé à (72, 88) dans la case de 512 × 512 (calque rogné, comme Photoshop). */
export const ARROWS = {
  left: { d: "M360 112 H160 V16 L8 160 L160 304 V208 H360 Z", from: "#2a9d8f", to: "#3a4fd7" },
  right: { d: "M8 112 H208 V16 L360 160 L208 304 V208 H8 Z", from: "#f4a300", to: "#e63946" },
};
export const ARROW_BOX = { w: 368, h: 320, x: 72, y: 88, case: 512 };
export const arrowSvg = (which) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ARROW_BOX.w}" height="${ARROW_BOX.h}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${ARROWS[which].from}"/><stop offset="1" stop-color="${ARROWS[which].to}"/></linearGradient></defs><path d="${ARROWS[which].d}" fill="url(#g)"/></svg>`;
