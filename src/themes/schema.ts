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
  // Thèmes livrés v0.14 (docs/THEMES.md) : toutes OFL, via next/font (auto-hébergées).
  "kalam",
  "courier-prime",
  "big-shoulders",
  "ibm-plex-sans",
  "ibm-plex-mono",
  "inter-tight",
  "bowlby-one",
  "space-grotesk",
] as const;
export const fontId = z.enum(FONT_IDS);

/**
 * Carte de rubrique (lot 17c, src/themes/surface.ts) : jetons de la palette proposés comme fond, et réglages
 * d'une carte. Définis ICI (zod seul : ce fichier est chargé tel quel par Node), repris par surface.ts.
 * `#rrggbb[aa]` en minuscules : le format de CUSTOM_COLOR_RE (src/lib/color.ts, vérifié par test-surface).
 *
 * Lot 19b : « tertiary » (Ornements) et des TEINTES DOUCES dérivées, `<couleur><12|25>` : la couleur mélangée à 12 % ou
 * 25 % au fond de page, recalculée à chaque rendu. Un jeton, jamais un hex figé : il suit tout changement de palette.
 */
export const SURFACE_BASE_TOKENS = ["bg", "bgDeep", "surface", "primary", "secondary", "ink", "tertiary"] as const;
export const SURFACE_TINT_BASES = ["ink", "primary", "secondary", "tertiary"] as const;
export const SURFACE_TINT_PERCENTS = [12, 25] as const;
export const SURFACE_TINTS = SURFACE_TINT_BASES.flatMap((b) => SURFACE_TINT_PERCENTS.map((n) => `${b}${n}` as `${(typeof SURFACE_TINT_BASES)[number]}${(typeof SURFACE_TINT_PERCENTS)[number]}`));
export const SURFACE_TOKENS = [...SURFACE_BASE_TOKENS, ...SURFACE_TINTS] as const;
export const SURFACE_WIDTHS = ["full", "inset"] as const;
export const SURFACE_CORNERS = ["square", "round"] as const;
/** Coins d'une carte (lot 47b) : « round » = l'arrondi d'avant (rayon du thème, lu tel quel), « s / m / l » = les mêmes tailles que le fond d'un composant. */
export const SURFACE_CORNER_VALUES = ["square", "round", "s", "m", "l"] as const;
/** Couleur d'un aplat (carte, bordure, fond de composant) : un jeton de la palette ou `#rrggbb[aa]`. */
export const SurfaceColorSchema = z.union([z.enum(SURFACE_TOKENS), z.string().max(9).regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/, "Couleur invalide (#rrggbb).")]);
/** Bordure d'une carte (lot 32) : épaisseurs Fin / Moyen / Épais (≈ 2 / 6 / 12 px, plus fines sur téléphone). */
export const SURFACE_BORDER_WIDTHS = ["thin", "medium", "thick"] as const;
/**
 * `false` = pas de bordure (même si le thème en donne une par défaut) ; objet = bordure, épaisseur (Moyen par défaut) et couleur
 * (absente = la couleur lisible du texte de la carte). Clé absente = comme le thème.
 */
export const SurfaceBorderSchema = z.union([z.literal(false), z.strictObject({ width: z.enum(SURFACE_BORDER_WIDTHS).optional(), color: SurfaceColorSchema.optional() })]);
/** Réglages de base d'une carte (couleur, largeur, coins, bordure) : ceux que porte aussi la carte par défaut d'un thème. */
export const SurfaceBaseSchema = z.strictObject({
  color: SurfaceColorSchema.optional(),
  width: z.enum(SURFACE_WIDTHS).optional(),
  corners: z.enum(SURFACE_CORNER_VALUES).optional(),
  border: SurfaceBorderSchema.optional(),
});

/**
 * Fond d'un composant (lot 32) : `props.background` de tout grand composant. Union discriminée par `kind` pour que d'autres
 * natures de fond (un papier peint importé, lot 35) s'ajoutent sans toucher aux fonds de couleur déjà enregistrés.
 */
export const BACKGROUND_KINDS = ["color", "wallpaper"] as const;
/**
 * Papier peint (lot 35) : largeur d'une tuile en px (24 à 1200) et opacité (0 à 100 % : lot 66, R6, le curseur descend à 0). Mêmes bornes pour le papier d'une page, d'une
 * carte et d'un composant ; absent = le réglage du motif dans la bibliothèque.
 */
export const WALLPAPER_SIZE_MIN = 24;
export const WALLPAPER_SIZE_MAX = 1200;
export const WALLPAPER_OPACITY_MIN = 0;
export const WallpaperIdSchema = z.number().int().positive();
export const WallpaperSizeSchema = z.number().int().min(WALLPAPER_SIZE_MIN).max(WALLPAPER_SIZE_MAX);
export const WallpaperOpacitySchema = z.number().min(WALLPAPER_OPACITY_MIN).max(1);
/** Tailles S / M / L (lot 43) : marge autour du fond (`inset`) et arrondi de ses coins (`round`). Absent = comportement d'avant (bord à bord, coins droits). */
export const FOND_STEPS = ["s", "m", "l"] as const;
const FondStepSchema = z.enum(FOND_STEPS);
/**
 * Papier du site sur un fond (lot 66, R5) : `under` = le papier du site (papier du kit ou papier peint des cartes, que le site dessine sur
 * les cartes et les fonds) n'est PAS redessiné sur ce fond ; absent = comme le site (rendu d'avant, au pixel).
 */
export const FondPaperSchema = z.literal("under");
export const BackgroundSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("color"), color: SurfaceColorSchema, inset: FondStepSchema.optional(), round: FondStepSchema.optional(), paper: FondPaperSchema.optional() }),
  // Un motif de la bibliothèque, une couleur facultative DESSOUS (même choix que « Couleur »), taille et opacité facultatives.
  z.strictObject({ kind: z.literal("wallpaper"), wallpaper: WallpaperIdSchema, color: SurfaceColorSchema.optional(), size: WallpaperSizeSchema.optional(), opacity: WallpaperOpacitySchema.optional(), inset: FondStepSchema.optional(), round: FondStepSchema.optional(), paper: FondPaperSchema.optional() }),
]);
/** Papier peint d'UNE PAGE (lot 35) : absent = celui du site (rien ne change) ; `none` = aucun ; sinon un motif. */
export const PagePaperSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("none") }),
  z.strictObject({ mode: z.literal("wallpaper"), wallpaper: WallpaperIdSchema, size: WallpaperSizeSchema.optional(), opacity: WallpaperOpacitySchema.optional() }),
]);
/** Papier peint par défaut des cartes du site (réglage du site) : un motif, taille et opacité facultatives. */
export const CardWallpaperSchema = z.strictObject({ wallpaper: WallpaperIdSchema, size: WallpaperSizeSchema.optional(), opacity: WallpaperOpacitySchema.optional() });
/** Papier du site sur une carte (lot 28) : `under` = caché sous la carte (rendu d'avant), `over` = dessiné sur sa couleur, sous le contenu ; absent = comme le site. */
export const SURFACE_PAPERS = ["under", "over"] as const;
/** Une carte de rubrique : réglages de base + papier. `paperOpacity` : 0 à 0,6 (PAPER_OVER_HERO_MAX ; au-delà le texte se lit mal) ; absente = intensité du site. */
export const SurfaceSchema = SurfaceBaseSchema.extend({
  paper: z.enum(SURFACE_PAPERS).optional(),
  paperOpacity: z.number().min(0).max(0.6).optional(),
  /** Lot 35 : un motif de la bibliothèque à la place du papier du kit (la carte le montre « dessus » ; `paper: under` le cache). */
  paperWallpaper: WallpaperIdSchema.optional(),
  paperSize: WallpaperSizeSchema.optional(),
});

/**
 * Carte par défaut d'un thème, lue avec tolérance : une valeur que cette version ne connaît pas (un jeton de teinte
 * ajouté par une version suivante, par exemple) est ignorée et retombe sur la valeur par défaut, au lieu de faire
 * rejeter le thème entier. Les clés inconnues restent refusées (schéma strict).
 */
const LenientSurfaceSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k !== "color" && k !== "width" && k !== "corners" && k !== "border") out[k] = v;
    else if (SurfaceBaseSchema.safeParse({ [k]: v }).success) out[k] = v;
  }
  return out;
}, SurfaceBaseSchema);

/** Rôles typographiques (styles du site du lot 2, typographie du thème). */
export const TEXT_ROLES = ["h1", "h2", "eyebrow", "body", "caption", "menu", "brand"] as const;
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
    /** Signature en couleurs (lot 49) : affichée telle quelle, jamais en masque teinté par le thème. */
    colors: z.literal(true).optional(),
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
/** Intensité du papier sur les cartes quand ni le site ni la carte ne la précisent : comme sur le hero. */
export const PAPER_ON_CARDS_DEFAULT = PAPER_OVER_HERO_DEFAULT;

/* ---- Curseurs (lot 4) ----
 * PNG 32 × 32 (1x) et 64 × 64 (2x, écrans HiDPI), dessinés dans le kit (case
 * 64 × 64 = 32 px CSS) ; point chaud en px CSS (0–31). Rendu : css.ts
 * (`--t-cursor-*`), variants.css. */
const kitCursor = z
  .object({ png: kitPath("png"), png2x: kitPath("png"), x: z.number().int().min(0).max(31), y: z.number().int().min(0).max(31) })
  .strict();
export type KitCursor = z.infer<typeof kitCursor>;
/* ---- fin Curseurs (lot 4) ---- */

export const KitAssetsSchema = z
  .object({
    /** Plans du hero, du plus lointain à l'avant (au plus 8) ; null : le calque SVG de même rang du thème. */
    plans: z.array(kitPlan.nullable()).max(8).optional(),
    /** Décor libre du kit v4 : les plans ci-dessus sont TOUT le décor (les calques SVG du thème ne s'y ajoutent pas). */
    plansOnly: z.boolean().optional(),
    signature: kitImage.optional(),
    paper: z
      .object({
        image: kitImage,
        /** Opacité de la tuile superposée au hero (grain du paysage), défaut PAPER_OVER_HERO_DEFAULT ; absente : pas de superposition. */
        overHero: z.number().min(0).max(PAPER_OVER_HERO_MAX).optional(),
        /** Tuile aussi sous le bandeau du haut (collant) ; absent / false : le bandeau est un aplat de la couleur de fond. */
        underHeader: z.boolean().optional(),
        /** Lot 28 : le papier est aussi dessiné sur les cartes de rubrique (par-dessus leur couleur, sous leur contenu) ; absent / false : caché sous la carte. Chaque carte peut surcharger. */
        onCards: z.boolean().optional(),
        /** Intensité du papier sur les cartes, défaut PAPER_ON_CARDS_DEFAULT. */
        onCardsOpacity: z.number().min(0).max(PAPER_OVER_HERO_MAX).optional(),
      })
      .strict()
      .optional(),
    frame: z
      .object({
        image: kitImage,
        /** Marges de découpe du 9-slice (px de l'image) : haut, droite, bas, gauche. */
        slice: z.tuple([z.number().int().min(1).max(200), z.number().int().min(1).max(200), z.number().int().min(1).max(200), z.number().int().min(1).max(200)]),
        /** Lot 79 : épaisseur PLEINE du dessin sur chaque côté (px de l'image, au plus la découpe), mesurée sur le fichier (src/lib/kit/frame-ring.ts). Absente : la découpe entière. */
        ring: z.tuple([z.number().int().min(1).max(200), z.number().int().min(1).max(200), z.number().int().min(1).max(200), z.number().int().min(1).max(200)]).optional(),
      })
      .strict()
      .optional(),
    stroke: kitImage.optional(),
    icons: z
      .object({ arrowLeft: kitImage.optional(), arrowRight: kitImage.optional(), close: kitImage.optional(), play: kitImage.optional() })
      .strict()
      .optional(),
    tape: kitImage.optional(),
    /* ---- Curseurs (lot 4) : normal et « clic » (survol de ce qui se clique) ---- */
    cursors: z
      .object({
        default: kitCursor.optional(),
        pointer: kitCursor.optional(),
        /** Désactivés depuis Admin → Thèmes : curseurs du système (les dessins restent gardés). */
        off: z.boolean().optional(),
      })
      .strict()
      .optional(),
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
        /* ---- Palette (lot 4) : nuances facultatives — absentes = auto ----
         * Dérivées par src/themes/palette.ts (règle d'avant ce modèle : rendu
         * identique) ; présentes = forcées. */
        /** Teinte des ombres. Auto : ink (clair), #000000 (sombre). */
        shadow: opaqueColor.optional(),
        /** Voile de la visionneuse et de la vidéo. Auto : ink (clair), bg (sombre). */
        scrim: opaqueColor.optional(),
        /** Texte posé sur le voile. Auto : bg (clair), ink (sombre). */
        onScrim: opaqueColor.optional(),
        /* ---- fin Palette (lot 4) ---- */
      }),
      /* ---- Palette (lot 4) : nuances enregistrées en « auto » ----
       * bgDeep, line, inkSoft, primaryHover, onPrimary restent toujours dans
       * `color` (valeur effective) ; listées ici, elles sont recalculées depuis
       * leur base à chaque changement (normalizePalette). Absent : toutes
       * forcées (thèmes d'avant ce modèle). */
      palette: z
        .object({ auto: z.array(z.enum(["bgDeep", "line", "inkSoft", "primaryHover", "onPrimary"])).max(5).optional() })
        .strict()
        .optional(),
      /* ---- fin Palette (lot 4) ---- */
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
      // ── Mise en page (lot 2) : espacements, arrondis, ouverture ────────────
      // Facultatif : un thème sans ce bloc garde son rendu d'avant
      // (DEFAULT_LAYOUT dans src/themes/css.ts).
      layout: z
        .object({
          /** Crans « S · M · L · XL » des réglages d'espace haut / bas des blocs. */
          spaceS: cssValue,
          spaceM: cssValue,
          spaceL: cssValue,
          spaceXL: cssValue,
          /** Espace au-dessus du titre d'une page (en-tête de collection, profil). */
          pageTop: cssValue,
          /** Espace haut et bas d'une planche (bande d'images). */
          stripPad: cssValue,
          /** Arrondi des images et des cartes (surchargeable par emplacement). */
          mediaRadius: z.enum(["none", "soft", "medium", "strong"]),
          /** Fond derrière le métier dans l'ouverture (« Chara design · … »). */
          heroRoleBackdrop: z.enum(["none", "shadow", "band", "highlight"]),
          /** Aération du fond de texte (lot 68, étape « Textes ») : défaut du site ; chaque rôle ou texte peut choisir la sienne. Absent = « Normal ». */
          textAir: z.enum(["tight", "normal", "airy"]),
          /** Carte des rubriques (lot 17c) : réglages utilisés quand une rubrique active sa carte sans les préciser. */
          card: LenientSurfaceSchema,
        })
        .partial()
        .strict()
        .optional(),
      // ── fin mise en page ───────────────────────────────────────────────────
      // ── Typographie du thème (intégration lots 2 + 5) ───────────────────────
      // Styles par rôle (mêmes rôles et sélecteurs que les styles du site du
      // lot 2, src/lib/look.ts) ; ordre : thème < site < texte. Restreint aux
      // polices du thème (pas de police téléchargée : un thème exporté reste
      // autonome) et à des crans bornés. Facultatif : absent = rendu d'avant.
      type: z
        .partialRecord(
          z.enum(TEXT_ROLES),
          z
            .object({
              font: z.enum(["display", "body", "caption"]).optional(),
              weight: z.number().int().min(100).max(900).multipleOf(100).optional(),
              italic: z.boolean().optional(),
              case: z.enum(["normal", "upper"]).optional(),
              /** Interlettrage, en em. */
              tracking: z.number().min(-0.05).max(0.4).optional(),
            })
            .strict(),
        )
        .optional(),
      // ── fin typographie du thème ────────────────────────────────────────────
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
