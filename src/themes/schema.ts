/**
 * Schéma d'un thème : tokens + variantes + assets (docs/ARCHITECTURE.md).
 *
 * Un thème est une donnée JSON-sérialisable : aujourd'hui un preset TS,
 * demain une ligne en base éditée depuis l'admin. Toutes les valeurs finissent
 * dans une feuille `:root{…}` émise par le layout : le schéma est donc aussi
 * la barrière anti-injection CSS (pas de `;`, `{`, `}`, `<`, `>` possibles).
 *
 * Ce fichier ne doit importer que `zod` : les scripts Node (check-contrast)
 * le chargent directement, sans bundler.
 */
import { z } from "zod";

/** Couleur : #rgb, #rrggbb, #rrggbbaa, ou rgb()/rgba() littéral. */
const color = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/,
    "couleur attendue : #hex ou rgb()/rgba()",
  );

/** Couleur de texte : hex opaque obligatoire (le contraste AA doit être calculable). */
const opaqueColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "couleur opaque attendue : #rgb ou #rrggbb");

/** Valeur CSS simple (longueur, clamp(), cubic-bezier()…) sans caractère de rupture. */
const cssValue = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9\s.,%()+\-*/#]+$/, "valeur CSS invalide")
  // Pas de chargement externe ni de commentaire qui masquerait une suite.
  .refine((v) => !/url\(|expression\(|\/\*|\*\/|\\|@/i.test(v), "valeur CSS invalide");

export const FONT_IDS = [
  "young-serif",
  "figtree",
  "spline-sans-mono",
  "bricolage-grotesque",
  "chelsea-market",
  "caveat",
] as const;
export const fontId = z.enum(FONT_IDS);
export type FontId = z.infer<typeof fontId>;

const localized = z.object({ fr: z.string().min(1).max(160), en: z.string().min(1).max(160) });

export const ThemeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/).max(80),
    name: z.string().trim().min(1, "Donne un nom au thème.").max(80, "80 caractères au plus."),
    /** Preset livré : non supprimable, dupliquable. */
    preset: z.boolean(),
    tokens: z.object({
      color: z.object({
        bg: opaqueColor,
        /** Fond « profond » : sépare deux sections sans bordure. */
        bgDeep: opaqueColor,
        surface: opaqueColor,
        ink: opaqueColor,
        inkSoft: opaqueColor,
        line: color,
        primary: opaqueColor,
        primaryHover: opaqueColor,
        onPrimary: opaqueColor,
        secondary: opaqueColor,
        tertiary: color,
        /** Couleur des étiquettes (eyebrows). Défaut : secondary. */
        eyebrow: opaqueColor.optional(),
        /** Halo lumineux (hero spotlight, images). Absent = pas de halo. */
        accentGlow: color.optional(),
        /** Halo typographique des petits textes posés sur les calques du hero
         *  parallaxe (en général la couleur du fond). Absent = aucun halo. */
        heroHalo: opaqueColor.optional(),
      }),
      font: z.object({ display: fontId, body: fontId, caption: fontId }),
      radius: z.object({
        sm: cssValue,
        md: cssValue,
        lg: cssValue,
        btn: cssValue,
        strip: cssValue,
      }),
      space: z.object({ sectionGap: cssValue, pageMax: cssValue, gutter: cssValue }),
      motion: z.object({ durFast: cssValue, durBase: cssValue, easing: cssValue }),
    }),
    variants: z.object({
      header: z.enum(["inline", "centered"]),
      hero: z.enum(["parallax-layers", "spotlight", "type-only"]),
      strip: z.enum(["edge", "taped"]),
      caption: z.enum(["mono-split", "handwritten"]),
      lightbox: z.enum(["passe-partout", "full-bleed"]),
      button: z.enum(["pill", "square"]),
      texture: z.enum(["none", "paper-dots"]),
    }),
    assets: z.object({
      /** Calques du hero parallaxe, de l'arrière-plan vers l'avant (chemins publics). */
      heroLayers: z
        .array(
          z
            .string()
            .max(200)
            .regex(/^\/themes\/[\w-]+\/[\w./-]+$/)
            .refine((v) => !v.includes("..") && !v.includes("//"), "chemin invalide"),
        )
        .max(8)
        .optional(),
      /** Note manuscrite du hero type-only. */
      heroNote: localized.optional(),
    }),
  })
  .strict();

export type Theme = z.infer<typeof ThemeSchema>;
/** Forme d'entrée d'un preset (avant validation). */
export type ThemeInput = z.input<typeof ThemeSchema>;
export type ThemeVariants = Theme["variants"];
