/**
 * Contenu initial du site (seed). Fait foi tant qu'il n'y a pas d'admin.
 * Textes éditoriaux repris à l'identique des anciens messages next-intl.
 *
 * Les blocs référencent les pages par clé symbolique (`page: "characters"`),
 * résolue en identifiant au moment du seed (champ `pageId` des props).
 */

type L = { fr: string; en: string };

export type SeedBlock = { type: string; props: Record<string, unknown> };
export type SeedPage = {
  key: string;
  slug: L;
  title: L;
  meta: { title: L; description: L };
  navOrder: number | null;
  blocks: SeedBlock[];
};

export const SITE_SETTINGS = {
  site: {
    name: { fr: "Camille Roussel", en: "" },
    role: {
      fr: "Chara design · Décors · Animation",
      en: "Character design · Backgrounds · Animation",
    },
    email: "bonjour@example.org",
    credit: {
      fr: "Illustrations et site conçus à Angoulême.",
      en: "Illustrations and site made in Angoulême.",
    },
  },
  socials: [
    { label: "Instagram", href: "#" },
    { label: "Tumblr", href: "#" },
    { label: "LinkedIn", href: "#" },
  ],
};

const collectionTexts = {
  characters: {
    eyebrow: { fr: "Personnages — 01", en: "Characters — 01" },
    title: { fr: "Personnages", en: "Characters" },
    intro: {
      fr: "Silhouettes, gammes de couleurs et feuilles de modèle. Chaque personnage est cherché pour rester lisible en plan large avant d'être détaillé.",
      en: "Silhouettes, colour ranges and model sheets. Every character is designed to read in a wide shot before any detail is added.",
    },
  },
  backgrounds: {
    eyebrow: { fr: "Décors — 02", en: "Backgrounds — 02" },
    title: { fr: "Décors", en: "Backgrounds" },
    intro: {
      fr: "Décors peints et layouts. Les plans de profondeur sont peu nombreux et franchement séparés, pour laisser respirer l'animation.",
      en: "Painted backgrounds and layouts. Depth planes are few and clearly separated, so the animation has room to breathe.",
    },
  },
  animation: {
    eyebrow: { fr: "Animation — 03", en: "Animation — 03" },
    title: { fr: "Animation", en: "Animation" },
    intro: {
      fr: "Cycles, effets et études d'ambiance, animés à la main sur douze images par seconde.",
      en: "Cycles, effects and mood studies, animated by hand on twelves.",
    },
  },
} as const;

export const SEED_PAGES: SeedPage[] = [
  {
    key: "home",
    slug: { fr: "", en: "" },
    title: { fr: "Accueil", en: "Home" },
    meta: {
      title: {
        fr: "Camille Roussel — Chara design, décors et animation",
        en: "Camille Roussel — Character design, backgrounds and animation",
      },
      description: {
        fr: "Portfolio de Camille Roussel, artiste 2D : character design, décors peints et animation traditionnelle.",
        en: "Portfolio of Camille Roussel, 2D artist: character design, painted backgrounds and traditional animation.",
      },
    },
    navOrder: null,
    blocks: [
      {
        type: "hero",
        props: {
          eyebrow: { fr: "Portfolio — 2D", en: "Portfolio — 2D" },
          statement: {
            fr: "Je dessine des <mark>personnages</mark> et les mondes qui les portent.",
            en: "I draw <mark>characters</mark> and the worlds that carry them.",
          },
          reelPage: "animation",
        },
      },
      {
        type: "collection-tiles",
        props: {
          eyebrow: { fr: "Collections — 01", en: "Collections — 01" },
          title: { fr: "Trois manières de raconter", en: "Three ways of telling a story" },
          items: (["characters", "backgrounds", "animation"] as const).map((c) => ({
            collection: c,
            page: c,
            ...collectionTexts[c],
          })),
        },
      },
      {
        type: "featured-projects",
        props: {
          eyebrow: { fr: "Projets — 02", en: "Projects — 02" },
          title: { fr: "Deux projets récents", en: "Two recent projects" },
          intro: {
            fr: "Le travail se lit par projet : ce qu'on m'a demandé, sur quelle période, et ce que ça a produit comme images.",
            en: "The work reads project by project: what was asked for, over what period, and the images it produced.",
          },
          limit: 2,
          more: {
            label: { fr: "Voir tous les projets par métier", en: "Browse every project by craft" },
            page: "characters",
          },
        },
      },
      {
        type: "contact",
        props: {
          eyebrow: { fr: "Contact — 03", en: "Contact — 03" },
          title: { fr: "Parlons d'un projet", en: "Let's talk about a project" },
          intro: {
            fr: "Disponible pour des missions de character design, de décors et d'animation, en studio ou à distance.",
            en: "Available for character design, background and animation work, in studio or remotely.",
          },
          cta: { fr: "Écrire un message", en: "Send a message" },
        },
      },
    ],
  },
  ...(["characters", "backgrounds"] as const).map((c, i) => ({
    key: c,
    slug: c === "characters" ? { fr: "personnages", en: "characters" } : { fr: "decors", en: "backgrounds" },
    title: collectionTexts[c].title,
    meta:
      c === "characters"
        ? {
            title: { fr: "Personnages — Camille Roussel", en: "Characters — Camille Roussel" },
            description: {
              fr: "Recherches de character design : silhouettes, couleurs et feuilles de modèle.",
              en: "Character design studies: silhouettes, colour keys and model sheets.",
            },
          }
        : {
            title: { fr: "Décors — Camille Roussel", en: "Backgrounds — Camille Roussel" },
            description: {
              fr: "Décors peints et layouts : profondeur, lumière et composition pour l'animation.",
              en: "Painted backgrounds and layouts: depth, light and composition for animation.",
            },
          },
    navOrder: i + 1,
    blocks: [
      { type: "collection-intro", props: { collection: c, showCounts: true, ...collectionTexts[c] } },
      { type: "collection-projects", props: { collection: c } },
    ],
  })),
  {
    key: "animation",
    slug: { fr: "animation", en: "animation" },
    title: collectionTexts.animation.title,
    meta: {
      title: { fr: "Animation — Camille Roussel", en: "Animation — Camille Roussel" },
      description: {
        fr: "Demoreel et plans animés : cycles de marche, effets et études d'ambiance.",
        en: "Demoreel and animated shots: walk cycles, effects and mood studies.",
      },
    },
    navOrder: 3,
    blocks: [
      {
        type: "collection-intro",
        props: { collection: "animation", showCounts: false, ...collectionTexts.animation },
      },
      {
        type: "video",
        props: {
          reelEyebrow: { fr: "Demoreel — 2025", en: "Demoreel — 2025" },
          cardsEyebrow: { fr: "Plans — 04", en: "Shots — 04" },
          cardsTitle: { fr: "Extraits", en: "Excerpts" },
        },
      },
    ],
  },
  {
    key: "about",
    slug: { fr: "a-propos", en: "about" },
    title: { fr: "À propos", en: "About" },
    meta: {
      title: { fr: "À propos — Camille Roussel", en: "About — Camille Roussel" },
      description: {
        fr: "Artiste 2D installée à Angoulême : character design, décors et animation traditionnelle.",
        en: "2D artist based in Angoulême: character design, backgrounds and traditional animation.",
      },
    },
    navOrder: 4,
    blocks: [
      {
        type: "profile",
        props: {
          portrait: "portrait.svg",
          portraitCaption: { fr: "Angoulême, France", en: "Angoulême, France" },
          eyebrow: { fr: "À propos — 05", en: "About — 05" },
          paragraphs: [
            {
              fr: "Je suis Camille Roussel, artiste 2D installée à Angoulême. Je travaille le character design, le décor et l'animation traditionnelle pour la série, le court métrage et l'édition jeunesse.",
              en: "I'm Camille Roussel, a 2D artist based in Angoulême, France. I work on character design, backgrounds and traditional animation for series, short films and children's publishing.",
            },
            {
              fr: "Mon travail part presque toujours de la lumière : je cherche d'abord la valeur et l'ambiance d'un plan, la couleur vient après, et le trait en dernier. J'aime les gammes restreintes, les silhouettes nettes et les décors où il reste de la place pour que le personnage bouge.",
              en: "My work almost always starts with light: I look for the value and the mood of a shot first, colour comes next, and line last. I like narrow palettes, clean silhouettes and backgrounds that leave room for a character to move.",
            },
            {
              fr: "Formée à l'ÉMCA, je collabore depuis 2019 avec des studios français et européens, en équipe ou en autonomie. Je réponds volontiers aux propositions de collaboration, de conférence ou d'atelier.",
              en: "Trained at ÉMCA, I have been working with French and European studios since 2019, in a team or on my own. I'm always glad to hear about collaborations, talks or workshops.",
            },
          ],
          contactEyebrow: { fr: "Contact", en: "Contact" },
          contactLabel: { fr: "Écrivez-moi", en: "Write to me" },
          socialEyebrow: { fr: "Ailleurs", en: "Elsewhere" },
        },
      },
    ],
  },
];

/** Médias hors planches (seed/media/<fichier> → alt). */
export const EXTRA_MEDIA: Record<string, { alt: L; width: number; height: number }> = {
  "portrait.svg": {
    alt: { fr: "Portrait illustré de Camille Roussel", en: "Illustrated portrait of Camille Roussel" },
    width: 900,
    height: 1100,
  },
};
