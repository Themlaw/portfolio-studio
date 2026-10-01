import type { RawBlock } from "@/lib/pages";

import { own } from "@/lib/own";
import { BLOCKS } from "./registry";
import type { BlockContext } from "./types";

/**
 * Rend les blocs d'une page. Chaque bloc est validé par le schéma de son
 * type : un bloc inconnu ou invalide est ignoré (log serveur explicite), il
 * ne fait jamais planter la page.
 */
export default function BlockList({ blocks, ctx }: { blocks: RawBlock[]; ctx: BlockContext }) {
  return (
    <>
      {blocks.map((block) => {
        if (block.corrupt) {
          console.error(`[blocks] page ${ctx.pageId}, bloc ${block.id} (${block.type}) : props JSON illisibles, ignoré`);
          return null;
        }
        const def = own(BLOCKS, block.type);
        if (!def) {
          console.error(`[blocks] page ${ctx.pageId}, bloc ${block.id} : type inconnu « ${block.type} », ignoré`);
          return null;
        }
        const parsed = def.schema.safeParse(block.props);
        if (!parsed.success) {
          const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(racine)"}: ${i.message}`).join(" ; ");
          console.error(`[blocks] page ${ctx.pageId}, bloc ${block.id} (${block.type}) invalide, ignoré — ${issues}`);
          return null;
        }
        const { Component } = def;
        return <Component key={block.id} props={parsed.data} ctx={ctx} />;
      })}
    </>
  );
}
