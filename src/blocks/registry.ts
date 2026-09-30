/**
 * Registre des types de blocs. Ajouter un type = une entrée ici :
 * { schema zod des props, composant serveur, références } + la déclaration de
 * ses champs-références dans refs.ts. (Le formulaire d'édition s'ajoutera en
 * phase 4.)
 */
import type { ComponentType } from "react";
import type { z } from "zod";

import CollectionIntroBlock, { collectionIntroSchema } from "./CollectionIntroBlock";
import CollectionProjectsBlock, { collectionProjectsSchema } from "./CollectionProjectsBlock";
import CollectionTilesBlock, { collectionTilesSchema } from "./CollectionTilesBlock";
import ContactBlock, { contactSchema } from "./ContactBlock";
import FeaturedProjectsBlock, { featuredProjectsSchema } from "./FeaturedProjectsBlock";
import HeroBlock, { heroSchema } from "./HeroBlock";
import ProfileBlock, { profileSchema } from "./ProfileBlock";
import { BLOCK_REFS, type BlockRefs } from "./refs";
import RichTextBlock, { richTextSchema } from "./RichTextBlock";
import type { BlockContext } from "./types";
import VideoBlock, { videoSchema } from "./VideoBlock";

export type BlockDefinition<S extends z.ZodType = z.ZodType> = {
  type: string;
  schema: S;
  Component: ComponentType<{ props: z.infer<S>; ctx: BlockContext }>;
  /** Champs des props qui désignent un média ou une page (sans FK en base). */
  refs: BlockRefs;
};

function define<S extends z.ZodType>(def: Omit<BlockDefinition<S>, "refs">): BlockDefinition {
  const refs = BLOCK_REFS[def.type];
  if (!refs) throw new Error(`Bloc « ${def.type} » : références non déclarées dans src/blocks/refs.ts`);
  return { ...def, refs } as unknown as BlockDefinition;
}

export const BLOCKS: Record<string, BlockDefinition> = Object.fromEntries(
  [
    define({ type: "hero", schema: heroSchema, Component: HeroBlock }),
    define({ type: "collection-tiles", schema: collectionTilesSchema, Component: CollectionTilesBlock }),
    define({ type: "featured-projects", schema: featuredProjectsSchema, Component: FeaturedProjectsBlock }),
    define({ type: "collection-intro", schema: collectionIntroSchema, Component: CollectionIntroBlock }),
    define({ type: "collection-projects", schema: collectionProjectsSchema, Component: CollectionProjectsBlock }),
    define({ type: "video", schema: videoSchema, Component: VideoBlock }),
    define({ type: "rich-text", schema: richTextSchema, Component: RichTextBlock }),
    define({ type: "contact", schema: contactSchema, Component: ContactBlock }),
    define({ type: "profile", schema: profileSchema, Component: ProfileBlock }),
  ].map((d) => [d.type, d]),
);
