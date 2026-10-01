/**
 * Registre des types de blocs. Ajouter un type = une entrée ici :
 *   { type, schema (zod des props), Component (rendu serveur), Editor
 *     (formulaire client de l'admin), label, description, defaults, summary }
 * + la déclaration de ses champs-références dans refs.ts (module pur, lu par
 * Node dans les tests). Aucun autre fichier à toucher : l'éditeur de page lit
 * tout depuis ce registre.
 */
import { createElement, type ComponentType, type ReactNode } from "react";
import type { z } from "zod";

import CollectionIntroBlock, { collectionIntroSchema } from "./CollectionIntroBlock";
import CollectionProjectsBlock, { collectionProjectsSchema } from "./CollectionProjectsBlock";
import CollectionTilesBlock, { collectionTilesSchema } from "./CollectionTilesBlock";
import ContactBlock, { contactSchema } from "./ContactBlock";
import {
  CollectionIntroEditor,
  CollectionProjectsEditor,
  CollectionTilesEditor,
  ContactEditor,
  FeaturedProjectsEditor,
  HeroEditor,
  ProfileEditor,
  RichTextEditor,
  VideoEditor,
} from "./editors";
import FeaturedProjectsBlock, { featuredProjectsSchema } from "./FeaturedProjectsBlock";
import HeroBlock, { heroSchema } from "./HeroBlock";
import ProfileBlock, { profileSchema } from "./ProfileBlock";
import type { BlockCatalogEntry } from "./editor-types";
import { BLOCK_REFS, type BlockRefs } from "./refs";
import RichTextBlock, { richTextSchema } from "./RichTextBlock";
import type { BlockContext } from "./types";
import VideoBlock, { videoSchema } from "./VideoBlock";

export type BlockDefinition<S extends z.ZodType = z.ZodType> = {
  type: string;
  schema: S;
  Component: ComponentType<{ props: z.infer<S>; ctx: BlockContext }>;
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
};

function define<S extends z.ZodType>(def: Omit<BlockDefinition<S>, "refs">): BlockDefinition {
  const refs = BLOCK_REFS[def.type];
  if (!refs) throw new Error(`Bloc « ${def.type} » : références non déclarées dans src/blocks/refs.ts`);
  return { ...def, refs } as unknown as BlockDefinition;
}

const L = { fr: "", en: "" };

export const BLOCKS: Record<string, BlockDefinition> = Object.fromEntries(
  [
    define({
      type: "hero",
      schema: heroSchema,
      Component: HeroBlock,
      Editor: HeroEditor,
      label: "Ouverture",
      description: "Le grand bandeau d'accueil : ton nom, ton métier et une accroche, dans la forme choisie par le thème.",
      defaults: { eyebrow: L, statement: L },
      summary: "{eyebrow}",
      // Rendu par le thème (formes d'ouverture variées) : réglages seulement.
      inline: [],
    }),
    define({
      type: "collection-tiles",
      schema: collectionTilesSchema,
      Component: CollectionTilesBlock,
      Editor: CollectionTilesEditor,
      label: "Tuiles de collections",
      description: "Une tuile illustrée par collection (Personnages, Décors…), chacune menant à sa page.",
      defaults: { eyebrow: L, title: L, items: [] },
      summary: "{title} · {items} tuiles",
      inline: ["eyebrow", "title"],
    }),
    define({
      type: "featured-projects",
      schema: featuredProjectsSchema,
      Component: FeaturedProjectsBlock,
      Editor: FeaturedProjectsEditor,
      label: "Projets mis en avant",
      description: "Quelques projets présentés en bandes de planches, avec un lien « voir plus » facultatif.",
      defaults: { eyebrow: L, title: L, intro: L, limit: 2 },
      summary: "{title} · {limit} projets",
      inline: ["eyebrow", "title", "intro"],
    }),
    define({
      type: "collection-intro",
      schema: collectionIntroSchema,
      Component: CollectionIntroBlock,
      Editor: CollectionIntroEditor,
      label: "En-tête de collection",
      description: "Le titre et la présentation d'une collection, avec ses compteurs d'œuvres et de projets.",
      defaults: { collection: "characters", eyebrow: L, title: L, intro: L, showCounts: true },
      summary: "{title} · {collection}",
      inline: ["eyebrow", "title", "intro"],
    }),
    define({
      type: "collection-projects",
      schema: collectionProjectsSchema,
      Component: CollectionProjectsBlock,
      Editor: CollectionProjectsEditor,
      label: "Planches",
      description: "Les planches de tous les projets d'une collection, en bandes défilantes.",
      defaults: { collection: "characters" },
      summary: "Planches · {collection}",
      inline: [],
    }),
    define({
      type: "video",
      schema: videoSchema,
      Component: VideoBlock,
      Editor: VideoEditor,
      label: "Vidéos",
      description: "Ta demoreel en grand, puis tes extraits d'animation en cartes.",
      defaults: { reelEyebrow: L, cardsEyebrow: L, cardsTitle: L },
      summary: "Demoreel · {cardsTitle}",
      inline: [],
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
      type: "profile",
      schema: profileSchema,
      Component: ProfileBlock,
      Editor: ProfileEditor,
      label: "Profil",
      description: "Ton portrait, ta présentation, ton contact et tes réseaux.",
      defaults: { portraitCaption: L, eyebrow: L, paragraphs: [L], contactEyebrow: L, contactLabel: L, socialEyebrow: L },
      summary: "{eyebrow} · {paragraphs} paragraphes",
      inline: [],
    }),
  ].map((d) => [d.type, d]),
);

/** Métadonnées des types pour les éditeurs (composants client, sérialisables). */
export function blockCatalog(): BlockCatalogEntry[] {
  return Object.values(BLOCKS).map((b) => ({
    type: b.type,
    label: b.label,
    description: b.description,
    defaults: b.defaults,
    summary: b.summary,
    inline: b.inline,
  }));
}

/**
 * Éléments d'édition sans props (sérialisables vers un composant client) ; le
 * bloc édité leur parvient par contexte (src/blocks/editor-context.tsx).
 */
export function blockEditors(): Record<string, ReactNode> {
  return Object.fromEntries(Object.values(BLOCKS).map((b) => [b.type, createElement(b.Editor)]));
}
