/**
 * Registre des types de blocs. Ajouter un type = une entrée ici :
 *   { type, schema (zod des props), Component (rendu serveur), Editor
 *     (formulaire client de l'admin), label, description, defaults, summary }
 * + la déclaration de ses champs-références dans refs.ts (module pur, lu par
 * Node dans les tests). Aucun autre fichier à toucher : l'éditeur de page lit
 * tout depuis ce registre.
 */
import { createElement, type ComponentType, type ReactNode } from "react";
import { z } from "zod";

import { LookSchema } from "@/lib/look";
import { markedProblem } from "@/lib/marked";
import { BackgroundSchema } from "@/themes/fond";
import { SurfaceSchema } from "@/themes/surface";


import CollectionIntroBlock, { collectionIntroSchema } from "./CollectionIntroBlock";
import CollectionProjectsBlock, { collectionProjectsSchema } from "./CollectionProjectsBlock";
import CollectionTilesBlock, { collectionTilesSchema } from "./CollectionTilesBlock";
import ContactBlock, { contactSchema } from "./ContactBlock";
import ContactFormBlock, { contactFormSchema } from "./ContactFormBlock";
import CvBlock, { cvSchema } from "./CvBlock";
import { ContactFormSchema, defaultContactForm } from "@/lib/contact-form";
import {
  CollectionIntroEditor,
  CollectionProjectsEditor,
  CollectionTilesEditor,
  ContactEditor,
  ContactFormEditor,
  CvEditor,
  FeaturedProjectEditor,
  FeaturedProjectsEditor,
  FreeBoardEditor,
  GridEditor,
  HeroEditor,
  ImageEditor,
  PageLinkEditor,
  ProfileEditor,
  ProjectBoardEditor,
  RichTextEditor,
  SectionTitleEditor,
  VideoEditor,
  VideoSingleEditor,
} from "./editors";
import FeaturedProjectBlock, { featuredProjectSchema } from "./FeaturedProjectBlock";
import FeaturedProjectsBlock, { featuredProjectsSchema } from "./FeaturedProjectsBlock";
import FreeBoardBlock, { freeBoardSchema } from "./FreeBoardBlock";
import GridBlock, { gridSchema } from "./GridBlock";
import { GRID_PATTERN } from "./grid-layouts";
import type { BlockGroup } from "./groups";
import ImageBlock, { imageSchema } from "./ImageBlock";
import SectionTitleBlock, { sectionTitleSchema } from "./SectionTitleBlock";
import { CONTAINERS } from "./tree";
import VideoSingleBlock, { videoSingleSchema } from "./VideoSingleBlock";
import HeroBlock, { heroSchema } from "./HeroBlock";
import ProfileBlock, { profileSchema } from "./ProfileBlock";
import PageLinkBlock, { pageLinkSchema } from "./PageLinkBlock";
import ProjectBoardBlock, { projectBoardSchema } from "./ProjectBoardBlock";
import type { BlockCatalogEntry } from "./editor-types";
import { helpTextProblem, titleHelpProblem } from "./help-text";
import { BLOCK_REFS, type BlockRefs } from "./refs";
import RichTextBlock, { richTextSchema } from "./RichTextBlock";
import type { BlockContext } from "./types";
import VideoBlock, { videoSchema } from "./VideoBlock";

export type BlockDefinition<S extends z.ZodType = z.ZodType> = {
  type: string;
  schema: S;
  /** `children` : composants déjà rendus (conteneurs seulement). */
  Component: ComponentType<{ props: z.infer<S>; ctx: BlockContext; children?: ReactNode }>;
  /** Formulaire d'édition (composant client, sans props : il lit le bloc
   *  édité par useBlockEditor()). */
  Editor: ComponentType;
  /** Nom du type, du point de vue de l'artiste. */
  label: string;
  /** Une phrase : ce que le bloc affiche (sélecteur d'ajout). */
  description: string;
  /** Props d'un bloc neuf. */
  defaults: Record<string, unknown>;
  /**
   * Résumé lisible d'un bloc replié : gabarit dont les {chemins} sont
   * remplacés par la valeur (texte FR, nom de collection, nombre d'éléments).
   */
  summary: string;
  /** Champs des props qui désignent un média ou une page (sans FK en base). */
  refs: BlockRefs;
  /**
   * Textes modifiables en place sur la toile de l'éditeur visuel : chemins de
   * props localisées ({ fr, en }), `*` pour un indice de liste. Le composant
   * marque l'élément correspondant avec inline(ctx, chemin). Les autres
   * réglages passent par l'Editor.
   */
  inline: string[];
  /**
   * Condition de publication en plus du schéma (un brouillon peut rester
   * incomplet, la page publiée non) : message d'erreur, ou null.
   */
  publishCheck?: (props: Record<string, unknown>, ctx: { project?: string }) => string | null;
  /**
   * Conteneur (v0.13) : types de composants acceptés (table de tree.ts).
   * Ses composants sont dans props.children.
   */
  container?: { accepts: string[] };
  /** Champs média remplaçables sur la toile (survol : Remplacer / Retirer, dépôt). */
  mediaFields?: { field: string; kind: "image" | "video" | "pdf" | "any" }[];
  /** Retiré de la palette : encore rendu s'il traîne, plus créable. */
  deprecated?: boolean;
  /**
   * Groupe d'ajout (panneau « Ajouter », fenêtre « Ajouter une rubrique ») et rang dans ce groupe
   * (src/blocks/groups.ts). Obligatoires pour tout type créable (test-containers).
   */
  group?: BlockGroup;
  order?: number;
  /** Raccourcis de la palette (même type, réglages de départ différents) : même groupe, rang propre. */
  presets?: { key: string; label: string; /** Nom court du modèle (puce de la carte du type, panneau « Ajouter »). */ short: string; description: string; defaults: Record<string, unknown>; order: number }[];
  /** Une seule fois par page (l'Ouverture) : le panneau grise l'ajout s'il y en a déjà un, avec l'explication. */
  single?: { reason: string };
};

function define<S extends z.ZodType>(def: Omit<BlockDefinition<S>, "refs" | "container">): BlockDefinition {
  const refs = BLOCK_REFS[def.type];
  if (!refs) throw new Error(`Bloc « ${def.type} » : références non déclarées dans src/blocks/refs.ts`);
  const container = Object.hasOwn(CONTAINERS, def.type) ? CONTAINERS[def.type] : undefined;
  // Mise en page (lot 2) : tout bloc porte ses réglages `look` (src/lib/look.ts) ;
  // un réglage illisible est ignoré, il ne masque jamais le bloc.
  // Carte de rubrique (lot 17c) : `surface` de même, rendue seulement sur un bloc de premier niveau (BlockList).
  // Fond de couleur du composant (lot 32) : `background` de même, lu seulement par les grands composants (src/themes/fond.ts, FOND_TYPES).
  const schema =
    def.schema instanceof z.ZodObject
      ? def.schema.safeExtend({ look: LookSchema.optional().catch(undefined), surface: SurfaceSchema.optional().catch(undefined), background: BackgroundSchema.optional().catch(undefined) })
      : def.schema;
  return { ...def, schema, refs, ...(container ? { container } : {}) } as unknown as BlockDefinition;
}

/** Composants de départ d'un modèle (uid attribués à l'insertion par l'éditeur). */
const child = (type: string, props: Record<string, unknown> = {}) => ({ type, props });
const videos = (n: number) => Array.from({ length: n }, () => child("video-single", { variant: "card", mode: "player" }));
const images = (n: number) => Array.from({ length: n }, () => child("image", { width: "wide" }));

const L = { fr: "", en: "" };

/** Réglages d'un « Contact avec formulaire » neuf : les champs de l'ancien formulaire, sans présentation vide. */
function contactFormDefaults(): Record<string, unknown> {
  const form: Record<string, unknown> = { ...defaultContactForm(), form: true };
  delete form.intro;
  return form;
}

export const BLOCKS: Record<string, BlockDefinition> = Object.fromEntries(
  [
    // Geste principal de l'éditeur visuel : en tête de la palette.
    define({
      type: "project-board",
      group: "projects",
      order: 10,
      schema: projectBoardSchema,
      Component: ProjectBoardBlock,
      Editor: ProjectBoardEditor,
      label: "Planche d'un projet",
      description: "Un projet et ses images en bande : crée-le sur la page, ou reprends un projet existant.",
      defaults: {},
      summary: "Projet · {project}",
      inline: [],
      publishCheck: (props, ctx) => (props.project || ctx.project ? null : "Nomme le projet de cette planche, ou choisis-en un existant."),
    }),
    // Ancien conteneur (v0.13 à v0.18), retiré en v0.19 : la migration 0021 (src/lib/db/unwrap.ts) en déballe les composants.
    // Encore rendu s'il en reste un (page de plus de 40 blocs une fois déballé), jamais proposé ni créable.
    define({
      type: "featured-project",
      schema: featuredProjectSchema,
      Component: FeaturedProjectBlock,
      Editor: FeaturedProjectEditor,
      label: "Projet mis en avant (ancien)",
      description: "Ancienne rubrique, remplacée par des rubriques posées les unes sous les autres (Titre lié à un projet, Planche d'un projet…).",
      defaults: { children: [] },
      summary: "{project} · {children} composants",
      inline: ["more.label"],
      deprecated: true,
      publishCheck: (props) => {
        const more = props.more as { pageId?: number } | undefined;
        return more && !more.pageId ? "Choisis la page du lien « voir plus »." : null;
      },
    }),
    define({
      type: "video-single",
      group: "media",
      order: 20,
      schema: videoSingleSchema,
      Component: VideoSingleBlock,
      Editor: VideoSingleEditor,
      label: "Vidéo",
      description: "Une vidéo de ta médiathèque : lecteur, ou boucle muette.",
      defaults: { variant: "card", mode: "player" },
      summary: "Vidéo · {title}",
      inline: ["eyebrow", "title", "description", "captionTitle", "captionDate"],
      mediaFields: [{ field: "mediaId", kind: "video" }],
      publishCheck: (props) => (props.mediaId || props.slot ? null : "Choisis une vidéo (dépose-la, ou prends-la dans la médiathèque)."),
    }),
    define({
      type: "grid",
      group: "grids",
      order: 10,
      schema: gridSchema,
      Component: GridBlock,
      Editor: GridEditor,
      label: "Grille",
      description: "Des images, des vidéos ou des textes rangés en colonnes, à partir d'un modèle ou d'une grille vide.",
      defaults: { layout: "auto", children: [] },
      summary: "Grille {layout} · {children} composants",
      inline: ["eyebrow", "title", "captionTitle", "caption", "captionDate"],
      presets: [
        {
          key: "grid-videos",
          order: 30,
          short: "Avec des vidéos",
          label: "Grille de vidéos",
          description: "Une grande vidéo et deux petites dessous (l'agencement se change ensuite).",
          defaults: { layout: "1+2", children: videos(GRID_PATTERN["1+2"]) },
        },
        {
          key: "grid-images",
          order: 20,
          short: "Avec 3 images",
          label: "Grille d'images",
          description: "Trois images côte à côte (l'agencement se change ensuite).",
          defaults: { layout: "3", ratio: "4:5", children: images(GRID_PATTERN["3"]) },
        },
      ],
    }),
    define({
      type: "image",
      group: "media",
      order: 10,
      schema: imageSchema,
      Component: ImageBlock,
      Editor: ImageEditor,
      label: "Image",
      description: "Une image seule, avec une légende facultative.",
      defaults: { width: "wide" },
      summary: "Image · {caption}",
      inline: ["captionTitle", "caption", "captionDate"],
      mediaFields: [{ field: "mediaId", kind: "image" }],
      publishCheck: (props) => (props.mediaId ? null : "Choisis une image (dépose-la, ou prends-la dans la médiathèque)."),
    }),
    define({
      type: "free-board",
      group: "media",
      order: 30,
      schema: freeBoardSchema,
      Component: FreeBoardBlock,
      Editor: FreeBoardEditor,
      label: "Planche libre",
      description: "Des images détourées (PNG sans fond) ou des vidéos posées où tu veux, à ta taille et sous l'angle que tu veux, directement sur la carte.",
      defaults: { format: "3:2", phone: "scale", items: [] },
      summary: "Planche libre · {items} images",
      inline: ["captionTitle", "caption", "captionDate"],
      publishCheck: (props) => (Array.isArray(props.items) && props.items.length > 0 ? null : "Ajoute au moins une image à la planche libre (glisse-la sur la zone, ou « + Image »)."),
    }),
    define({
      type: "cv",
      group: "other",
      order: 10,
      schema: cvSchema,
      Component: CvBlock,
      Editor: CvEditor,
      label: "CV",
      description: "Ton CV : ses pages en images, lisibles et agrandissables, et un bouton pour télécharger le PDF.",
      defaults: { eyebrow: { fr: "Parcours", en: "Background" }, title: { fr: "Curriculum vitae", en: "Résumé" }, fileName: "cv" },
      summary: "CV · {title}",
      inline: ["eyebrow", "title", "intro", "button"],
      mediaFields: [{ field: "mediaId", kind: "pdf" }],
      publishCheck: (props) => (props.mediaId ? null : "Choisis le PDF de ton CV (dépose-le sur la rubrique, ou prends-le dans la médiathèque)."),
    }),
    define({
      type: "section-title",
      group: "text",
      order: 20,
      schema: sectionTitleSchema,
      Component: SectionTitleBlock,
      Editor: SectionTitleEditor,
      label: "Titre",
      description: "Un titre, avec une étiquette, une présentation et des compteurs facultatifs ; peut être le titre principal de la page ; peut reprendre le nom et la présentation d'un projet.",
      // Sans présentation (clé `intro` absente) : aucune place ni texte d'aide pour un champ qu'on n'a pas demandé.
      defaults: { title: L },
      summary: "{title}",
      inline: ["eyebrow", "title", "intro"],
      publishCheck: (props, ctx) => titleHelpProblem(props) ?? (props.linked && !props.project && !ctx.project ? "Choisis le projet repris par ce titre." : null),
    }),
    define({
      type: "hero",
      group: "other",
      order: 60,
      schema: heroSchema,
      Component: HeroBlock,
      Editor: HeroEditor,
      label: "Ouverture",
      description: "Le grand bandeau d'accueil : ton nom, ton métier et une accroche, dans la forme choisie par le thème.",
      defaults: { eyebrow: L, statement: L },
      single: { reason: "Il y a déjà une Ouverture sur cette page : une page n'en porte qu'une." },
      summary: "{eyebrow}",
      // Nom et métier : identité du site (communs aux pages), modifiables en place aussi.
      inline: ["eyebrow", "statement", "scroll", "reel"],
      // L'accroche porte du balisage <mark> : revalidé à la publication (la toile le valide déjà à la saisie).
      publishCheck: (props) => {
        const s = (props.statement ?? {}) as { fr?: string; en?: string };
        const problem = markedProblem(s.fr ?? "") ?? markedProblem(s.en ?? "");
        return problem ? `Phrase d'accroche : ${problem}` : null;
      },
      mediaFields: [{ field: "backgroundMediaId", kind: "any" }],
    }),
    define({
      type: "collection-tiles",
      group: "other",
      order: 80,
      schema: collectionTilesSchema,
      Component: CollectionTilesBlock,
      Editor: CollectionTilesEditor,
      label: "Entrées des collections",
      description: "Une grande image par collection (Personnages, Décors…), qui mène à sa page.",
      defaults: { eyebrow: L, title: L, mode: "auto", size: "medium" },
      summary: "{title} · {items} entrées",
      inline: ["eyebrow", "title"],
    }),
    define({
      type: "collection-intro",
      schema: collectionIntroSchema,
      Component: CollectionIntroBlock,
      Editor: CollectionIntroEditor,
      label: "En-tête de collection (ancien)",
      description: "Ancienne rubrique, remplacée par un « Titre » principal avec présentation et compteurs, et le réglage « Cette page est la collection ».",
      defaults: { collection: "characters", eyebrow: L, title: L, intro: L, showCounts: true },
      summary: "{title} · {collection}",
      inline: ["eyebrow", "title", "intro"],
      deprecated: true,
    }),
    define({
      type: "rich-text",
      group: "text",
      order: 10,
      schema: richTextSchema,
      Component: RichTextBlock,
      Editor: RichTextEditor,
      label: "Texte",
      description: "Un paragraphe de texte ; un titre peut s'ajouter au survol sur la page.",
      // Un champ n'existe que s'il a été demandé : un Texte neuf est un paragraphe seul (lot 19a).
      defaults: { paragraphs: [L] },
      summary: "{title} · {paragraphs} paragraphes",
      inline: ["eyebrow", "title", "paragraphs.*"],
      // Texte d'aide d'une rubrique neuve (« Ajouter une rubrique ») : à remplacer avant de publier.
      publishCheck: (props) => helpTextProblem(props),
    }),
    define({
      type: "contact",
      group: "other",
      order: 30,
      schema: contactSchema,
      Component: ContactBlock,
      Editor: ContactEditor,
      label: "Contact",
      description: "Une invitation à t'écrire : un bouton vers ton adresse e-mail, ou un formulaire (les messages arrivent dans Admin → Messages).",
      // Les champs n'existent que s'ils ont été demandés (« + Ajouter … » sur la toile, lot 27).
      defaults: { title: { fr: "Écris-moi", en: "Write to me" }, cta: { fr: "Envoyer un e-mail", en: "Send an email" } },
      summary: "{title} · {fields} champs",
      inline: ["eyebrow", "title", "intro", "cta", "submit", "success", "error", "fields.*.label", "fields.*.help"],
      publishCheck: (props) => {
        if (props.form !== true) return null;
        if (!props.formId) return "Ce formulaire n'a pas d'identifiant : désactive puis réactive l'option formulaire.";
        // Même contrôle que le rendu public (ContactBlock) : un formulaire invalide ne s'afficherait pas, on refuse de le publier.
        const form = ContactFormSchema.safeParse(props);
        return form.success ? null : `Ce formulaire est incomplet : ${form.error.issues[0]?.message ?? "réglages invalides"}.`;
      },
      presets: [
        {
          key: "contact-with-form",
          order: 31,
          short: "Avec un formulaire",
          label: "Contact avec formulaire",
          description: "Un formulaire pour t'écrire : champs au choix, message de confirmation.",
          defaults: contactFormDefaults(),
        },
      ],
    }),
    // Ancien « Formulaire de contact » (jusqu'à v0.19), fusionné dans « Contact » (option formulaire) par la migration 0023.
    // Encore rendu s'il en traîne un, jamais proposé ni créable.
    define({
      type: "contact-form",
      schema: contactFormSchema,
      Component: ContactFormBlock,
      Editor: ContactFormEditor,
      label: "Formulaire de contact (ancien)",
      description: "Ancienne rubrique, remplacée par « Contact » avec l'option formulaire.",
      defaults: defaultContactForm(),
      summary: "{title} · {fields} champs",
      inline: ["eyebrow", "title", "intro", "submit", "success", "error", "fields.*.label", "fields.*.help"],
      deprecated: true,
      publishCheck: (props) => (props.formId ? null : "Ce formulaire n'a pas d'identifiant : supprime-le et ajoute-le à nouveau."),
    }),
    define({
      type: "page-link",
      group: "other",
      order: 50,
      schema: pageLinkSchema,
      Component: PageLinkBlock,
      Editor: PageLinkEditor,
      label: "Lien vers une page",
      description: "Un lien « Texte → » vers une page du site, entre deux rubriques.",
      defaults: { label: L },
      summary: "{label}",
      inline: ["label"],
      publishCheck: (props) => (props.pageId ? null : "Choisis la page de destination de ce lien."),
    }),
    define({
      type: "profile",
      group: "other",
      order: 20,
      schema: profileSchema,
      Component: ProfileBlock,
      Editor: ProfileEditor,
      label: "Profil",
      description: "Ton portrait, ta présentation, ton contact et tes réseaux.",
      // Les étiquettes et la légende n'existent que si elles ont été demandées (lot 27).
      defaults: { paragraphs: [L] },
      summary: "{eyebrow} · {paragraphs} paragraphes",
      inline: ["eyebrow", "portraitCaption", "paragraphs.*", "contactEyebrow", "contactLabel", "socialEyebrow"],
      mediaFields: [{ field: "portraitMediaId", kind: "image" }],
    }),

    // Types anciens (avant v0.13) : encore rendus s'ils traînent, plus proposés.
    define({
      type: "featured-projects",
      schema: featuredProjectsSchema,
      Component: FeaturedProjectsBlock,
      Editor: FeaturedProjectsEditor,
      label: "Projets mis en avant (ancien)",
      description: "Ancienne rubrique, remplacée par « Projet mis en avant ».",
      defaults: { eyebrow: L, title: L, intro: L, limit: 2 },
      summary: "{title} · {limit} projets",
      inline: ["eyebrow", "title", "intro"],
      deprecated: true,
    }),
    define({
      type: "collection-projects",
      schema: collectionProjectsSchema,
      Component: CollectionProjectsBlock,
      Editor: CollectionProjectsEditor,
      label: "Planches d'une collection (ancien)",
      description: "Ancienne rubrique, remplacée par des « Planche d'un projet » posées une à une.",
      defaults: { collection: "characters" },
      summary: "Planches · {collection}",
      inline: [],
      deprecated: true,
    }),
    define({
      type: "video",
      schema: videoSchema,
      Component: VideoBlock,
      Editor: VideoEditor,
      label: "Vidéos (ancien)",
      description: "Ancienne vitrine, remplacée par des « Vidéo » dans une « Grille ».",
      defaults: { reelEyebrow: L, cardsEyebrow: L, cardsTitle: L },
      summary: "Demoreel · {cardsTitle}",
      inline: [],
      deprecated: true,
    }),
  ].map((d) => [d.type, d]),
);

/**
 * Métadonnées des types pour les éditeurs (composants client, sérialisables).
 * Les types anciens sont décrits (libellé, résumé) mais marqués `hidden` :
 * jamais proposés dans la palette. Les raccourcis (`presets`) suivent leur type.
 */
export function blockCatalog(): BlockCatalogEntry[] {
  return Object.values(BLOCKS).flatMap((b) => {
    const base = {
      key: b.type,
      type: b.type,
      label: b.label,
      description: b.description,
      defaults: b.defaults,
      summary: b.summary,
      inline: b.inline,
      ...(b.container ? { container: b.container } : {}),
      ...(b.mediaFields ? { mediaFields: b.mediaFields } : {}),
      ...(b.single ? { single: b.single.reason } : {}),
      ...(b.deprecated ? { hidden: true } : { group: b.group, order: b.order }),
    };
    return [base, ...(b.presets ?? []).map((p) => ({ ...base, key: p.key, label: p.label, short: p.short, description: p.description, defaults: p.defaults, order: p.order, preset: true }))];
  });
}

/**
 * Éléments d'édition sans props (sérialisables vers un composant client) ; le
 * bloc édité leur parvient par contexte (src/blocks/editor-context.tsx).
 */
export function blockEditors(): Record<string, ReactNode> {
  return Object.fromEntries(Object.values(BLOCKS).map((b) => [b.type, createElement(b.Editor)]));
}
