import type { ThemeInput } from "../schema";

/**
 * Galerie lumineuse — DA de référence (tag da/galerie-lumineuse).
 * Papier chaud, outremer pour l'action, sanguine pour les étiquettes.
 */
const theme = {
  id: "galerie-lumineuse",
  name: "Galerie lumineuse",
  preset: true,
  tokens: {
    color: {
      bg: "#faf9f6", // papier
      bgDeep: "#f2f0ea", // papier profond
      surface: "#ffffff",
      ink: "#232629",
      // Assombri pour tenir AA à 11px : 4,96:1 sur bg, 4,58:1 sur bgDeep.
      inkSoft: "#686d73",
      line: "#e5e2db",
      primary: "#2e4e9e", // outremer
      primaryHover: "#24408a",
      onPrimary: "#ffffff",
      // Sanguine profonde (eyebrows) : 5,09:1 sur bg, 4,71:1 sur bgDeep.
      secondary: "#a85231",
      tertiary: "#7e8f77", // sauge
      // Halo papier serré autour des petits textes posés sur le décor du hero.
      heroHalo: "#faf9f6",
    },
    font: { display: "young-serif", body: "figtree", caption: "spline-sans-mono" },
    radius: { sm: "6px", md: "12px", lg: "20px", btn: "999px", strip: "4px" },
    space: {
      sectionGap: "clamp(4.5rem, 10vw, 9rem)",
      pageMax: "1240px",
      gutter: "clamp(1.25rem, 5vw, 3.5rem)",
    },
    motion: { durFast: "180ms", durBase: "520ms", easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" },
  },
  variants: {
    header: "inline",
    hero: "parallax-layers",
    strip: "edge",
    caption: "mono-split",
    lightbox: "passe-partout",
    button: "pill",
    texture: "none",
  },
  assets: {
    heroLayers: [
      "/themes/galerie-lumineuse/hero/layer-1-sky.svg",
      "/themes/galerie-lumineuse/hero/layer-2-far.svg",
      "/themes/galerie-lumineuse/hero/layer-3-mid.svg",
      "/themes/galerie-lumineuse/hero/layer-4-near.svg",
      "/themes/galerie-lumineuse/hero/layer-5-fore.svg",
    ],
  },
} satisfies ThemeInput;

export default theme;
