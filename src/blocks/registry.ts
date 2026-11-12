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

import type { AdminT } from "@/i18n/admin-lang";

import { initialExitProps } from "@/lib/db/seed-404";
import { LookSchema } from "@/lib/look";
import { markedProblem } from "@/lib/marked";
import { BackgroundSchema } from "@/themes/fond";
import { SurfaceSchema } from "@/themes/surface";

import catalogFr from "../../messages/admin-parts/blockReg.fr.json";
import { fillTemplate } from "./block-msg";

import CollectionIntroBlock, { collectionIntroSchema } from "./CollectionIntroBlock";
import CollectionProjectsBlock, { collectionProjectsSchema } from "./CollectionProjectsBlock";
import CollectionTilesBlock, { collectionTilesSchema } from "./CollectionTilesBlock";
import ContactBlock, { contactSchema } from "./ContactBlock";
import ContactFormBlock, { contactFormSchema } from "./ContactFormBlock";
import CvBlock, { cvSchema } from "./CvBlock";
import { ContactFormSchema, defaultContactForm } from "@/lib/contact-form";
import ExitBlock, { exitSchema } from "./ExitBlock";
import RandomWorkBlock, { randomWorkSchema } from "./RandomWorkBlock";
import {
  CollectionIntroEditor,
  CollectionProjectsEditor,
  CollectionTilesEditor,
  ContactEditor,
  ContactFormEditor,
  CvEditor,
  ExitEditor,
  FeaturedProjectEditor,
  FeaturedProjectsEditor,
  FreeBoardEditor,
  GridEditor,
  HeroEditor,
  ImageEditor,
  PageLinkEditor,
  ProfileEditor,
  ProjectBoardEditor,
  RandomWorkEditor,
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
import { HeadSchema, isHeadType } from "./head";
import { BLOCK_REFS, type BlockRefs } from "./refs";
import RichTextBlock, { richTextSchema } from "./RichTextBlock";
import type { BlockContext } from "./types";
import VideoBlock, { videoSchema } from "./VideoBlock";

/**
 * Textes du registre (noms, descriptions, résumés, messages de publication) : source = catalogue `blockReg` (messages/admin-parts).
 * Le français sert aux tests, aux messages serveur sans traducteur et de valeur par défaut ; l'interface passe un traducteur
 * (`blockCatalog(special, t)`, `blockTypeLabel(type, t)`, `ctx.t` de publishCheck), espace `blockReg`.
 */
const R = catalogFr;
type PublishCtx = { project?: string; t?: AdminT };
const pub = (ctx: PublishCtx | undefined, key: keyof typeof catalogFr.publish, values?: Record<string, string | number>) => (ctx?.t ? ctx.t(`publish.${key}`, values) : fillTemplate(R.publish[key], values));

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
  publishCheck?: (props: Record<string, unknown>, ctx: PublishCtx) => string | null;
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
  /** Page spéciale « Page introuvable » (lot 89, src/lib/special-pages.ts) : type proposé et accepté SEULEMENT sur cette page. */
  onlyOnSpecial?: boolean;
  /** Type refusé sur une page spéciale (effets de bord : Contact). */
  notOnSpecial?: boolean;
  /** Bloc non supprimable : la raison, affichée à la place du bouton Supprimer (infobulle) et dans le refus. */
  locked?: string;
};

function define<S extends z.ZodType>(def: Omit<BlockDefinition<S>, "refs" | "container">): BlockDefinition {
  const refs = BLOCK_REFS[def.type];
  if (!refs) throw new Error(`Block "${def.type}": refs not declared in src/blocks/refs.ts`);
  const container = Object.hasOwn(CONTAINERS, def.type) ? CONTAINERS[def.type] : undefined;
  // Mise en page (lot 2) : tout bloc porte ses réglages `look` (src/lib/look.ts) ;
  // un réglage illisible est ignoré, il ne masque jamais le bloc.
  // Carte de rubrique (lot 17c) : `surface` de même, rendue seulement sur un bloc de premier niveau (BlockList).
  // Fond de couleur du composant (lot 32) : `background` de même, lu seulement par les grands composants (src/themes/fond.ts, FOND_TYPES).
  // Titre de composant (lot 128, src/blocks/head.ts) : `head` de même, facultatif, sur les types titrables seulement ; illisible = ignoré.
  const headable = isHeadType(def.type);
  const schema =
    def.schema instanceof z.ZodObject
      ? def.schema.safeExtend({
          look: LookSchema.optional().catch(undefined),
          surface: SurfaceSchema.optional().catch(undefined),
          background: BackgroundSchema.optional().catch(undefined),
          ...(headable ? { head: HeadSchema.optional().catch(undefined) } : {}),
        })
      : def.schema;
  // Les textes du titre se modifient en place (`head.title`, `head.eyebrow`).
  const inline = headable ? [...def.inline, "head.title", "head.eyebrow"] : def.inline;
  return { ...def, inline, schema, refs, ...(container ? { container } : {}) } as unknown as BlockDefinition;
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
      label: R.types["project-board"].label,
      description: R.types["project-board"].description,
      defaults: {},
      summary: R.types["project-board"].summary,
      inline: [],
      publishCheck: (props, ctx) => (props.project || ctx.project ? null : pub(ctx, "projectName")),
    }),
    // Ancien conteneur (v0.13 à v0.18), retiré en v0.19 : la migration 0021 (src/lib/db/unwrap.ts) en déballe les composants.
    // Encore rendu s'il en reste un (page de plus de 40 blocs une fois déballé), jamais proposé ni créable.
    define({
      type: "featured-project",
      schema: featuredProjectSchema,
      Component: FeaturedProjectBlock,
      Editor: FeaturedProjectEditor,
      label: R.types["featured-project"].label,
      description: R.types["featured-project"].description,
      defaults: { children: [] },
      summary: R.types["featured-project"].summary,
      inline: ["more.label"],
      deprecated: true,
      publishCheck: (props, ctx) => {
        const more = props.more as { pageId?: number } | undefined;
        return more && !more.pageId ? pub(ctx, "morePage") : null;
      },
    }),
    define({
      type: "video-single",
      group: "media",
      order: 20,
      schema: videoSingleSchema,
      Component: VideoSingleBlock,
      Editor: VideoSingleEditor,
      label: R.types["video-single"].label,
      description: R.types["video-single"].description,
      defaults: { variant: "card", mode: "player" },
      summary: R.types["video-single"].summary,
      inline: ["eyebrow", "title", "description", "captionTitle", "captionDate"],
      mediaFields: [{ field: "mediaId", kind: "video" }],
      publishCheck: (props, ctx) => (props.mediaId || props.slot ? null : pub(ctx, "video")),
    }),
    define({
      type: "grid",
      group: "grids",
      order: 10,
      schema: gridSchema,
      Component: GridBlock,
      Editor: GridEditor,
      label: R.types["grid"].label,
      description: R.types["grid"].description,
      defaults: { layout: "auto", children: [] },
      summary: R.types["grid"].summary,
      inline: ["eyebrow", "title", "captionTitle", "caption", "captionDate"],
      presets: [
        {
          key: "grid-videos",
          order: 30,
          short: R.presets["grid-videos"].short,
          label: R.presets["grid-videos"].label,
          description: R.presets["grid-videos"].description,
          defaults: { layout: "1+2", children: videos(GRID_PATTERN["1+2"]) },
        },
        {
          key: "grid-images",
          order: 20,
          short: R.presets["grid-images"].short,
          label: R.presets["grid-images"].label,
          description: R.presets["grid-images"].description,
          defaults: { layout: "3", ratio: "auto", children: images(GRID_PATTERN["3"]) },
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
      label: R.types["image"].label,
      description: R.types["image"].description,
      defaults: { width: "wide" },
      summary: R.types["image"].summary,
      inline: ["captionTitle", "caption", "captionDate"],
      mediaFields: [{ field: "mediaId", kind: "image" }],
      publishCheck: (props, ctx) => (props.mediaId ? null : pub(ctx, "image")),
    }),
    define({
      type: "free-board",
      group: "media",
      order: 30,
      schema: freeBoardSchema,
      Component: FreeBoardBlock,
      Editor: FreeBoardEditor,
      label: R.types["free-board"].label,
      description: R.types["free-board"].description,
      defaults: { format: "3:2", phone: "scale", items: [] },
      summary: R.types["free-board"].summary,
      inline: ["captionTitle", "caption", "captionDate"],
      publishCheck: (props, ctx) => (Array.isArray(props.items) && props.items.length > 0 ? null : pub(ctx, "freeBoard")),
    }),
    define({
      type: "cv",
      group: "other",
      order: 10,
      schema: cvSchema,
      Component: CvBlock,
      Editor: CvEditor,
      label: R.types["cv"].label,
      description: R.types["cv"].description,
      defaults: { eyebrow: { fr: "Parcours", en: "Background" }, title: { fr: "Curriculum vitae", en: "Résumé" }, fileName: "cv" },
      summary: R.types["cv"].summary,
      inline: ["eyebrow", "title", "intro", "button"],
      mediaFields: [{ field: "mediaId", kind: "pdf" }],
      publishCheck: (props, ctx) => (props.mediaId ? null : pub(ctx, "cv")),
    }),
    define({
      type: "section-title",
      group: "text",
      order: 20,
      schema: sectionTitleSchema,
      Component: SectionTitleBlock,
      Editor: SectionTitleEditor,
      label: R.types["section-title"].label,
      description: R.types["section-title"].description,
      // Sans présentation (clé `intro` absente) : aucune place ni texte d'aide pour un champ qu'on n'a pas demandé.
      defaults: { title: L },
      summary: R.types["section-title"].summary,
      inline: ["eyebrow", "title", "intro"],
      publishCheck: (props, ctx) => titleHelpProblem(props) ?? (props.linked && !props.project && !ctx.project ? pub(ctx, "titleProject") : null),
    }),
    define({
      type: "hero",
      group: "other",
      order: 60,
      schema: heroSchema,
      Component: HeroBlock,
      Editor: HeroEditor,
      label: R.types["hero"].label,
      description: R.types["hero"].description,
      defaults: { eyebrow: L, statement: L },
      single: { reason: R.types["hero"].single },
      summary: R.types["hero"].summary,
      // Nom et métier : identité du site (communs aux pages), modifiables en place aussi.
      inline: ["eyebrow", "statement", "scroll", "reel"],
      // L'accroche porte du balisage <mark> : revalidé à la publication (la toile le valide déjà à la saisie).
      publishCheck: (props, ctx) => {
        const s = (props.statement ?? {}) as { fr?: string; en?: string };
        const problem = markedProblem(s.fr ?? "") ?? markedProblem(s.en ?? "");
        return problem ? pub(ctx, "heroStatement", { problem }) : null;
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
      label: R.types["collection-tiles"].label,
      description: R.types["collection-tiles"].description,
      defaults: { eyebrow: L, title: L, mode: "auto", size: "medium" },
      summary: R.types["collection-tiles"].summary,
      // Lot 105 : les textes de chaque entrée aussi (liste choisie à la main : `items.N.…` ; automatique : `tile.<page>.…`, écrit dans les modifications de tuile).
      inline: ["eyebrow", "title", "items.*.eyebrow", "items.*.title", "items.*.intro"],
    }),
    define({
      type: "collection-intro",
      schema: collectionIntroSchema,
      Component: CollectionIntroBlock,
      Editor: CollectionIntroEditor,
      label: R.types["collection-intro"].label,
      description: R.types["collection-intro"].description,
      defaults: { collection: "characters", eyebrow: L, title: L, intro: L, showCounts: true },
      summary: R.types["collection-intro"].summary,
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
      label: R.types["rich-text"].label,
      description: R.types["rich-text"].description,
      // Un champ n'existe que s'il a été demandé : un Texte neuf est un paragraphe seul (lot 19a).
      defaults: { paragraphs: [L] },
      summary: R.types["rich-text"].summary,
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
      notOnSpecial: true,
      label: R.types["contact"].label,
      description: R.types["contact"].description,
      // Les champs n'existent que s'ils ont été demandés (« + Ajouter … » sur la toile, lot 27).
      defaults: { title: { fr: "Écris-moi", en: "Write to me" }, cta: { fr: "Me contacter", en: "Contact me" } },
      summary: R.types["contact"].summary,
      inline: ["eyebrow", "title", "intro", "cta", "submit", "success", "error", "fields.*.label", "fields.*.help"],
      publishCheck: (props, ctx) => {
        if (props.form !== true) return null;
        if (!props.formId) return pub(ctx, "contactNoId");
        // Même contrôle que le rendu public (ContactBlock) : un formulaire invalide ne s'afficherait pas, on refuse de le publier.
        const form = ContactFormSchema.safeParse(props);
        return form.success ? null : pub(ctx, "contactIncomplete", { detail: form.error.issues[0]?.message ?? pub(ctx, "invalidSettings") });
      },
      presets: [
        {
          key: "contact-with-form",
          order: 31,
          short: R.presets["contact-with-form"].short,
          label: R.presets["contact-with-form"].label,
          description: R.presets["contact-with-form"].description,
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
      label: R.types["contact-form"].label,
      description: R.types["contact-form"].description,
      defaults: defaultContactForm(),
      summary: R.types["contact-form"].summary,
      inline: ["eyebrow", "title", "intro", "submit", "success", "error", "fields.*.label", "fields.*.help"],
      deprecated: true,
      publishCheck: (props, ctx) => (props.formId ? null : pub(ctx, "formNoId")),
    }),
    define({
      type: "page-link",
      group: "other",
      order: 50,
      schema: pageLinkSchema,
      Component: PageLinkBlock,
      Editor: PageLinkEditor,
      label: R.types["page-link"].label,
      description: R.types["page-link"].description,
      defaults: { label: L },
      summary: R.types["page-link"].summary,
      inline: ["label"],
      publishCheck: (props, ctx) => (props.pageId ? null : pub(ctx, "pageLink")),
    }),
    // Page introuvable (lot 89) : la Sortie (non supprimable) et l'œuvre au hasard, proposées seulement sur cette page.
    define({
      type: "exit",
      group: "other",
      order: 90,
      onlyOnSpecial: true,
      locked: R.types["exit"].locked,
      single: { reason: R.types["exit"].single },
      schema: exitSchema,
      Component: ExitBlock,
      Editor: ExitEditor,
      label: R.types["exit"].label,
      description: R.types["exit"].description,
      defaults: initialExitProps(),
      summary: R.types["exit"].summary,
      inline: ["eyebrow", "title", "messages.*", "label"],
    }),
    define({
      type: "random-work",
      group: "other",
      order: 95,
      onlyOnSpecial: true,
      schema: randomWorkSchema,
      Component: RandomWorkBlock,
      Editor: RandomWorkEditor,
      label: R.types["random-work"].label,
      description: R.types["random-work"].description,
      defaults: { source: "all", width: "text" },
      summary: R.types["random-work"].summary,
      inline: ["eyebrow"],
      publishCheck: (props, ctx) => {
        if (props.source === "collection" && !props.collection) return pub(ctx, "randomCategory");
        if (props.source === "manual" && !(Array.isArray(props.works) && props.works.length > 0)) return pub(ctx, "randomWorks");
        return null;
      },
    }),
    define({
      type: "profile",
      group: "other",
      order: 20,
      schema: profileSchema,
      Component: ProfileBlock,
      Editor: ProfileEditor,
      label: R.types["profile"].label,
      description: R.types["profile"].description,
      // Les étiquettes et la légende n'existent que si elles ont été demandées (lot 27).
      defaults: { paragraphs: [L] },
      summary: R.types["profile"].summary,
      inline: ["eyebrow", "portraitCaption", "paragraphs.*", "contactEyebrow", "contactLabel", "socialEyebrow"],
      mediaFields: [{ field: "portraitMediaId", kind: "image" }],
    }),

    // Types anciens (avant v0.13) : encore rendus s'ils traînent, plus proposés.
    define({
      type: "featured-projects",
      schema: featuredProjectsSchema,
      Component: FeaturedProjectsBlock,
      Editor: FeaturedProjectsEditor,
      label: R.types["featured-projects"].label,
      description: R.types["featured-projects"].description,
      defaults: { eyebrow: L, title: L, intro: L, limit: 2 },
      summary: R.types["featured-projects"].summary,
      inline: ["eyebrow", "title", "intro"],
      deprecated: true,
    }),
    define({
      type: "collection-projects",
      schema: collectionProjectsSchema,
      Component: CollectionProjectsBlock,
      Editor: CollectionProjectsEditor,
      label: R.types["collection-projects"].label,
      description: R.types["collection-projects"].description,
      defaults: { collection: "characters" },
      summary: R.types["collection-projects"].summary,
      inline: [],
      deprecated: true,
    }),
    define({
      type: "video",
      schema: videoSchema,
      Component: VideoBlock,
      Editor: VideoEditor,
      label: R.types["video"].label,
      description: R.types["video"].description,
      defaults: { reelEyebrow: L, cardsEyebrow: L, cardsTitle: L },
      summary: R.types["video"].summary,
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
export function blockCatalog(special = false, t?: AdminT): BlockCatalogEntry[] {
  // `t` (espace `blockReg`) : noms, descriptions et résumés dans la langue de l'interface ; sans lui, le français.
  const tx = (path: string, fallback: string) => (t ? t(path) : fallback);
  // Les résumés sont des gabarits (`{titre}`, `{enfants|bloc|blocs}`) lus tels quels par renderSummary, pas des messages ICU : texte brut.
  const rawOf = (path: string, fallback: string) => {
    const raw = (t as unknown as { raw?: (key: string) => unknown } | undefined)?.raw;
    return typeof raw === "function" ? String(raw.call(t, path)) : tx(path, fallback);
  };
  return Object.values(BLOCKS).flatMap((b) => {
    // Lot 89 : « Sortie » et « Une œuvre au hasard » ne se proposent que sur la page spéciale ; Contact n'y est pas proposé. Les entrées
    // restent décrites (libellé, résumé) mais cachées : un bloc déjà posé garde son nom dans l'éditeur.
    const hiddenHere = Boolean(b.deprecated) || (special ? Boolean(b.notOnSpecial) : Boolean(b.onlyOnSpecial));
    const base = {
      key: b.type,
      type: b.type,
      label: tx(`types.${b.type}.label`, b.label),
      description: tx(`types.${b.type}.description`, b.description),
      defaults: b.defaults,
      summary: rawOf(`types.${b.type}.summary`, b.summary),
      inline: b.inline,
      ...(b.container ? { container: b.container } : {}),
      ...(b.mediaFields ? { mediaFields: b.mediaFields } : {}),
      ...(b.single ? { single: tx(`types.${b.type}.single`, b.single.reason) } : {}),
      ...(b.locked ? { locked: tx(`types.${b.type}.locked`, b.locked) } : {}),
      ...(hiddenHere ? { hidden: true } : { group: b.group, order: b.order }),
    };
    return [base, ...(b.presets ?? []).map((p) => ({ ...base, key: p.key, label: tx(`presets.${p.key}.label`, p.label), short: tx(`presets.${p.key}.short`, p.short), description: tx(`presets.${p.key}.description`, p.description), defaults: p.defaults, order: p.order, preset: true }))];
  });
}

/**
 * Éléments d'édition sans props (sérialisables vers un composant client) ; le
 * bloc édité leur parvient par contexte (src/blocks/editor-context.tsx).
 */
export function blockEditors(): Record<string, ReactNode> {
  return Object.fromEntries(Object.values(BLOCKS).map((b) => [b.type, createElement(b.Editor)]));
}

/** Nom d'un type de bloc dans la langue de `t` (espace `blockReg`), ou son identifiant s'il est inconnu. */
export function blockTypeLabel(type: string, t?: AdminT): string {
  const def = Object.hasOwn(BLOCKS, type) ? BLOCKS[type] : undefined;
  if (!def) return type;
  return t ? t(`types.${type}.label`) : def.label;
}
