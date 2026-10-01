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

/**
 * Éléments dessinés du kit PSD (docs/THEME-KIT.md), produits par le pipeline
 * du kit et rangés sous /media/kit/<hash>.<ext> (contenu adressé : immuable).
 * Tout est facultatif : sans asset, le thème garde son rendu CSS actuel.
 */
const kitPath = (ext: string) => z.string().regex(new RegExp(`^/media/kit/[0-9a-f]{16}\\.${ext}$`), "chemin de kit invalide");
const kitImage = z
  .object({
    svg: kitPath("svg").optional(),
    avif: kitPath("avif").optional(),
    webp: kitPath("webp").optional(),
    /** Taille de l'asset rogné (px de la toile du kit). */
    w: z.number().int().min(1).max(4096),
    h: z.number().int().min(1).max(4096),
    /** Aperçu flou (ThumbHash, base64) pendant le chargement. */
    thumbhash: z.string().regex(/^[A-Za-z0-9+/]{8,64}={0,2}$/).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.svg || (v.avif && v.webp)), "SVG, ou AVIF et WebP");
const kitPlan = z
  .object({
    svg: kitPath("svg").optional(),
    avif: kitPath("avif").optional(),
    webp: kitPath("webp").optional(),
    w: z.number().int().min(1).max(2880),
    h: z.number().int().min(1).max(1600),
    /** Position dans la toile du hero (2880 × 1600). */
    x: z.number().int().min(0).max(2880),
    y: z.number().int().min(0).max(1600),
    thumbhash: z.string().regex(/^[A-Za-z0-9+/]{8,64}={0,2}$/).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.svg || (v.avif && v.webp)), "SVG, ou AVIF et WebP");
/**
 * Opacité par défaut du papier superposé au hero : discrète, le grain doit se
 * sentir sans voiler le paysage. Plafond : au-delà, la tuile se lit en motif.
 */
export const PAPER_OVER_HERO_DEFAULT = 0.35;
export const PAPER_OVER_HERO_MAX = 0.6;

export const KitAssetsSchema = z
  .object({
    /** Plans du hero 1 (ciel) à 5 ; null : le calque SVG actuel du thème. */
    plans: z.array(kitPlan.nullable()).max(5).optional(),
    signature: kitImage.optional(),
    paper: z
      .object({
        image: kitImage,
        /** Opacité de la tuile superposée au hero (grain du paysage), défaut PAPER_OVER_HERO_DEFAULT ; absente : pas de superposition. */
        overHero: z.number().min(0).max(PAPER_OVER_HERO_MAX).optional(),
      })
      .strict()
      .optional(),
    frame: z
      .object({
        image: kitImage,
        /** Marges de découpe du 9-slice (px de l'image) : haut, droite, bas, gauche. */
        slice: z.tuple([z.number().int().min(1).max(200), z.number().int().min(1).max(200), z.number().int().min(1).max(200), z.number().int().min(1).max(200)]),
      })
      .strict()
      .optional(),
    stroke: kitImage.optional(),
    icons: z
      .object({ arrowLeft: kitImage.optional(), arrowRight: kitImage.optional(), close: kitImage.optional(), play: kitImage.optional() })
      .strict()
      .optional(),
    tape: kitImage.optional(),
  })
  .strict();
export type KitAssets = z.infer<typeof KitAssetsSchema>;
export type KitImage = z.infer<typeof kitImage>;
export type KitPlan = z.infer<typeof kitPlan>;

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
      /** Éléments dessinés du kit PSD (tous facultatifs). */
      kit: KitAssetsSchema.optional(),
    }),
  })
  .strict();

export type Theme = z.infer<typeof ThemeSchema>;
/** Forme d'entrée d'un preset (avant validation). */
export type ThemeInput = z.input<typeof ThemeSchema>;
export type ThemeVariants = Theme["variants"];
