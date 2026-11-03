import type { ReactNode } from "react";

import type { RawBlock } from "@/lib/pages";

import { cropStyle, lookAttributes, readLook, type Look } from "@/lib/look";
import { own } from "@/lib/own";
import { aloneFlags, cellShare, gridCells, isJustified, type GridShape } from "./grid-layouts";
import { getSiteView } from "@/lib/settings";
import { getActiveTheme } from "@/lib/theme";
import type { PaletteColors } from "@/themes/palette";
import { CardWrap, FondWrap, type CardEnv } from "@/components/ZoneWrap";
import { fondJoins, fondKey, readBackground, supportsFond, type Background, type FondJoin } from "@/themes/fond";
import { pagePalette } from "@/themes/site-palette";
import { getWallpapers } from "@/lib/wallpapers";
import WallpaperAlign from "@/components/WallpaperAlign";
import { cardBorderSignature, cardStyle, paperSignature, paperAttributes, readSurface, resolveSurface, type CardPalette, type Surface } from "@/themes/surface";
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

/**
 * Carte de rubrique (lot 17c) : couche extérieure de la zone (lot 66, `CardWrap` dans src/components/ZoneWrap.tsx) ; largeur, coins et couleurs
 * lisibles dans la carte viennent de `props.surface` et du thème (src/themes/surface.ts). Sans carte, aucune enveloppe en public : DOM inchangé.
 */
function withSurface(node: ReactNode, surface: Surface | undefined, env: CardEnv | null, edit: boolean | undefined, key: string, join?: FondJoin): ReactNode {
  if (!env) return node;
  return (
    <CardWrap key={`card-${key}`} surface={surface} env={env} edit={edit} join={join} id={key}>
      {node}
    </CardWrap>
  );
}

/**
 * Fond de couleur d'un composant (lot 32, src/themes/fond.ts) : une enveloppe pleine largeur de son conteneur (la carte, ou la
 * page) qui peint la couleur sur toute la hauteur du composant ; `join` = fusion avec le voisin de même fond (aucun espace).
 * Lot 105 : les cases d'une grille en ont aussi (le fond habille la case). Sans fond, aucune enveloppe en public ; vue brouillon : toujours là
 * (`data-fond="off"` = `display: contents`) pour que la toile montre un choix tout de suite sans toucher aux nœuds de React.
 * Réutilisable par un conteneur qui rend lui-même sa suite de composants (planche composée).
 */
export function withFond(node: ReactNode, type: string, background: Background | undefined, join: FondJoin, ctx: BlockContext, key: string): ReactNode {
  if (!supportsFond(type)) return node;
  if (!background || !ctx.palette) {
    return ctx.edit ? (
      <div key={`fond-${key}`} className="zone fond-bloc" data-fond="off">
        <div className="fond-in">
          <div className="zone fond-bloc" data-fond-panel="" data-fond="off">
            <div className="fond-in">{node}</div>
          </div>
        </div>
      </div>
    ) : (
      node
    );
  }
  return (
    <FondWrap key={`fond-${key}`} background={background} join={join} palette={ctx.palette} lookup={ctx.wallpapers ? (id) => ctx.wallpapers!.get(id) : undefined} edit={ctx.edit}>
      {node}
    </FondWrap>
  );
}

/**
 * Fond unique (lot 66) : les deux couches d'une zone posées par UN seul appel, dans l'ordre documenté (src/themes/zone.ts) : la carte dehors,
 * le fond dedans. Rendu de toute rubrique (page, conteneur) ; la planche d'un projet pose les mêmes enveloppes (`FondWrap`, ProjectStrip).
 */
function withZone(node: ReactNode, type: string, layers: { surface: Surface | undefined; background: Background | undefined }, join: FondJoin, ctx: BlockContext, key: string, card: CardEnv | null): ReactNode {
  return withSurface(withFond(node, type, layers.background, join, ctx, key), layers.surface, card, ctx.edit, key, join);
}

function renderBlock(block: AnyBlock, ctx: BlockContext, depth: number, parent?: { uid: string }, inherited?: Look, card: CardEnv | null = null, join: FondJoin = { prev: false, next: false }): ReactNode {
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
        {...(def?.locked ? { "data-edit-locked": def.locked } : {})}
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
    const data = parsed.data as GridShape & { zoom?: boolean; project?: string; ratio?: string; children?: { uid: string; type: string; props: Record<string, unknown> }[] };
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
    const kidFonds = kids.map((c) => (supportsFond(c.type) && !(block.type === "grid") ? readBackground(c.props.background) : undefined));
    const kidJoins = fondJoins(kidFonds.map((bg) => fondKey(bg, false)));
    children = kids.map((c, i) => {
      const pass: Look = {};
      if (boxless && i === 0 && look?.spaceTop) pass.spaceTop = look.spaceTop;
      if (boxless && i === kids.length - 1 && look?.spaceBottom) pass.spaceBottom = look.spaceBottom;
      const cellCtx: BlockContext =
        block.type === "grid" && data.layout
          ? {
              ...childCtx,
              cellColumns: isJustified(data) ? (aloneFlags(data, kids.length)[i] ? 1 : Math.max(1, gridCells(data, 0).cols * 0.6)) : cellShare(data, i, kids.length),
              ...(data.layout === "auto" ? { cellAuto: true } : {}),
              ...(data.zoom !== false ? { cellViewer: true } : {}),
              // Grille de planche (lot 39) : ses cases n'ont pas d'identité de bloc, leurs textes se modifient par la grille.
              ...(ctx.inlineEdit && !ctx.edit ? { inlinePrefix: `children.${i}.props.` } : {}),
            }
          : childCtx;
      return renderBlock({ id: -(i + 1), uid: c.uid, type: c.type, props: c.props, corrupt: false }, cellCtx, depth + 1, { uid }, Object.keys(pass).length ? pass : undefined, null, kidJoins[i]);
    });
  }
  // Conteneur sans boîte : ses espaces sont passés à ses composants.
  const shown = BOXLESS.has(block.type) && look ? { ...look, spaceTop: undefined, spaceBottom: undefined } : look;
  // La carte ne concerne que les blocs de premier niveau (`card` n'est transmis qu'à eux).
  const surface = card ? readSurface((block.props as { surface?: unknown } | null)?.surface) : undefined;
  const background = readBackground((block.props as { background?: unknown } | null)?.background);
  // Grille sur la toile (page, ou planche : `gridCanvas`) : uid et mise en forme de chaque case, pour les repères d'édition.
  const cellInfo =
    block.type === "grid" && (ctx.edit || ctx.gridCanvas)
      ? ((parsed.data as { children?: { uid: string; type: string; props: Record<string, unknown> }[] }).children ?? [])
          .filter((c) => own(BLOCKS, c.type) && def.container?.accepts.includes(c.type))
          .map((c) => ({ uid: c.uid, type: c.type, ...(c.props.look ? { look: JSON.stringify(c.props.look) } : {}) }))
      : undefined;
  return wrap(
    withZone(
      withLook(
        <Component key={key} props={parsed.data} ctx={{ ...ctx, blockId: block.id, look, ...(cellInfo ? { cellInfo } : {}) }}>
          {children}
        </Component>,
        shown,
        `look-${key}`,
      ),
      block.type,
      { surface, background },
      join,
      ctx,
      String(key),
      card,
    ),
  );
}

/**
 * Un composant de la suite d'une planche de projet (lot 31) : rendu par le bloc de son type, comme sur une page
 * (mêmes schémas, mêmes composants). Il appartient au projet, pas à la page : jamais de repères d'édition de bloc
 * (`ctx.edit` faux), la couche d'édition de la planche l'enveloppe elle-même. Un composant invalide est ignoré.
 */
export function renderBoardItem(item: { uid: string; type: string; props: Record<string, unknown> }, ctx: BlockContext): ReactNode {
  // Le fond du composant (`props.background`) est posé par la planche, autour de la colonne réglée par `box` et avec la
  // fusion des voisins (ProjectBoardBlock / ProjectStrip, `FondWrap`) : le bloc lui-même n'en pose pas.
  const props = { ...item.props };
  delete props.background;
  return renderBlock({ id: -1, uid: item.uid, type: item.type, props, corrupt: false }, { ...ctx, edit: false, inlineEdit: Boolean(ctx.edit) && (item.type === "rich-text" || item.type === "image" || item.type === "video-single" || item.type === "grid" || item.type === "free-board"), gridCanvas: Boolean(ctx.edit) && item.type === "grid", freeCanvas: Boolean(ctx.edit) && item.type === "free-board", parent: undefined }, 0);
}

/**
 * Palette EFFECTIVE du site (thème + palette du site) : celle sur laquelle un fond de couleur calcule son texte lisible.
 * Pour un composant qui rend lui-même une suite de composants (planche composée) : `ctx.palette` n'est posée que si la page
 * contient un fond ou une carte, et le fond d'un composant de planche n'est pas dans le JSON de la page.
 */
export async function effectivePalette(ctx: BlockContext): Promise<CardPalette> {
  if (ctx.palette) return ctx.palette;
  const [theme, view] = await Promise.all([getActiveTheme(), getSiteView(ctx.locale, ctx.pageId)]);
  return pagePalette(theme.tokens.color as PaletteColors, theme.tokens.palette, view.styles?.palette);
}

export default async function BlockList({ blocks, ctx }: { blocks: RawBlock[]; ctx: BlockContext }) {
  // Toute la page, pour les blocs qui se calculent depuis son contenu (compteurs).
  const baseCtx: BlockContext = { ...ctx, pageBlocks: blocks.filter((b) => !b.corrupt).map((b) => ({ type: b.type, props: b.props })) };
  // Le thème n'est lu que pour une carte (ou en édition, qui peut en créer une) : les pages sans carte restent comme avant.
  let card: CardEnv | null = null;
  // Fond de texte coloré (lot 21) : la palette sert à choisir le texte lisible dessus.
  const coloredBackdrop = blocks.some((b) => !b.corrupt && JSON.stringify(b.props ?? null).includes('"backdropColor"'));
  const coloredBackground = blocks.some((b) => !b.corrupt && JSON.stringify(b.props ?? null).includes('"background":{'));
  if (ctx.edit || coloredBackdrop || coloredBackground || blocks.some((b) => !b.corrupt && readSurface((b.props as { surface?: unknown } | null)?.surface))) {
    const [theme, view] = await Promise.all([getActiveTheme(), getSiteView(ctx.locale, ctx.pageId)]);
    // Palette du site (lot 17f) : quand elle surcharge des couleurs du thème, la carte se calcule sur la palette EFFECTIVE
    // (mêmes règles que le layout : la palette du site est toujours appliquée).
    card = { palette: pagePalette(theme.tokens.color as PaletteColors, theme.tokens.palette, view.styles?.palette), defaults: resolveSurface(theme.tokens.layout?.card ?? {}) };
  }
  // Papiers peints (lot 35) : la bibliothèque n'est lue que si un composant en montre un (fond, papier de carte) ou en vue brouillon.
  const usesWallpaper = ctx.edit || blocks.some((b) => !b.corrupt && /"kind":"wallpaper"|"paperWallpaper"/.test(JSON.stringify(b.props ?? null)));
  const wallpapers = usesWallpaper ? await getWallpapers() : undefined;
  if (card && wallpapers) card.wallpapers = (id) => wallpapers.get(id);
  const base: BlockContext = { ...baseCtx, ...(card ? { palette: card.palette } : {}), ...(wallpapers ? { wallpapers } : {}) };
  // Fond de couleur (lot 32) : un composant se fond dans son voisin de même fond ET de même contenant (carte / page).
  const joins = fondJoins(
    blocks.map((b) => {
      if (b.corrupt || !supportsFond(b.type)) return null;
      const props = b.props as { background?: unknown; surface?: unknown } | null;
      const surface = card ? readSurface(props?.surface) : undefined;
      // Une carte compte avec sa bordure : deux cartes de bordures différentes ne se fondent pas (voir `fondKey`).
      const resolved = surface && card ? resolveSurface(surface, card.defaults) : undefined;
      const paper = surface && card ? paperAttributes(surface, card.wallpapers) : undefined;
      const border = resolved && card ? `${cardBorderSignature(resolved, cardStyle(resolved.color, card.palette), card.palette)}|${paper ? paperSignature(paper.attrs, paper.vars) : ""}` : "";
      return fondKey(readBackground(props?.background), Boolean(surface), border);
    }),
  );
  // Raccord du motif entre composants fusionnés (lot 35) : client, seulement si un composant a un papier peint.
  const alignWallpapers = ctx.edit || blocks.some((b) => !b.corrupt && JSON.stringify(b.props ?? null).includes('"kind":"wallpaper"'));
  return (
    <>
      {blocks.map((block, i) => renderBlock(block, base, 0, undefined, undefined, card, joins[i]))}
      {alignWallpapers && <WallpaperAlign />}
      {ctx.edit && (
        // Toile : « + Ajouter une rubrique » toujours visible en bas de page (EditLayer l'écoute ; absent en aperçu).
        <div className="pe-add-end" data-edit-add-end="" lang="fr">
          <button type="button" data-edit-add="end">
            <span aria-hidden="true">+</span> Ajouter un bloc
          </button>
        </div>
      )}
    </>
  );
}
