"use client";

import { Fragment, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import BoardBox from "@/components/BoardBox";
import EditOnly from "@/components/EditOnly";
import FondWrap from "@/components/FondWrap";
import StripRail from "@/components/StripRail";
import { isVideoMode, VIDEO_MODE_HINTS, VIDEO_MODE_LABELS, VIDEO_MODES } from "@/blocks/video-mode";
import { BOARD_ITEM_LABELS, CAPTION_STYLE_FIELDS, type BoardBox as BoardBoxProps, type BoardItemType } from "@/blocks/board-layout";
import { captionCss, captionStylesOf } from "@/blocks/caption-style";
import { boardMarks } from "@/lib/board-marks";
import type { LocalizedArtwork, LocalizedProject } from "@/lib/gallery";
import type { MediaLookData, Space } from "@/lib/look";
import type { Background, FondJoin } from "@/themes/fond";
import type { CardPalette } from "@/themes/surface";
import type { WallpaperEntry } from "@/themes/wallpaper";

/**
 * La planche de projet : l'unité de lecture du site.
 *
 * Un en-tête qui dit de quoi il s'agit (nature, période, rôle), puis une
 * bande d'images à hauteur commune qui défile horizontalement et déborde
 * volontairement à droite — on doit sentir que le projet continue hors cadre.
 *
 * Pas de carte, pas de passe-partout, pas d'ombre : les images sont posées
 * bord à bord comme des photogrammes sur une table lumineuse. La légende
 * reste visible en permanence, elle n'est pas une récompense au survol.
 */
/**
 * Un composant de la suite de la planche (lot 31), prêt à poser sous l'en-tête. La bande d'images
 * (`strip`) est rendue ici même (elle a besoin des œuvres et de l'état de défilement) ; les autres
 * composants arrivent déjà rendus par le serveur (`node`, mêmes blocs qu'une page).
 * `props` / `empty` : vue brouillon seulement (repère des réglages, composant encore vide).
 */
export type BoardPart = {
  uid: string;
  type: BoardItemType;
  node?: ReactNode;
  empty?: boolean;
  /** Vue brouillon : réglages du composant (JSON), pour le panneau. */
  props?: string;
  /** Vue brouillon : mise en forme propre du composant (JSON, `data-edit-look`), lue par la barre « Aa ». */
  look?: string;
  /** Largeur et alignement (appliqués ici pour une bande, côté serveur pour les autres composants). */
  box?: BoardBoxProps;
  /** Carrousel à liste propre (lot 31b) : ses images, déjà lues dans la médiathèque. Absent : la bande des images du projet. */
  artworks?: LocalizedArtwork[];
  /** Bande des images du projet (lot 39) : la date posée sous chaque image (par slug d'emplacement, texte du langage courant). Absente : l'année. */
  dates?: Record<string, string>;
  /** Lecture des vidéos de la bande (lot 36) : Boucle ou Lecteur ; absent : chaque vidéo suit sa nature. */
  videoMode?: "loop" | "player";
  /** Espace au-dessus de la bande (lot 40, `look.spaceTop` : la bande n'a pas d'enveloppe de bloc) ; absent : l'espace du thème. */
  spaceTop?: Space | number;
  /** Fond de couleur du composant (lot 32) et fusion avec ses voisins de même fond ; posé ici, autour de la colonne réglée par `box`. */
  fond?: { background: Background; join: FondJoin };
};

export default function ProjectStrip({
  project,
  deep = false,
  headingLevel = "h2",
  showHeader = true,
  collection,
  slotLook,
  parts,
  palette,
  wallpapers,
  styles,
  capOwn,
  eager = 0,
}: {
  /** Style propre de chaque légende de la planche (« Ce texte », lot 98), par slug de place, déjà fondu avec celui du projet. */
  capOwn?: Record<string, Partial<Record<"title" | "legend" | "date", CSSProperties>>>;
  /** Nombre d'images de la bande chargées tout de suite (lot 54). */
  eager?: number;
  project: LocalizedProject;
  /** Fond papier profond, pour séparer deux projets sans boîte ni bordure. */
  deep?: boolean;
  headingLevel?: "h2" | "h3";
  /** Nom, contexte et présentation du projet (masqués sous un titre lié au projet). */
  showHeader?: boolean;
  /** Planche filtrée par métier (toile : les images ajoutées en prennent le métier). */
  collection?: string;
  /** Habillage par image (réglage `look.slotLook` du bloc, par slug d'emplacement ; lot 75) : cadre, fond, arrondi, panorama, lecture. */
  slotLook?: Partial<Record<string, MediaLookData>>;
  /** Suite de composants de la planche ; absente (anciens blocs de projets) : la bande d'images seule. */
  parts?: BoardPart[];
  /** Palette effective du site : le texte lisible sur un fond de couleur (seulement si un composant en a un). */
  palette?: CardPalette;
  /** Papiers peints utilisés par les fonds des composants (lot 35), par identifiant. */
  wallpapers?: Record<number, WallpaperEntry>;
  /**
   * Styles locaux des textes de l'en-tête (`look.text` du bloc : « Ce texte uniquement »). Fourni par la planche d'un projet
   * seulement (un bloc = un projet) ; absent ailleurs, où les textes n'ont que le style global de leur rôle.
   */
  styles?: Partial<Record<"title" | "context" | "year" | "description", CSSProperties>>;
}) {
  // Vue brouillon de l'éditeur : repères de la planche (jamais dans le HTML public).
  const edit = project.edit;
  // Textes du projet modifiables en place pour tout projet (surcouche de la page, ou ligne du projet créé ici).
  const editable = Boolean(edit);
  // Les places vides n'existent que sur la toile : ni compteur, ni visionneuse.
  const shownArtworks = edit ? project.artworks.filter((a) => !a.edit?.empty) : project.artworks;
  const tg = useTranslations("gallery");
  const Heading = headingLevel;
  // La bande d'images est un composant facultatif de la planche : sans elle, ni compteur ni « Ajouter des images ».
  const hasStrip = !parts || parts.some((p) => p.type === "strip" && !p.artworks);
  /** Texte de l'en-tête : style local, et clé de style de la barre typographique (toile seulement). */
  const head = (key: "title" | "context" | "year" | "description") => ({
    ...(editable && styles ? { "data-look-key": key } : {}),
    ...(styles?.[key] ? { style: styles[key] } : {}),
  });

  // Style des légendes du projet (lot 98) : le même partout où le projet est affiché (page de projet, accueil, métier).
  const capStyles = captionStylesOf(project.layout);
  const capBase = capStyles ? Object.fromEntries(CAPTION_STYLE_FIELDS.flatMap((f) => (capStyles[f] ? [[f, captionCss(capStyles[f], undefined, palette)]] : []))) : undefined;
  const tProject = project.title;
  /** Une bande : celle des images du projet (légendes, emplacements) ou un carrousel à liste propre. */
  const rail = (part?: BoardPart) =>
    spaced(
      part,
      part?.artworks ? (
        <BoardBox box={part.box}>
          <StripRail artworks={part.artworks} title={tProject} idKey={`${project.slug}-${part.uid}`} edit={Boolean(edit)} editRail={part.uid} captions slotLook={slotLook} videoMode={part.videoMode} capBase={capBase} capOwn={capOwn} eager={eager} />
        </BoardBox>
      ) : (
        <BoardBox box={part?.box}>
          <StripRail artworks={part?.dates ? project.artworks.map((a) => (Object.hasOwn(part.dates!, a.slug) ? { ...a, date: part.dates![a.slug] } : a)) : project.artworks} title={tProject} idKey={project.slug} edit={Boolean(edit)} editRail="" captions slotLook={slotLook} videoMode={part?.videoMode} capBase={capBase} capOwn={capOwn} eager={eager} />
        </BoardBox>
      ),
    );
  /** Espace au-dessus choisi (lot 40) : enveloppe sans boîte qui règle la marge du cadre de la bande (look.css) ; sans choix, rien n'est ajouté. */
  const spaced = (part: BoardPart | undefined, node: ReactNode) => (part?.spaceTop !== undefined ? <div className="strip-spaced" data-strip-pt={typeof part.spaceTop === "number" ? "n" : part.spaceTop} style={typeof part.spaceTop === "number" ? ({ "--kn-pt": `${part.spaceTop}px` } as CSSProperties) : undefined}>{node}</div> : node);

  /** Fond de couleur du composant, bord à bord de la planche (lot 32) ; sans fond : le composant tel quel. */
  const fonded = (part: BoardPart, node: ReactNode) =>
    part.fond && palette ? (
      <FondWrap background={part.fond.background} join={part.fond.join} palette={palette} lookup={wallpapers ? (id) => wallpapers[id] : undefined}>
        {node}
      </FondWrap>
    ) : (
      node
    );
  const body = (part: BoardPart) => fonded(part, part.type === "strip" ? rail(part) : part.node);

  /** Suite de composants sous l'en-tête : sans `parts` (anciens blocs), la bande seule, comme avant le lot 31. */
  const content = !parts ? (
    rail()
  ) : edit ? (
    <div className="pe-bitems" data-edit-bitems="">
      {parts.map((part, i) => (
        <Fragment key={part.uid}>
          <BoardAdd board={edit.id} index={i} first={i === 0} />
          <BoardItemFrame board={edit.id} part={part} index={i} count={parts.length}>
            {body(part)}
          </BoardItemFrame>
        </Fragment>
      ))}
      <BoardAdd board={edit.id} index={parts.length} last empty={parts.length === 0} />
    </div>
  ) : (
    parts.map((part) => <Fragment key={part.uid}>{body(part)}</Fragment>)
  );

  return (
    <section
      className={`strip py-[clamp(3rem,7vw,5.5rem)] ${deep ? "strip-deep bg-bg-deep" : ""}`}
      aria-labelledby={`project-${project.slug}`}
      {...(edit ? { ...boardMarks(edit), ...(capStyles ? { "data-edit-capstyle": JSON.stringify(capStyles) } : {}), "data-edit-board-label": project.title, ...(collection ? { "data-edit-board-collection": collection } : {}) } : {})}
    >
      <header className="shell flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        {showHeader && (
        <div className="max-w-2xl">
          <p className="eyebrow">
            {/* Séparateur seulement entre deux parties non vides ; mêmes nœuds de texte
                qu'avant quand les deux existent (parité au pixel). Vue brouillon :
                contexte et année se modifient en place. */}
            {editable ? (
              <>
                <span data-project-inline="context" data-placeholder="Contexte" {...head("context")}>
                  {project.context}
                </span>
                {" · "}
                <span data-project-inline="year" data-placeholder="Année" {...head("year")}>
                  {project.year}
                </span>
              </>
            ) : styles?.context || styles?.year ? (
              // Un style local sur le contexte ou l'année : chacun dans son <span> (sans style, le balisage reste celui d'avant).
              <>
                {project.context && <span {...head("context")}>{project.context}</span>}
                {project.context && project.year ? " · " : null}
                {project.year && <span {...head("year")}>{project.year}</span>}
              </>
            ) : project.context && project.year ? (
              <>
                {project.context} · {project.year}
              </>
            ) : (
              project.context || project.year
            )}
          </p>
          <Heading
            id={`project-${project.slug}`}
            className="mt-3 font-display text-[clamp(2.2rem,5.5vw,3.5rem)] text-ink"
            {...(editable ? { "data-project-inline": "title", "data-placeholder": "Nom du projet" } : {})}
            {...head("title")}
          >
            {project.title}
          </Heading>
          <p
            className="mt-4 text-base leading-relaxed text-ink-soft"
            {...(editable ? { "data-project-inline": "description", "data-placeholder": "Présentation du projet" } : {})}
            {...head("description")}
          >
            {project.description}
          </p>
        </div>
        )}

        {(hasStrip || project.count > 0) && (
        <span className="eyebrow strip-count">
          {tg("count", { count: parts ? project.count : shownArtworks.length })}
        </span>
        )}
        {/* Toile de l'éditeur : « Ajouter des images » (fichiers de l'ordinateur) à la fin de la planche ; jamais en public. */}
        {edit && hasStrip && (
          <button type="button" className="pe-board-add" data-edit-board-add="" lang="fr">
            Ajouter des images
          </button>
        )}
      </header>

      {content}

    </section>
  );
}

/**
 * Toile de l'éditeur : « + Ajouter » entre deux composants de la planche et en bas (discret, visible au survol
 * de la planche ou au focus ; BoardLayer ouvre le menu des composants permis). Posé en flux sans hauteur : il ne
 * décale rien. Jamais en public.
 */
function BoardAdd({ board, index, last = false, empty = false, first = false }: { board: number; index: number; last?: boolean; empty?: boolean; first?: boolean }) {
  return (
    <EditOnly>
    <div className="pe-bitem-add" data-last={last || undefined} data-empty={empty || undefined} data-first={first || undefined} lang="fr">
      <button type="button" data-edit-bitem-add={index} data-board={board} aria-haspopup="menu">
        <span aria-hidden="true">+</span> {empty ? "Ajouter un bloc" : "Ajouter"}
        <span className="sr-only"> {index === 0 ? "en tête du projet" : last ? "en bas du projet" : `après le bloc ${index}`}</span>
      </button>
    </div>
    </EditOnly>
  );
}

/**
 * Toile de l'éditeur : enveloppe d'un composant de la planche, avec sa barre (monter, descendre, réglages,
 * supprimer). Les boutons sont de vrais boutons : le clavier les atteint, BoardLayer les écoute.
 */
function BoardItemFrame({ board, part, index, count, children }: { board: number; part: BoardPart; index: number; count: number; children: ReactNode }) {
  // Une seule « Images qui défilent » pour l'artiste (lot 31f) : la source (images du projet ou liste propre) ne change ni le nom ni les outils.
  const projectStrip = part.type === "strip" && !part.artworks;
  const isStrip = part.type === "strip";
  const label = BOARD_ITEM_LABELS[part.type];
  // Lecture de la vidéo (lot 36) : le composant Vidéo a son mode sur sa barre. Une bande n'en a plus (lot 38) : chaque vidéo se règle sur
  // son image (barre de l'image), `videoMode` de la bande reste lu au rendu mais n'est plus proposé.
  const videoKey = part.type === "video-single" ? "mode" : null;
  let videoNow: string | undefined = part.type === "video-single" ? "player" : undefined;
  if (videoKey && part.props) {
    try {
      const v = (JSON.parse(part.props) as { props?: Record<string, unknown> }).props?.[videoKey];
      if (isVideoMode(v)) videoNow = v;
    } catch {}
  }
  const op = (name: "up" | "down" | "remove" | "settings", text: string, glyph: string, disabled = false) => (
    <button type="button" className="pe-bitem-btn" data-edit-bitem-op={name} data-uid={part.uid} data-board={board} disabled={disabled} aria-label={`${text} — ${label}`} title={text}>
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
  return (
    <div
      className="pe-bitem"
      data-edit-bitem={part.uid}
      data-edit-bitem-type={part.type}
      {...(isStrip ? { "data-edit-bitem-rail": "" } : {})}
      {...(projectStrip ? { "data-edit-bitem-project": "" } : {})}
      data-board={board}
      {...(part.props ? { "data-edit-bitem-props": part.props } : {})}
      {...(part.look ? { "data-edit-look": part.look } : {})}
      lang="fr"
    >
      <EditOnly>
      <div className="pe-bitem-bar" role="group" aria-label={`${label}, bloc ${index + 1} sur ${count}`}>
        {/* Poignée : glisser pour déplacer le composant (BoardLayer) ; les flèches font la même chose au clavier. */}
        <span className="pe-bitem-handle" data-edit-bitem-handle={part.uid} data-board={board} aria-hidden="true" title="Glisser pour déplacer">
          ⠿
        </span>
        {/* Pas de bouton « Réglages » qui ne ferait que basculer le panneau de gauche (lot 38) : le nom du composant le choisit (ses réglages s'affichent à gauche). */}
        {part.type === "grid" ? (
          <span className="pe-bitem-name">{label}</span>
        ) : (
          <button type="button" className="pe-bitem-btn pe-bitem-name pe-bitem-edit" data-edit-bitem-op="settings" data-uid={part.uid} data-board={board} data-testid="bitem-name" title="Afficher les réglages dans le panneau de gauche">
            {label}
          </button>
        )}
        {/* Seule la grille garde « Réglages » : il ouvre une fenêtre sur la toile. */}
        {part.type === "grid" && (
          <button type="button" className="pe-bitem-btn pe-bitem-edit" data-grid-settings-button="" aria-haspopup="dialog" data-edit-bitem-op="settings" data-uid={part.uid} data-board={board}>
            Réglages
          </button>
        )}
        {isStrip && (
          <button type="button" className="pe-bitem-btn" data-edit-bitem-op="add-images" data-uid={part.uid} data-board={board} data-testid="bitem-add-images" title="Ajouter des images ou des vidéos de l'ordinateur à la fin du carrousel">
            Ajouter des images
          </button>
        )}
        <button type="button" className="pe-bitem-btn" data-edit-bitem-op="fond" data-uid={part.uid} data-board={board} aria-haspopup="dialog" data-testid="bitem-fond-button" title="Fond et carte du composant : le fond de couleur ou papier peint, ou une carte en retrait (un seul des deux ici)">
          Fond &amp; carte
        </button>
        {part.type === "image" && !part.empty && (
          <button type="button" className="pe-bitem-btn" data-edit-bitem-op="size" data-uid={part.uid} data-board={board} aria-haspopup="dialog" data-testid="bitem-size-button" title="Taille et place de l'image (la légende suit)">
            Taille
          </button>
        )}
        <button type="button" className="pe-bitem-btn" data-edit-bitem-op="space" data-uid={part.uid} data-board={board} aria-haspopup="dialog" data-testid="bitem-space-button" title="Espace au-dessus de ce bloc">
          Espace
        </button>
        {videoKey && !part.empty && (
          <span className="pe-seg" role="group" aria-label="Lecture de la vidéo" data-testid="bitem-video-mode">
            <span className="pe-seg-label" aria-hidden="true">
              Lecture
            </span>
            {VIDEO_MODES.map((m) => (
              <button key={m} type="button" className="pe-bitem-btn" data-edit-bitem-op={`video-${m}`} data-uid={part.uid} data-board={board} aria-pressed={videoNow === m} title={VIDEO_MODE_HINTS[m]}>
                {VIDEO_MODE_LABELS[m]}
              </button>
            ))}
          </span>
        )}
        {(part.type === "image" || (part.type === "video-single" && !part.empty)) && (
          <button type="button" className="pe-bitem-btn" data-edit-bitem-op="frame" data-uid={part.uid} data-board={board} aria-haspopup="dialog" data-testid="bitem-frame-button" title={part.type === "image" ? "Cadre autour de la photo" : "Cadre autour de la vidéo"}>
            Cadre
          </button>
        )}
        {part.type === "image" && (
          <button type="button" className="pe-bitem-btn" data-edit-bitem-op="imgbg" data-uid={part.uid} data-board={board} aria-haspopup="dialog" data-testid="bitem-imgbg-button" title="Fond derrière l'image (utile pour un PNG détouré)">
            Fond image
          </button>
        )}
        {op("up", "Monter", "↑", index === 0)}
        {op("down", "Descendre", "↓", index === count - 1)}
        {op("remove", "Supprimer", "✕")}
      </div>
      </EditOnly>
      {/* Une grille vide montre ses places numérotées (lot 31d) : pas de cadre « rien à montrer ». */}
      {!projectStrip && part.empty && part.type !== "grid" && part.type !== "free-board" ? (
        <EditOnly fallback={children}>
        <div className="pe-bitem-empty" data-edit-bitem-pick="">
          <p>{label} : rien à montrer pour le moment.</p>
          <button type="button" data-edit-bitem-op="settings" data-uid={part.uid} data-board={board}>
            {part.type === "rich-text" ? "Écrire le texte" : part.type === "strip" ? "Choisir les images" : part.type === "image" ? "Choisir une image" : "Choisir une vidéo"}
          </button>
        </div>
        </EditOnly>
      ) : (
        children
      )}
    </div>
  );
}
