import type { ThemeInput } from "../../schema";

/**
 * Carnet d'atelier — papier crème pointillé, planches scotchées, légendes
 * manuscrites. Hero typographique avec une note griffonnée.
 *
 * Ajustements AA (4,5:1 sur bg, bgDeep et surface) :
 *  - inkSoft   #857766 → #62584a (3,58:1 → 5,9:1 sur bg). Marge voulue :
 *    les légendes sont posées près d'images inclinées et de leur ombre, et
 *    sur la texture pointillée (mesure au pixel : check:contrast:render) ;
 *  - primary   #c4452f → #b13e2b (4,07:1 → 4,81:1 sur bg ; blanc dessus 5,8:1) ;
 *  - secondary #6b7040 → #63683b (3,96:1 → 4,61:1 sur bgDeep).
 */
const theme = {
  id: "carnet-d-atelier",
  name: "Carnet d'atelier",
  preset: true,
  tokens: {
    color: {
      bg: "#f1e8d8",
      bgDeep: "#ece3d1",
      surface: "#f8f2e7",
      ink: "#3a322a",
      inkSoft: "#62584a",
      line: "#dccfb8",
      primary: "#b13e2b", // coquelicot
      primaryHover: "#963323",
      onPrimary: "#ffffff",
      secondary: "#63683b", // olive (eyebrows)
      tertiary: "#9aa27a",
    },
    font: { display: "chelsea-market", body: "figtree", caption: "caveat" },
    radius: { sm: "4px", md: "8px", lg: "14px", btn: "999px", strip: "2px" },
    space: {
      sectionGap: "clamp(4.5rem, 10vw, 9rem)",
      pageMax: "1240px",
      gutter: "clamp(1.25rem, 5vw, 3.5rem)",
    },
    motion: { durFast: "180ms", durBase: "520ms", easing: "cubic-bezier(0.34, 1.3, 0.64, 1)" },
  },
  variants: {
    header: "centered",
    hero: "type-only",
    strip: "taped",
    caption: "handwritten",
    lightbox: "passe-partout",
    button: "pill",
    texture: "paper-dots",
  },
  assets: {
    heroNote: { fr: "mes dernières pages ↴", en: "my latest pages ↴" },
  },
} satisfies ThemeInput;

export default theme;
