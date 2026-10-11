import type { ThemeInput } from "../../schema";

/**
 * Pro — état du tag da/pro : même papier, étiquettes grises, calques du hero
 * plus neutres, images de bande à rayon --radius-sm (6px).
 *
 * Ajustements AA par rapport au tag (4,5:1 exigé sur bg, bgDeep et surface) :
 *  - inkSoft   #6b7076 → #696d73 (4,38:1 → 4,57:1 sur bgDeep) ;
 *  - secondary #c96f4a → #a95532 (3,15:1 → 4,57:1 sur bgDeep) : sert encore de
 *    texte (sous-titre de la page À propos).
 */
const theme = {
  id: "pro",
  name: "Pro",
  preset: true,
  tokens: {
    color: {
      bg: "#faf9f6",
      bgDeep: "#f2f0ea",
      surface: "#ffffff",
      ink: "#232629",
      inkSoft: "#696d73",
      line: "#e5e2db",
      primary: "#2e4e9e",
      primaryHover: "#24408a",
      onPrimary: "#ffffff",
      secondary: "#a95532",
      tertiary: "#7e8f77",
      // Halo papier serré autour des petits textes posés sur le décor du hero.
      heroHalo: "#faf9f6",
      // Dans Pro, les étiquettes sont grises : la sanguine reste un accent.
      eyebrow: "#696d73",
    },
    font: { display: "young-serif", body: "figtree", caption: "spline-sans-mono" },
    radius: { sm: "6px", md: "12px", lg: "20px", btn: "999px", strip: "6px" },
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
      "/themes/pro/hero/layer-1-sky.svg",
      "/themes/pro/hero/layer-2-far.svg",
      "/themes/pro/hero/layer-3-mid.svg",
      "/themes/pro/hero/layer-4-near.svg",
      "/themes/pro/hero/layer-5-fore.svg",
    ],
  },
} satisfies ThemeInput;

export default theme;
