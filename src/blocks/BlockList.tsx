import type { RawBlock } from "@/lib/pages";

import { own } from "@/lib/own";
import { BLOCKS } from "./registry";
import type { BlockContext } from "./types";

/**
 * Rend les blocs d'une page. Chaque bloc est validé par le schéma de son
 * type : un bloc inconnu ou invalide est ignoré (log serveur explicite), il
 * ne fait jamais planter la page.
 *
 * Vue brouillon de l'éditeur visuel (`ctx.edit`) : chaque bloc est enveloppé
 * d'un repère (uid, type, libellé) que la couche d'édition utilise ; un bloc
 * incomplet reste visible, signalé, pour qu'on puisse le corriger.
 */
/** Empreinte courte (FNV-1a) des props d'un bloc. */
function contentHash(props: unknown): string {
  const text = JSON.stringify(props ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export default function BlockList({ blocks, ctx }: { blocks: RawBlock[]; ctx: BlockContext }) {
  return (
    <>
      {blocks.map((block) => {
        // En édition, la clé suit le contenu : un bloc modifié (texte saisi en
        // place dans le DOM) est remonté à neuf au rafraîchissement.
        const key = ctx.edit ? `${block.uid ?? block.id}:${contentHash(block.props)}` : block.id;
        const def = own(BLOCKS, block.type);
        const wrap = (node: React.ReactNode) =>
          ctx.edit ? (
            <div
              key={key}
              style={{ display: "contents" }}
              data-edit-block={block.uid ?? String(block.id)}
              data-edit-type={block.type}
              data-edit-label={def?.label ?? block.type}
            >
              {node}
            </div>
          ) : (
            node
          );
        if (block.corrupt) {
          console.error(`[blocks] page ${ctx.pageId}, bloc ${block.id} (${block.type}) : props JSON illisibles, ignoré`);
          return ctx.edit ? wrap(<p data-edit-invalid="">Bloc illisible : supprime-le.</p>) : null;
        }
        if (!def) {
          console.error(`[blocks] page ${ctx.pageId}, bloc ${block.id} : type inconnu « ${block.type} », ignoré`);
          return ctx.edit ? wrap(<p data-edit-invalid="">Type de bloc inconnu : supprime-le.</p>) : null;
        }
        const parsed = def.schema.safeParse(block.props);
        if (!parsed.success) {
          const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(racine)"}: ${i.message}`).join(" ; ");
          if (!ctx.edit) console.error(`[blocks] page ${ctx.pageId}, bloc ${block.id} (${block.type}) invalide, ignoré — ${issues}`);
          return ctx.edit ? wrap(<p data-edit-invalid="">{def.label} incomplet : complète-le dans « Réglages » ({issues}).</p>) : null;
        }
        const { Component } = def;
        return wrap(<Component key={key} props={parsed.data} ctx={ctx} />);
      })}
    </>
  );
}
