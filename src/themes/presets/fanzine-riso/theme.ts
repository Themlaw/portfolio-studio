import type { ThemeInput } from "../../schema";

/**
 * Fanzine riso — un zine imprimé en risographie sur papier jaune pâle : deux
 * encres (bleu riso et rose fluo) qui se chevauchent avec un léger défaut de
 * repérage, trames de points, planches collées au scotch. Le hero est une
 * couverture de zine (calques : papier tramé, aplats bleus, aplats roses
 * décalés, trame, gribouillis). Titres très gras (Bowlby One), texte en
 * Space Grotesk, légendes en IBM Plex Mono ; boutons en pastille.
 * L'encre du texte est un bleu nuit (lisible) ; le rose fluo ne sert qu'au
 * décor, sa version foncée aux étiquettes.
 *
 * Intentions (reportées dans les tokens à l'intégration des lots 2, 4, 5) :
 *  - espacements : 0,7 × Pro ;
 *  - styles typographiques : titres de section en Bowlby One, légendes en
 *    capitales mono ;
 *  - coins : 0 pour les planches, pastille pour les boutons.
 *  → layout (crans × 0,7, mediaRadius « none »), type (légendes capitales) ; inkSoft (bleu nuit) et line (translucide) restent choisis.
 */
const theme = {
  id: "fanzine-riso",
  name: "Fanzine riso",
  preset: true,
  tokens: {
    color: {
      bg: "#fbf2c9", // papier jaune pâle
      bgDeep: "#f8eaab",
      surface: "#fffaf0",
      ink: "#1d1b3d", // encre bleu nuit
      inkSoft: "#4a4766",
      line: "rgba(29, 27, 61, 0.18)",
      primary: "#0b5bc2", // bleu riso
      primaryHover: "#004aa6",
      onPrimary: "#ffffff",
      secondary: "#b5145f", // rose fluo, version encre
      tertiary: "#ff5fa2", // rose fluo (décor)
      heroHalo: "#fbf2c9",
    },
    // Palette (lot 4) : nuances dérivées de leur base (suivent une base changée
    // dans une copie) ; les autres restent choisies (caractère du thème).
    palette: { auto: ["bgDeep", "primaryHover", "onPrimary"] },
    font: { display: "bowlby-one", body: "space-grotesk", caption: "ibm-plex-mono" },
    radius: { sm: "4px", md: "8px", lg: "14px", btn: "999px", strip: "0px" },
    space: {
      sectionGap: "clamp(3rem, 7vw, 6rem)",
      pageMax: "1320px",
      gutter: "clamp(1rem, 4vw, 2.5rem)",
    },
    motion: { durFast: "160ms", durBase: "480ms", easing: "cubic-bezier(0.34, 1.4, 0.64, 1)" },
    // Mise en page (lot 2) : 0,7 × les crans par défaut ; planches sans arrondi
    // (les boutons gardent leur pastille : radius.btn).
    layout: {
      spaceS: "0.5rem",
      spaceM: "clamp(1rem, 2.1vw, 1.5rem)",
      spaceL: "clamp(1.75rem, 3.5vw, 2.75rem)",
      spaceXL: "clamp(2.75rem, 5.6vw, 4.5rem)",
      pageTop: "clamp(4.25rem, 10vh, 7rem)",
      stripPad: "clamp(2rem, 5vw, 3.875rem)",
      mediaRadius: "none",
    },
    // Typographie : légendes en capitales mono.
    type: {
      caption: { case: "upper", tracking: 0.06 },
    },
  },
  variants: {
    header: "inline",
    hero: "parallax-layers",
    strip: "taped",
    caption: "mono-split",
    lightbox: "passe-partout",
    button: "pill",
    texture: "paper-dots",
  },
  assets: {
    heroLayers: [
      "/themes/fanzine-riso/hero/layer-1-papier.svg",
      "/themes/fanzine-riso/hero/layer-2-bleu.svg",
      "/themes/fanzine-riso/hero/layer-3-rose.svg",
      "/themes/fanzine-riso/hero/layer-4-trame.svg",
      "/themes/fanzine-riso/hero/layer-5-gribouillis.svg",
    ],
  },
} satisfies ThemeInput;

export default theme;
