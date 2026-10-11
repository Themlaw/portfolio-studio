import type { ThemeInput } from "../../schema";

/**
 * Salle de projection — direction sombre, test d'acceptation du moteur.
 * Nuit bleutée, ambre de projecteur pour l'action et le halo, lavande pour
 * les étiquettes. Pas de calques : un faisceau (hero spotlight).
 */
const theme = {
  id: "salle-de-projection",
  name: "Salle de projection",
  preset: true,
  tokens: {
    color: {
      bg: "#161b26",
      bgDeep: "#1c2230", // un cran plus clair : la salle s'éclaire vers l'écran
      surface: "#202637",
      ink: "#ede8dc",
      inkSoft: "#8b8fa3",
      line: "rgba(237, 232, 220, 0.14)",
      primary: "#e3a93e", // ambre
      primaryHover: "#f0bd5e",
      onPrimary: "#161b26", // texte sombre sur ambre
      secondary: "#8e93b8", // lavande (eyebrows)
      tertiary: "#6f9a97",
      accentGlow: "#e3a93e",
    },
    font: { display: "bricolage-grotesque", body: "figtree", caption: "spline-sans-mono" },
    radius: { sm: "6px", md: "12px", lg: "18px", btn: "999px", strip: "3px" },
    space: {
      sectionGap: "clamp(4.5rem, 10vw, 9rem)",
      pageMax: "1240px",
      gutter: "clamp(1.25rem, 5vw, 3.5rem)",
    },
    motion: { durFast: "180ms", durBase: "560ms", easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" },
  },
  variants: {
    header: "inline",
    hero: "spotlight",
    strip: "edge",
    caption: "mono-split",
    lightbox: "full-bleed",
    button: "pill",
    texture: "none",
  },
  assets: {},
} satisfies ThemeInput;

export default theme;
