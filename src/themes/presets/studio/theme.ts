import type { ThemeInput } from "../../schema";

/**
 * Studio — le portfolio d'un studio d'animation qui présente son travail à
 * des directeurs artistiques : grille stricte, blanc maîtrisé mais COMPACT
 * (le thème le plus dense), une seule couleur d'action (cobalt), tout le reste
 * en gris. Ouverture = planche-contact : le nom en très grand sur une grille
 * de 12 colonnes au filet, une rangée de photogrammes en haut à droite dont la
 * prise retenue en cobalt, des hirondelles de coupe (calques SVG, aucune
 * image du portfolio). Inter Tight pour les titres et le texte, IBM Plex Mono
 * pour les légendes. Angles vifs, planches au cordeau.
 *
 * Intentions (reportées dans les tokens à l'intégration des lots 2, 4, 5) :
 *  - espacements : grille de 8 px, sections à 0,5 × Pro, gouttière 16–32 px ;
 *  - styles typographiques : titres serrés (interlettrage −0,02em),
 *    légendes mono en bas de casse ;
 *  - coins : 0 partout.
 *  → layout (grille de 8 px, mediaRadius « none »), type (titres −0,02em, légendes bas de casse), toutes les nuances enregistrées en auto (gris dérivés).
 */
const theme = {
  id: "studio",
  name: "Studio",
  preset: true,
  tokens: {
    color: {
      bg: "#fbfbfa",
      bgDeep: "#f3f3f1",
      surface: "#ffffff",
      ink: "#141414",
      inkSoft: "#5b5b5a",
      line: "#dbdbda",
      primary: "#1f3fd1", // cobalt
      primaryHover: "#1428bc",
      onPrimary: "#ffffff",
      secondary: "#283a8c",
      tertiary: "#c9c9c3",
      eyebrow: "#5c5c5c",
      heroHalo: "#fbfbfa",
    },
    // Palette (lot 4) : nuances dérivées de leur base (suivent une base changée
    // dans une copie) ; les autres restent choisies (caractère du thème).
    palette: { auto: ["bgDeep", "line", "inkSoft", "primaryHover", "onPrimary"] },
    font: { display: "inter-tight", body: "inter-tight", caption: "ibm-plex-mono" },
    radius: { sm: "0px", md: "0px", lg: "0px", btn: "0px", strip: "0px" },
    space: {
      sectionGap: "clamp(2.5rem, 5vw, 4.5rem)",
      pageMax: "1440px",
      gutter: "clamp(1rem, 3vw, 2rem)",
    },
    motion: { durFast: "120ms", durBase: "300ms", easing: "cubic-bezier(0.2, 0, 0, 1)" },
    // Mise en page (lot 2) : grille de 8 px, sections à ~0,5 × Pro ; angles vifs.
    layout: {
      spaceS: "0.5rem",
      spaceM: "1rem",
      spaceL: "clamp(1.5rem, 3vw, 2rem)",
      spaceXL: "clamp(2rem, 4vw, 3rem)",
      pageTop: "clamp(3rem, 7vh, 5rem)",
      stripPad: "clamp(1.5rem, 3.5vw, 2.5rem)",
      mediaRadius: "none",
    },
    // Typographie : titres serrés, légendes mono en bas de casse.
    type: {
      h1: { tracking: -0.02 },
      h2: { tracking: -0.02 },
      caption: { case: "normal", tracking: 0 },
    },
  },
  variants: {
    header: "inline",
    hero: "parallax-layers",
    strip: "edge",
    caption: "mono-split",
    lightbox: "passe-partout",
    button: "square",
    texture: "none",
  },
  assets: {
    heroLayers: [
      "/themes/studio/hero/layer-1-grille.svg",
      "/themes/studio/hero/layer-2-planche.svg",
      "/themes/studio/hero/layer-3-prise.svg",
      "/themes/studio/hero/layer-4-reperes.svg",
    ],
  },
} satisfies ThemeInput;

export default theme;
