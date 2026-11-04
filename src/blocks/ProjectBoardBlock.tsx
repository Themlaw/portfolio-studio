import type { CSSProperties } from "react";
import { z } from "zod";

import BoardBox from "@/components/BoardBox";
import ProjectStrip, { type BoardPart } from "@/components/ProjectStrip";
import { getProjectBoard, type LocalizedArtwork } from "@/lib/gallery";
import { claimEager } from "@/lib/eager";
import { readLook } from "@/lib/look";
import { getMedia } from "@/lib/media";

import WallpaperAlign from "@/components/WallpaperAlign";
import { getWallpapers } from "@/lib/wallpapers";
import type { WallpaperEntry } from "@/themes/wallpaper";
import { effectivePalette, renderBoardItem } from "./BlockList";
import { fondJoins, fondKey, readBackground } from "@/themes/fond";
import { captionCss, captionStylesOf } from "./caption-style";
import { isProjectStrip, itemEmpty, MAX_BOARD_ITEMS, ownLayoutOf, ownTextOf, railIds, railKey, railList, stripCaptions } from "./board-layout";
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
  /**
   * Contenu propre à cette page (lot 111) : la suite de composants du projet que CE bloc affiche, à la place du contenu partagé
   * du projet (`projects.layout`). Absent : contenu partagé. Même format que la suite d'un projet ; contrôlée par le serveur
   * (`checkLayout`, src/lib/edit/board-layout.ts) à l'écriture et à la publication.
   */
  layout: z.array(z.unknown()).max(MAX_BOARD_ITEMS).optional(),
  /** Textes propres à cette page (lot 111) : nom, contexte, présentation, année du projet que CE bloc affiche, à la place de ceux du projet. */
  text: z.unknown().optional(),
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
async function railArtworks(props: Record<string, unknown>, uid: string, locale: BlockContext["locale"], edit: boolean): Promise<LocalizedArtwork[]> {
  const list = railList(props);
  const places = railIds(props);
  const captions = stripCaptions(props);
  const rows = await Promise.all(list.map((id) => (id === null ? null : getMedia(id))));
  const out: LocalizedArtwork[] = [];
  for (const [at, m] of rows.entries()) {
    // Titre, Légende et Date de cette place (lot 39) : ils suivent la place, pas l'image (même sur une place vide).
    const texts = captions[`${uid}-${places[at]}`];
    const written = {
      title: texts?.title ? tr(texts.title, locale) : "",
      description: texts?.caption ? tr(texts.caption, locale) : "",
      ...(texts?.date ? { date: tr(texts.date, locale) } : {}),
    };
    if (!m || m.pdf) {
      // Vue brouillon : une place vide (ou un média disparu) garde sa place et son rang, comme un emplacement vide du projet.
      if (edit) {
        out.push({
          id: `empty-${uid}-${at}`,
          slug: `${uid}-${places[at]}`,
          collection: "animation",
          ...written,
          alt: "",
          image: "",
          width: 1200,
          height: 800,
          year: 0,
          featured: false,
          edit: { key: railKey(uid, at), empty: true, pending: false, aspect: 1.5, pos: at },
        });
      }
      continue;
    }
    const alt = m.alt ? tr(m.alt, locale) : "";
    out.push({
      id: `media-${m.id}-${at}`,
      // Arrondi et cadre propres à CETTE place de CE carrousel (`look.slotLook` du bloc, par slug) : ils suivent la place (déplacée, image remplacée) ; deux carrousels qui montrent le même média se règlent chacun.
      slug: `${uid}-${places[at]}`,
      collection: "animation",
      ...written,
      alt,
      image: m.url,
      mediaId: m.id,
      ...(m.sources ? { sources: m.sources } : {}),
      ...(m.video ? { video: m.video } : {}),
      width: m.width ?? (m.video ? 1280 : 1200),
      height: m.height ?? (m.video ? 720 : 800),
      year: 0,
      featured: false,
      ...(edit ? { edit: { key: railKey(uid, at), empty: false, pending: false, aspect: (m.width ?? 1200) / Math.max(1, m.height ?? 800), pos: at } } : {}),
    });
  }
  return out;
}

/** Dates posées sous les images de la bande du projet (par slug d'emplacement), dans la langue de la page ; une date vide masque l'année. */
function stripDates(props: Record<string, unknown>, locale: BlockContext["locale"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(stripCaptions(props))) if (v.date) out[key] = tr(v.date, locale);
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
  const eager = claimEager(2);
  const slug = props.project ?? ctx.project;
  const project = slug ? await getProjectBoard(slug, ctx.locale, props.collection, ownLayoutOf(props), ownTextOf(props)) : null;
  if (project) {
    // Toile : si les images du projet sont en cours de modification sur une autre page, la planche
    // porte `data-edit-board-held` (ProjectStrip) et la couche d'édition l'indique au survol.
    // Les composants autres que la bande sont rendus ici (mêmes blocs qu'une page) ; ils appartiennent au projet, la planche est
    // la même partout où elle est affichée, SAUF si le bloc porte son propre contenu (lot 111, `props.layout`).
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
    // Style des légendes du projet (lot 98) et style propre des légendes de la bande (« Ce texte », `look.text["captions.<place>.<champ>"]`),
    // fondus ici : le propre passe devant celui du projet, qui passe devant celui du site.
    const capStyles = captionStylesOf(project.layout);
    const capOwn: Record<string, Partial<Record<"title" | "legend" | "date", CSSProperties>>> = {};
    for (const [key, style] of Object.entries(ctx.look?.text ?? {})) {
      const m = /^captions\.([a-z0-9-]+)\.(title|caption|date)$/.exec(key);
      if (!m) continue;
      const field = m[2] === "caption" ? "legend" : (m[2] as "title" | "date");
      const css = captionCss(capStyles?.[field], style, palette ?? ctx.palette);
      if (css) (capOwn[m[1]] ??= {})[field] = css;
    }
    const parts: BoardPart[] = await Promise.all(
      project.layout.map(async (item, i): Promise<BoardPart> => ({
        uid: item.uid,
        type: item.type,
        ...(item.box ? { box: item.box } : {}),
        // Bande des images du projet (lot 39) : la date posée sous chaque image (sans date posée, l'année de l'emplacement).
        ...(isProjectStrip(item) ? { dates: stripDates(item.props, ctx.locale) } : {}),
        ...(item.type === "strip" && readLook(item.props.look)?.spaceTop !== undefined ? { spaceTop: readLook(item.props.look)!.spaceTop } : {}),
        ...(item.type === "strip" && (item.props.videoMode === "loop" || item.props.videoMode === "player") ? { videoMode: item.props.videoMode } : {}),
        ...(fonds[i] ? { fond: { background: fonds[i]!, join: joins[i] } } : {}),
        ...(item.type === "strip"
          ? item.props.source === "own"
            ? { artworks: await railArtworks(item.props, item.uid, ctx.locale, Boolean(project.edit)) }
            : {}
          : {
              // Largeur réduite : une image « pleine largeur » reste dans la colonne choisie (cadre du site).
              node: (
                <BoardBox box={item.box}>
                  {renderBoardItem(item, { ...ctx, project: slug, ...(capStyles ? { captionStyle: capStyles } : {}) })}
                </BoardBox>
              ),
            }),
        // Vue brouillon : réglages et largeur du composant pour le panneau, et repère d'un composant encore vide.
        ...(project.edit && item.props.look ? { look: JSON.stringify(item.props.look) } : {}),
        ...(project.edit ? { props: JSON.stringify({ props: item.props, ...(item.box ? { box: item.box } : {}) }), empty: itemEmpty(item) && !(item.type === "strip" && railList(item.props).length > 0) } : {}),
      })),
    );
    return (
      <>
        <ProjectStrip project={project} eager={eager} deep={props.deep} showHeader={props.header !== false} collection={props.collection} slotLook={ctx.look?.slotLook} styles={headerStyles(ctx)} parts={parts} capOwn={capOwn} {...(palette ? { palette } : {})} {...(wallpapers ? { wallpapers } : {})} />
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
          Bloc Projet : choisis d&apos;abord le projet.
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
