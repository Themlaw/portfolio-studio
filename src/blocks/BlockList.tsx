import type { CSSProperties, ReactNode } from "react";

import type { RawBlock } from "@/lib/pages";

import { cropStyle, lookAttributes, readLook, type Look } from "@/lib/look";
import { own } from "@/lib/own";
import { cellShare, type GridLayout } from "./grid-layouts";
import { getSiteView } from "@/lib/settings";
import { getActiveTheme } from "@/lib/theme";
import type { PaletteColors } from "@/themes/palette";
import { pagePalette } from "@/themes/site-palette";
import { cardStyle, cardVars, readSurface, resolveSurface, surfaceAttributes, type CardPalette, type ResolvedSurface, type Surface } from "@/themes/surface";
import { BLOCKS } from "./registry";
import { MAX_NESTING } from "./tree";
import type { BlockContext } from "./types";

/**
 * Rend les blocs d'une page. Chaque bloc est validé par le schéma de son
 * type : un bloc inconnu ou invalide est ignoré (log serveur explicite), il
 * ne fait jamais planter la page.
 *
 * Conteneurs (v0.13) : leurs composants (props.children) sont rendus ici,
 * récursivement, avec le projet du conteneur transmis (`ctx.project`), puis
 * passés au conteneur en `children` : le conteneur n'ajoute aucune boîte en
 * public (parité au pixel des blocs migrés).
 *
 * Vue brouillon de l'éditeur visuel (`ctx.edit`) : chaque bloc est enveloppé
 * d'un repère (uid, type, libellé, conteneur parent) que la couche d'édition
 * utilise ; un bloc incomplet reste visible, signalé, pour qu'on puisse le
 * corriger.
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

type AnyBlock = Pick<RawBlock, "id" | "type" | "props" | "corrupt" | "uid">;

/**
 * Conteneurs sans boîte (le Projet mis en avant ne rend que ses composants) :
 * leurs espaces haut / bas passent à leur premier / dernier composant.
 */
const BOXLESS = new Set(["featured-project"]);

/**
 * Enveloppe de mise en page (lot 2) : `display: contents`, posée seulement si
 * le bloc a des réglages — src/app/look.css règle espaces, arrondi, position
 * du titre et cadrage d'après ses attributs. Sans réglage : DOM inchangé.
 */
function withLook(node: ReactNode, look: Look | undefined, key: string): ReactNode {
  const attrs = lookAttributes(look);
  if (!attrs) return node;
  return (
    <div key={key} className="blk" style={{ display: "contents", ...cropStyle(look) }} {...attrs}>
      {node}
    </div>
  );
}

/** Palette du thème et carte par défaut : lus une fois par page, seulement si une carte est rendue (ou en édition). */
type CardEnv = { palette: CardPalette; defaults: ResolvedSurface };

/**
 * Carte de rubrique (lot 17c) : un aplat de la couleur choisie derrière la rubrique, posé sur le papier du
 * site (src/app/look.css, `.surface-card`) ; largeur, coins et couleurs lisibles dans la carte viennent de
 * `props.surface` et du thème (src/themes/surface.ts). Sans carte, aucune enveloppe en public : DOM inchangé.
 * Vue brouillon : l'enveloppe est toujours là (sans carte : `display: contents`) pour que la toile puisse
 * montrer un choix tout de suite sans toucher aux nœuds de React.
 */
function withSurface(node: ReactNode, surface: Surface | undefined, env: CardEnv | null, edit: boolean | undefined, key: string): ReactNode {
  if (!env) return node;
  const defaults = edit ? { "data-card-default": JSON.stringify(env.defaults) } : {};
  if (!surface) {
    return edit ? (
      <div key={`card-${key}`} className="surface-card" data-surface="off" {...defaults}>
        {node}
      </div>
    ) : (
      node
    );
  }
  const resolved = resolveSurface(surface, env.defaults);
  return (
    <div
      key={`card-${key}`}
      className="surface-card"
      {...surfaceAttributes(resolved)}
      style={cardVars(cardStyle(resolved.color, env.palette)) as CSSProperties}
      {...(edit ? { ...defaults, "data-edit-surface": JSON.stringify(surface) } : {})}
    >
      {node}
    </div>
  );
}

function renderBlock(block: AnyBlock, ctx: BlockContext, depth: number, parent?: { uid: string }, inherited?: Look, card: CardEnv | null = null): ReactNode {
  // En édition, la clé suit le contenu : un bloc modifié (texte saisi en
  // place dans le DOM) est remonté à neuf au rafraîchissement.
  const key = ctx.edit ? `${block.uid ?? block.id}:${contentHash(block.props)}` : (block.uid ?? block.id);
  const def = own(BLOCKS, block.type);
  // Réglages propres du bloc (lus avant le schéma : la toile les montre même
  // pour un bloc incomplet), complétés par ceux de son conteneur sans boîte.
  const ownLook = readLook((block.props as { look?: unknown } | null)?.look);
  const look = inherited ? { ...inherited, ...ownLook } : ownLook;
  const editLook = ctx.edit && ownLook ? JSON.stringify(ownLook) : null;
  const wrap = (node: ReactNode) =>
    ctx.edit ? (
      <div
        key={key}
        style={{ display: "contents" }}
        data-edit-block={block.uid ?? String(block.id)}
        data-edit-type={block.type}
        data-edit-label={def?.label ?? block.type}
        {...(parent ? { "data-edit-parent": parent.uid } : {})}
        {...(def?.container ? { "data-edit-container": def.container.accepts.join(" ") } : {})}
        {...(editLook ? { "data-edit-look": editLook } : {})}
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
  let children: ReactNode[] | undefined;
  if (def.container && depth < MAX_NESTING) {
    const data = parsed.data as { project?: string; layout?: GridLayout; ratio?: string; children?: { uid: string; type: string; props: Record<string, unknown> }[] };
    const uid = block.uid ?? String(block.id);
    const childCtx: BlockContext = {
      ...ctx,
      parent: uid,
      project: data.project ?? ctx.project,
      cell: block.type === "grid",
      cellRatio: block.type === "grid" ? data.ratio : undefined,
    };
    const kids = (data.children ?? []).filter((c) => own(BLOCKS, c.type) && def.container!.accepts.includes(c.type));
    const boxless = BOXLESS.has(block.type);
    children = kids.map((c, i) => {
      const pass: Look = {};
      if (boxless && i === 0 && look?.spaceTop) pass.spaceTop = look.spaceTop;
      if (boxless && i === kids.length - 1 && look?.spaceBottom) pass.spaceBottom = look.spaceBottom;
      const cellCtx: BlockContext = block.type === "grid" && data.layout ? { ...childCtx, cellColumns: cellShare(data.layout, i) } : childCtx;
      return renderBlock({ id: -(i + 1), uid: c.uid, type: c.type, props: c.props, corrupt: false }, cellCtx, depth + 1, { uid }, Object.keys(pass).length ? pass : undefined);
    });
  }
  // Conteneur sans boîte : ses espaces sont passés à ses composants.
  const shown = BOXLESS.has(block.type) && look ? { ...look, spaceTop: undefined, spaceBottom: undefined } : look;
  // La carte ne concerne que les blocs de premier niveau (`card` n'est transmis qu'à eux).
  const surface = card ? readSurface((block.props as { surface?: unknown } | null)?.surface) : undefined;
  return wrap(
    withSurface(
      withLook(
        <Component key={key} props={parsed.data} ctx={{ ...ctx, blockId: block.id, look }}>
          {children}
        </Component>,
        shown,
        `look-${key}`,
      ),
      surface,
      card,
      ctx.edit,
      String(key),
    ),
  );
}

export default async function BlockList({ blocks, ctx }: { blocks: RawBlock[]; ctx: BlockContext }) {
  // Toute la page, pour les blocs qui se calculent depuis son contenu (compteurs).
  const baseCtx: BlockContext = { ...ctx, pageBlocks: blocks.filter((b) => !b.corrupt).map((b) => ({ type: b.type, props: b.props })) };
  // Le thème n'est lu que pour une carte (ou en édition, qui peut en créer une) : les pages sans carte restent comme avant.
  let card: CardEnv | null = null;
  // Fond de texte coloré (lot 21) : la palette sert à choisir le texte lisible dessus.
  const coloredBackdrop = blocks.some((b) => !b.corrupt && JSON.stringify(b.props ?? null).includes('"backdropColor"'));
  if (ctx.edit || coloredBackdrop || blocks.some((b) => !b.corrupt && readSurface((b.props as { surface?: unknown } | null)?.surface))) {
    const [theme, view] = await Promise.all([getActiveTheme(), getSiteView(ctx.locale, ctx.pageId)]);
    // Palette du site (lot 17f) : quand elle surcharge des couleurs du thème, la carte se calcule sur la palette EFFECTIVE
    // (mêmes règles que le layout : en public, une palette devenue illisible est ignorée).
    card = { palette: pagePalette(theme.tokens.color as PaletteColors, theme.tokens.palette, view.styles?.palette, Boolean(ctx.edit)), defaults: resolveSurface(theme.tokens.layout?.card ?? {}) };
  }
  const base: BlockContext = { ...baseCtx, ...(card ? { palette: card.palette } : {}) };
  return (
    <>
      {blocks.map((block) => renderBlock(block, base, 0, undefined, undefined, card))}
      {ctx.edit && (
        // Toile : « + Ajouter une rubrique » toujours visible en bas de page (EditLayer l'écoute ; absent en aperçu).
        <div className="pe-add-end" data-edit-add-end="" lang="fr">
          <button type="button" data-edit-add="end">
            <span aria-hidden="true">+</span> Ajouter une rubrique
          </button>
        </div>
      )}
    </>
  );
}
