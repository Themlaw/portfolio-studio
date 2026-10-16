import { z } from "zod";

import BoardBox from "@/components/BoardBox";
import ProjectStrip, { type BoardPart } from "@/components/ProjectStrip";
import { getProjectBoard, type LocalizedArtwork } from "@/lib/gallery";
import { getMedia } from "@/lib/media";

import WallpaperAlign from "@/components/WallpaperAlign";
import { getWallpapers } from "@/lib/wallpapers";
import type { WallpaperEntry } from "@/themes/wallpaper";
import { effectivePalette, renderBoardItem } from "./BlockList";
import { fondJoins, fondKey, readBackground } from "@/themes/fond";
import { itemEmpty } from "./board-layout";
import { collection, projectSlug, textStyle, tr, type BlockContext } from "./types";

export const projectBoardSchema = z.object({
  /**
   * Slug du projet. Absent dans un brouillon (planche neuve, pas encore
   * nommée) : la publication l'exige (publishCheck du registre), sauf dans un
   * conteneur qui a un projet (la planche prend celui du conteneur).
   */
  project: projectSlug.optional(),
  /** Fond papier profond (alternance des anciennes listes de planches). */
  deep: z.boolean().optional(),
  /** Seulement les œuvres d'un métier (anciennes « planches d'une collection », migration 0014). */
  collection: collection.optional(),
  /** Nom, contexte et présentation du projet en tête de planche (masquable sous un titre lié). */
  header: z.boolean().optional(),
});

/** Styles locaux de l'en-tête (« Ce texte uniquement ») : nom, contexte, année, présentation. */
function headerStyles(ctx: BlockContext) {
  return {
    title: textStyle(ctx, "title").style,
    context: textStyle(ctx, "context").style,
    year: textStyle(ctx, "year").style,
    description: textStyle(ctx, "description").style,
  };
}

/**
 * Images et vidéos d'un carrousel à liste propre (lot 31b), lues dans la médiathèque dans l'ordre choisi. Un média à la
 * corbeille, supprimé ou pas encore prêt n'est pas servi (`getMedia`) : il disparaît du carrousel, sans trou.
 */
async function railArtworks(ids: unknown, locale: BlockContext["locale"]): Promise<LocalizedArtwork[]> {
  const list = (Array.isArray(ids) ? ids : []).filter((x): x is number => Number.isInteger(x));
  const rows = await Promise.all(list.map((id) => getMedia(id)));
  const out: LocalizedArtwork[] = [];
  for (const m of rows) {
    if (!m || m.pdf) continue;
    const alt = m.alt ? tr(m.alt, locale) : "";
    out.push({
      id: `media-${m.id}`,
      slug: `media-${m.id}`,
      collection: "animation",
      title: "",
      description: "",
      alt,
      image: m.url,
      mediaId: m.id,
      ...(m.sources ? { sources: m.sources } : {}),
      ...(m.video ? { video: m.video } : {}),
      width: m.width ?? (m.video ? 1280 : 1200),
      height: m.height ?? (m.video ? 720 : 800),
      year: 0,
      featured: false,
    });
  }
  return out;
}

/**
 * La planche d'un projet : son en-tête, puis la suite de composants du projet (lot 31) — la bande d'images, des
 * grilles, des images, des vidéos, des textes — dans l'ordre que le projet a choisi. Sur la toile de
 * l'éditeur, une planche neuve (sans projet) laisse une place que la couche
 * d'édition remplit (nom du projet, projet existant, dépôt d'images) ; hors
 * de l'éditeur, elle n'affiche rien. Dans un conteneur sans projet propre,
 * elle montre le projet du conteneur.
 */
export default async function ProjectBoardBlock({ props, ctx }: { props: z.infer<typeof projectBoardSchema>; ctx: BlockContext }) {
  const slug = props.project ?? ctx.project;
  const project = slug ? await getProjectBoard(slug, ctx.locale, props.collection) : null;
  if (project) {
    // Toile : si les images du projet sont en cours de modification sur une autre page, la planche
    // porte `data-edit-board-held` (ProjectStrip) et la couche d'édition l'indique au survol.
    // Les composants autres que la bande sont rendus ici (mêmes blocs qu'une page) ; ils appartiennent au projet,
    // pas à la page : la planche est la même partout où elle est affichée.
    // Fond de couleur des composants (lot 32) : mêmes règles que sur une page (fusion des voisins de même fond, bord à bord de la planche).
    const fonds = project.layout.map((item) => readBackground(item.props.background));
    const joins = fondJoins(fonds.map((bg) => fondKey(bg, false)));
    const palette = fonds.some(Boolean) ? await effectivePalette(ctx) : undefined;
    // Papiers peints (lot 35) : les motifs utilisés par les fonds de la planche (bibliothèque lue seulement s'il y en a), passés au client.
    const wallpaperIds = [...new Set(fonds.flatMap((bg) => (bg?.kind === "wallpaper" ? [bg.wallpaper] : [])))];
    let wallpapers: Record<number, WallpaperEntry> | undefined;
    if (wallpaperIds.length) {
      const all = ctx.wallpapers ?? (await getWallpapers());
      wallpapers = Object.fromEntries(wallpaperIds.flatMap((id) => (all.get(id) ? [[id, all.get(id)!] as const] : [])));
    }
    const parts: BoardPart[] = await Promise.all(
      project.layout.map(async (item, i): Promise<BoardPart> => ({
        uid: item.uid,
        type: item.type,
        ...(item.box ? { box: item.box } : {}),
        ...(item.type === "strip" && (item.props.videoMode === "loop" || item.props.videoMode === "player") ? { videoMode: item.props.videoMode } : {}),
        ...(fonds[i] ? { fond: { background: fonds[i]!, join: joins[i] } } : {}),
        ...(item.type === "strip"
          ? item.props.source === "own"
            ? { artworks: await railArtworks(item.props.media, ctx.locale) }
            : {}
          : {
              // Largeur réduite : une image « pleine largeur » reste dans la colonne choisie (cadre du site).
              node: (
                <BoardBox box={item.box}>
                  {renderBoardItem(item, { ...ctx, project: slug })}
                </BoardBox>
              ),
            }),
        // Vue brouillon : réglages et largeur du composant pour le panneau, et repère d'un composant encore vide.
        ...(project.edit && item.props.look ? { look: JSON.stringify(item.props.look) } : {}),
        ...(project.edit ? { props: JSON.stringify({ props: item.props, ...(item.box ? { box: item.box } : {}) }), empty: itemEmpty(item) } : {}),
      })),
    );
    return (
      <>
        <ProjectStrip project={project} deep={props.deep} showHeader={props.header !== false} collection={props.collection} slotRadius={ctx.look?.slotRadius} slotFrame={ctx.look?.slotFrame} styles={headerStyles(ctx)} parts={parts} {...(palette ? { palette } : {})} {...(wallpapers ? { wallpapers } : {})} />
        {wallpapers && <WallpaperAlign />}
      </>
    );
  }
  if (!ctx.edit) return null;
  // Dans un conteneur encore sans projet : la planche attend le choix du conteneur.
  if (ctx.parent && !props.project) {
    return (
      <section className="shell py-[var(--t-board-pad)]" lang="fr">
        <p className="pe-wait" data-edit-board-wait="">
          Planche du projet : choisis d&apos;abord le projet de la rubrique.
        </p>
      </section>
    );
  }
  return (
    <section className="shell py-[var(--t-board-pad)]" data-edit-board-new="" lang="fr">
      <div className="pe-board-new-space" style={{ minHeight: 320 }} />
    </section>
  );
}
