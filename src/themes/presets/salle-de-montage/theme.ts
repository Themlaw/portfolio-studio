import type { ThemeInput } from "../../schema";

/**
 * Salle de montage — la table de montage plutôt que la salle de projection :
 * noir vert de console, sarcelle des pistes de la timeline pour l'action,
 * jaune du crayon gras pour les étiquettes, rouge des marques de coupe. Hero
 * typographique en capitales condensées (Big Shoulders, comme les claps) avec
 * le compteur de bobine en marge ; texte en IBM Plex Sans, légendes en
 * IBM Plex Mono (timecodes). Visionneuse plein cadre, angles vifs.
 * Différences avec Salle de projection : vert-noir et sarcelle (pas de nuit
 * bleue ni d'ambre), hero typographique (pas de faisceau), boutons carrés.
 *
 * Intentions (reportées dans les tokens à l'intégration des lots 2, 4, 5) :
 *  - espacements serrés comme une timeline (0,7 × Pro) ;
 *  - styles typographiques : titres en capitales Big Shoulders 800,
 *    légendes en mono tabulaire ;
 *  - coins : 0 à 2 px.
 *  → layout (crans × 0,7, mediaRadius « none »), type (titres capitales 800 ; légendes déjà en mono) ; line (filet translucide) reste choisi.
 */
const theme = {
  id: "salle-de-montage",
  name: "Salle de montage",
  preset: true,
  tokens: {
    color: {
      bg: "#0f1413",
      bgDeep: "#121a19",
      surface: "#1b2220",
      ink: "#e6ebe5",
      inkSoft: "#929793",
      line: "rgba(230, 235, 229, 0.13)",
      primary: "#5cc2ae", // piste de la timeline
      primaryHover: "#70d6c1",
      onPrimary: "#0f1413",
      secondary: "#e3c15a", // crayon gras
      tertiary: "#c8645c", // marque de coupe
    },
    // Palette (lot 4) : nuances dérivées de leur base (suivent une base changée
    // dans une copie) ; les autres restent choisies (caractère du thème).
    palette: { auto: ["bgDeep", "inkSoft", "primaryHover", "onPrimary"] },
    font: { display: "big-shoulders", body: "ibm-plex-sans", caption: "ibm-plex-mono" },
    radius: { sm: "2px", md: "3px", lg: "4px", btn: "2px", strip: "0px" },
    space: {
      sectionGap: "clamp(3rem, 6vw, 5rem)",
      pageMax: "1400px",
      gutter: "clamp(1rem, 3.5vw, 2.25rem)",
    },
    motion: { durFast: "120ms", durBase: "360ms", easing: "cubic-bezier(0.3, 0, 0.2, 1)" },
    // Mise en page (lot 2) : 0,7 × les crans par défaut (timeline serrée), angles vifs.
    layout: {
      spaceS: "0.5rem",
      spaceM: "clamp(1rem, 2.1vw, 1.5rem)",
      spaceL: "clamp(1.75rem, 3.5vw, 2.75rem)",
      spaceXL: "clamp(2.75rem, 5.6vw, 4.5rem)",
      pageTop: "clamp(4.25rem, 10vh, 7rem)",
      stripPad: "clamp(2rem, 5vw, 3.875rem)",
      mediaRadius: "none",
    },
    // Typographie : titres en capitales Big Shoulders 800 (clap).
    type: {
      h1: { case: "upper", weight: 800 },
      h2: { case: "upper", weight: 800 },
    },
  },
  variants: {
    header: "inline",
    hero: "type-only",
    strip: "edge",
    caption: "mono-split",
    lightbox: "full-bleed",
    button: "square",
    texture: "none",
  },
  assets: {
    heroNote: { fr: "bobine 1 — 00:00:00:00", en: "reel 1 — 00:00:00:00" },
  },
} satisfies ThemeInput;

export default theme;
