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

import CollectionIntroBlock, { collectionIntroSchema } from "./CollectionIntroBlock";
import CollectionProjectsBlock, { collectionProjectsSchema } from "./CollectionProjectsBlock";
import CollectionTilesBlock, { collectionTilesSchema } from "./CollectionTilesBlock";
import ContactBlock, { contactSchema } from "./ContactBlock";
import ContactFormBlock, { contactFormSchema } from "./ContactFormBlock";
import CvBlock, { cvSchema } from "./CvBlock";
import { defaultContactForm } from "@/lib/contact-form";
import {
  CollectionIntroEditor,
  CollectionProjectsEditor,
  CollectionTilesEditor,
  ContactEditor,
  ContactFormEditor,
  CvEditor,
  FeaturedProjectEditor,
  FeaturedProjectsEditor,
  GridEditor,
  HeroEditor,
  ImageEditor,
  ProfileEditor,
  ProjectBoardEditor,
  RichTextEditor,
  SectionTitleEditor,
  VideoEditor,
  VideoSingleEditor,
} from "./editors";
import FeaturedProjectBlock, { featuredProjectSchema } from "./FeaturedProjectBlock";
import FeaturedProjectsBlock, { featuredProjectsSchema } from "./FeaturedProjectsBlock";
import GridBlock, { gridSchema } from "./GridBlock";
import { GRID_PATTERN } from "./grid-layouts";
import ImageBlock, { imageSchema } from "./ImageBlock";
import SectionTitleBlock, { sectionTitleSchema } from "./SectionTitleBlock";
import { CONTAINERS, needsInheritedProject, type TreeBlock } from "./tree";
import VideoSingleBlock, { videoSingleSchema } from "./VideoSingleBlock";
import HeroBlock, { heroSchema } from "./HeroBlock";
import ProfileBlock, { profileSchema } from "./ProfileBlock";
import ProjectBoardBlock, { projectBoardSchema } from "./ProjectBoardBlock";
import type { BlockCatalogEntry } from "./editor-types";
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
  /** Raccourcis de la palette (même type, réglages de départ différents). */
  presets?: { key: string; label: string; description: string; defaults: Record<string, unknown> }[];
};

function define<S extends z.ZodType>(def: Omit<BlockDefinition<S>, "refs" | "container">): BlockDefinition {
  const refs = BLOCK_REFS[def.type];
  if (!refs) throw new Error(`Bloc « ${def.type} » : références non déclarées dans src/blocks/refs.ts`);
  const container = Object.hasOwn(CONTAINERS, def.type) ? CONTAINERS[def.type] : undefined;
  // Mise en page (lot 2) : tout bloc porte ses réglages `look` (src/lib/look.ts) ;
  // un réglage illisible est ignoré, il ne masque jamais le bloc.
  const schema = def.schema instanceof z.ZodObject ? def.schema.safeExtend({ look: LookSchema.optional().catch(undefined) }) : def.schema;
  return { ...def, schema, refs, ...(container ? { container } : {}) } as unknown as BlockDefinition;
}

/** Composants de départ d'un modèle (uid attribués à l'insertion par l'éditeur). */
const child = (type: string, props: Record<string, unknown> = {}) => ({ type, props });
const videos = (n: number) => Array.from({ length: n }, () => child("video-single", { variant: "card", mode: "player" }));
const images = (n: number) => Array.from({ length: n }, () => child("image", { width: "wide" }));

const L = { fr: "", en: "" };

export const BLOCKS: Record<string, BlockDefinition> = Object.fromEntries(
  [
    // Geste principal de l'éditeur visuel : en tête de la palette.
    define({
      type: "project-board",
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
    define({
      type: "featured-project",
      schema: featuredProjectSchema,
      Component: FeaturedProjectBlock,
      Editor: FeaturedProjectEditor,
      label: "Projet mis en avant",
      description: "Un conteneur pour un projet : choisis-le, puis compose avec son titre, sa planche, des images, du texte ou une grille.",
      defaults: {
        children: [
          child("section-title", { eyebrow: { fr: "Projet mis en avant", en: "Featured project" }, linked: true }),
          child("project-board", { header: false }),
        ],
      },
      summary: "{project} · {children} composants",
      inline: ["more.label"],
      publishCheck: (props) => {
        // Projet exigé seulement si un composant compte dessus (planche sans projet, titre lié).
        const kids = (props.children as TreeBlock[] | undefined) ?? [];
        if (!props.project && needsInheritedProject(kids)) return "Choisis le projet mis en avant (ou crée-le).";
        const more = props.more as { pageId?: number } | undefined;
        return more && !more.pageId ? "Choisis la page du lien « voir plus »." : null;
      },
    }),
    define({
      type: "video-single",
      schema: videoSingleSchema,
      Component: VideoSingleBlock,
      Editor: VideoSingleEditor,
      label: "Vidéo",
      description: "Une vidéo de ta médiathèque : lecteur, ou boucle muette.",
      defaults: { variant: "card", mode: "player" },
      summary: "Vidéo · {title}",
      inline: ["eyebrow", "title", "description"],
      mediaFields: [{ field: "mediaId", kind: "video" }],
      publishCheck: (props) => (props.mediaId || props.slot ? null : "Choisis une vidéo (dépose-la, ou prends-la dans la médiathèque)."),
    }),
    define({
      type: "grid",
      schema: gridSchema,
      Component: GridBlock,
      Editor: GridEditor,
      label: "Grille",
      description: "Un conteneur en grille : vidéos, images, textes… rangés selon l'agencement choisi.",
      defaults: { layout: "2", children: [] },
      summary: "Grille {layout} · {children} composants",
      inline: ["eyebrow", "title"],
      presets: [
        {
          key: "grid-videos",
          label: "Grille de vidéos",
          description: "Une grande vidéo et deux petites dessous (l'agencement se change ensuite).",
          defaults: { layout: "1+2", children: videos(GRID_PATTERN["1+2"]) },
        },
        {
          key: "grid-images",
          label: "Grille d'images",
          description: "Trois images côte à côte (l'agencement se change ensuite).",
          defaults: { layout: "3", ratio: "4:5", children: images(GRID_PATTERN["3"]) },
        },
      ],
    }),
    define({
      type: "image",
      schema: imageSchema,
      Component: ImageBlock,
      Editor: ImageEditor,
      label: "Image",
      description: "Une image seule, avec une légende facultative.",
      defaults: { width: "wide" },
      summary: "Image · {caption}",
      inline: ["caption"],
      mediaFields: [{ field: "mediaId", kind: "image" }],
      publishCheck: (props) => (props.mediaId ? null : "Choisis une image (dépose-la, ou prends-la dans la médiathèque)."),
    }),
    define({
      type: "cv",
      schema: cvSchema,
      Component: CvBlock,
      Editor: CvEditor,
      label: "CV",
      description: "Ton CV : ses pages en images, lisibles et agrandissables, et un bouton pour télécharger le PDF.",
      defaults: { eyebrow: { fr: "Parcours", en: "Background" }, title: { fr: "Curriculum vitae", en: "Résumé" }, fileName: "cv" },
      summary: "CV · {title}",
      inline: ["eyebrow", "title", "intro", "button"],
      mediaFields: [{ field: "mediaId", kind: "pdf" }],
      publishCheck: (props) => (props.mediaId ? null : "Choisis le PDF de ton CV (dépose-le sur le bloc, ou prends-le dans la médiathèque)."),
    }),
    define({
      type: "section-title",
      schema: sectionTitleSchema,
      Component: SectionTitleBlock,
      Editor: SectionTitleEditor,
      label: "Titre",
      description: "Une étiquette, un titre et une présentation ; dans un projet mis en avant, peut reprendre le nom du projet.",
      defaults: { eyebrow: L, title: L, intro: L },
      summary: "{title}",
      inline: ["eyebrow", "title", "intro"],
    }),
    define({
      type: "hero",
      schema: heroSchema,
      Component: HeroBlock,
      Editor: HeroEditor,
      label: "Ouverture",
      description: "Le grand bandeau d'accueil : ton nom, ton métier et une accroche, dans la forme choisie par le thème.",
      defaults: { eyebrow: L, statement: L },
      summary: "{eyebrow}",
      // Nom et métier : identité du site (communs aux pages), modifiables en place aussi.
      inline: ["eyebrow", "scroll", "reel"],
      mediaFields: [{ field: "backgroundMediaId", kind: "any" }],
    }),
    define({
      type: "collection-tiles",
      schema: collectionTilesSchema,
      Component: CollectionTilesBlock,
      Editor: CollectionTilesEditor,
      label: "Entrées des collections",
      description: "Une grande image par collection (Personnages, Décors…), qui mène à sa page.",
      defaults: { eyebrow: L, title: L, items: [] },
      summary: "{title} · {items} entrées",
      inline: ["eyebrow", "title"],
    }),
    define({
      type: "collection-intro",
      schema: collectionIntroSchema,
      Component: CollectionIntroBlock,
      Editor: CollectionIntroEditor,
      label: "En-tête de collection",
      description: "Le titre et la présentation d'une page, avec le compte de ses planches et de leurs œuvres.",
      defaults: { collection: "characters", eyebrow: L, title: L, intro: L, showCounts: true },
      summary: "{title} · {collection}",
      inline: ["eyebrow", "title", "intro"],
    }),
    define({
      type: "rich-text",
      schema: richTextSchema,
      Component: RichTextBlock,
      Editor: RichTextEditor,
      label: "Texte",
      description: "Un titre facultatif et quelques paragraphes de texte.",
      // Titre présent (vide) : il se saisit directement sur la toile.
      defaults: { title: L, paragraphs: [L] },
      summary: "{title} · {paragraphs} paragraphes",
      inline: ["eyebrow", "title", "paragraphs.*"],
    }),
    define({
      type: "contact",
      schema: contactSchema,
      Component: ContactBlock,
      Editor: ContactEditor,
      label: "Contact",
      description: "Une invitation à t'écrire, avec un bouton vers ton adresse e-mail.",
      defaults: { eyebrow: L, title: L, intro: L, cta: L },
      summary: "{title}",
      inline: ["eyebrow", "title", "intro", "cta"],
    }),
    define({
      type: "contact-form",
      schema: contactFormSchema,
      Component: ContactFormBlock,
      Editor: ContactFormEditor,
      label: "Formulaire de contact",
      description: "Un formulaire pour t'écrire : champs au choix, message de confirmation. Les messages arrivent dans Admin → Messages.",
      defaults: defaultContactForm(),
      summary: "{title} · {fields} champs",
      inline: ["eyebrow", "title", "intro", "submit", "success", "error", "fields.*.label", "fields.*.help"],
      publishCheck: (props) => (props.formId ? null : "Ce formulaire n'a pas d'identifiant : supprime-le et ajoute-le à nouveau."),
    }),
    define({
      type: "profile",
      schema: profileSchema,
      Component: ProfileBlock,
      Editor: ProfileEditor,
      label: "Profil",
      description: "Ton portrait, ta présentation, ton contact et tes réseaux.",
      defaults: { portraitCaption: L, eyebrow: L, paragraphs: [L], contactEyebrow: L, contactLabel: L, socialEyebrow: L },
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
      description: "Ancien bloc, remplacé par « Projet mis en avant ».",
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
      description: "Ancien bloc, remplacé par des « Planche d'un projet » posées une à une.",
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
      ...(b.deprecated ? { hidden: true } : {}),
    };
    return [base, ...(b.presets ?? []).map((p) => ({ ...base, key: p.key, label: p.label, description: p.description, defaults: p.defaults, preset: true }))];
  });
}

/**
 * Éléments d'édition sans props (sérialisables vers un composant client) ; le
 * bloc édité leur parvient par contexte (src/blocks/editor-context.tsx).
 */
export function blockEditors(): Record<string, ReactNode> {
  return Object.fromEntries(Object.values(BLOCKS).map((b) => [b.type, createElement(b.Editor)]));
}
