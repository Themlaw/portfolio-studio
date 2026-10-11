import type { ThemeInput } from "../../schema";

/**
 * Planche de story — la feuille de production d'un storyboard : papier kraft,
 * cases au trait de graphite, crayon bleu de construction, crayon rouge pour
 * les mouvements de caméra. Le hero EST une planche (calques : feuille, cases,
 * croquis, annotations, scotch et crayon au premier plan). Titres au feutre
 * (Kalam), texte et légendes tapés à la machine (Courier Prime) comme les
 * indications de plan. Planches nettes, alignées comme des cases ; compact.
 *
 * Intentions (reportées dans les tokens à l'intégration des lots 2, 4, 5) :
 *  - espacements : rythme serré, 0,75 × celui de Pro ; légendes collées aux cases ;
 *  - styles typographiques : titres de section en Kalam 700, légendes en
 *    capitales tapées (Courier Prime, interlettrage 0,08em) ;
 *  - coins : 2 px partout (cases découpées au cutter).
 *  → layout (crans × 0,75, mediaRadius « none » : le plus proche des 2 px), type (h2 700, légendes capitales 0,08em) ; inkSoft et line (filet translucide) restent choisis.
 */
const theme = {
  id: "planche-de-story",
  name: "Planche de story",
  preset: true,
  tokens: {
    color: {
      bg: "#e9dcc2", // kraft clair
      bgDeep: "#e7d3ac",
      surface: "#f5eedf", // papier des cases
      ink: "#2a231b", // graphite
      inkSoft: "#5a4c3a",
      line: "rgba(42, 35, 27, 0.2)",
      primary: "#a3301d", // crayon rouge
      primaryHover: "#8f1a06",
      onPrimary: "#ffffff",
      secondary: "#2c5580", // crayon bleu
      tertiary: "#8a7350",
      heroHalo: "#e9dcc2",
    },
    // Palette (lot 4) : nuances dérivées de leur base (suivent une base changée
    // dans une copie) ; les autres restent choisies (caractère du thème).
    palette: { auto: ["bgDeep", "primaryHover", "onPrimary"] },
    font: { display: "kalam", body: "courier-prime", caption: "courier-prime" },
    radius: { sm: "2px", md: "3px", lg: "4px", btn: "2px", strip: "2px" },
    space: {
      sectionGap: "clamp(3rem, 6vw, 5.5rem)",
      pageMax: "1320px",
      gutter: "clamp(1rem, 4vw, 2.5rem)",
    },
    motion: { durFast: "140ms", durBase: "420ms", easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
    // Mise en page (lot 2) : 0,75 × les crans par défaut ; images à angles vifs.
    layout: {
      spaceS: "0.5rem",
      spaceM: "clamp(1.125rem, 2.25vw, 1.75rem)",
      spaceL: "clamp(1.875rem, 3.75vw, 3rem)",
      spaceXL: "clamp(3rem, 6vw, 4.875rem)",
      pageTop: "clamp(4.5rem, 10.5vh, 7.5rem)",
      stripPad: "clamp(2.25rem, 5.25vw, 4.125rem)",
      mediaRadius: "none",
    },
    // Typographie : titres de section au feutre gras, légendes tapées en capitales.
    type: {
      h2: { weight: 700 },
      caption: { case: "upper", tracking: 0.08 },
    },
  },
  variants: {
    header: "centered",
    hero: "parallax-layers",
    strip: "edge",
    caption: "mono-split",
    lightbox: "passe-partout",
    button: "square",
    texture: "paper-dots",
  },
  assets: {
    heroLayers: [
      "/themes/planche-de-story/hero/layer-1-kraft.svg",
      "/themes/planche-de-story/hero/layer-2-cases.svg",
      "/themes/planche-de-story/hero/layer-3-croquis.svg",
      "/themes/planche-de-story/hero/layer-4-camera.svg",
      "/themes/planche-de-story/hero/layer-5-scotch.svg",
    ],
  },
} satisfies ThemeInput;

export default theme;
