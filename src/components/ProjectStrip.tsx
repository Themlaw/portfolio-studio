"use client";

import { Fragment, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import BoardBox from "@/components/BoardBox";
import StripRail from "@/components/StripRail";
import { BOARD_ITEM_LABELS, type BoardBox as BoardBoxProps, type BoardItemType } from "@/blocks/board-layout";
import { boardMarks } from "@/lib/board-marks";
import type { LocalizedArtwork, LocalizedProject } from "@/lib/gallery";
import { RADIUS_VALUES } from "@/themes/css";

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
  /** Largeur et alignement (appliqués ici pour une bande, côté serveur pour les autres composants). */
  box?: BoardBoxProps;
  /** Carrousel à liste propre (lot 31b) : ses images, déjà lues dans la médiathèque. Absent : la bande des images du projet. */
  artworks?: LocalizedArtwork[];
};

export default function ProjectStrip({
  project,
  deep = false,
  headingLevel = "h2",
  showHeader = true,
  collection,
  slotRadius,
  parts,
}: {
  project: LocalizedProject;
  /** Fond papier profond, pour séparer deux projets sans boîte ni bordure. */
  deep?: boolean;
  headingLevel?: "h2" | "h3";
  /** Nom, contexte et présentation du projet (masqués sous un titre lié au projet). */
  showHeader?: boolean;
  /** Planche filtrée par métier (toile : les images ajoutées en prennent le métier). */
  collection?: string;
  /** Arrondi par image (réglage `look.slotRadius` du bloc, par slug d'emplacement). */
  slotRadius?: Partial<Record<string, keyof typeof RADIUS_VALUES>>;
  /** Suite de composants de la planche ; absente (anciens blocs de projets) : la bande d'images seule. */
  parts?: BoardPart[];
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

  const tProject = project.title;
  /** Une bande : celle des images du projet (légendes, emplacements) ou un carrousel à liste propre. */
  const rail = (part?: BoardPart) =>
    part?.artworks ? (
      <BoardBox box={part.box}>
        <StripRail artworks={part.artworks} title={tProject} idKey={`${project.slug}-${part.uid}`} edit={Boolean(edit)} captions={false} />
      </BoardBox>
    ) : (
      <BoardBox box={part?.box}>
        <StripRail artworks={project.artworks} title={tProject} idKey={project.slug} edit={Boolean(edit)} projectRail captions slotRadius={slotRadius} />
      </BoardBox>
    );

  /** Suite de composants sous l'en-tête : sans `parts` (anciens blocs), la bande seule, comme avant le lot 31. */
  const content = !parts ? (
    rail()
  ) : edit ? (
    <div className="pe-bitems" data-edit-bitems="">
      {parts.map((part, i) => (
        <Fragment key={part.uid}>
          <BoardAdd board={edit.id} index={i} />
          <BoardItemFrame board={edit.id} part={part} index={i} count={parts.length}>
            {part.type === "strip" ? rail(part) : part.node}
          </BoardItemFrame>
        </Fragment>
      ))}
      <BoardAdd board={edit.id} index={parts.length} last empty={parts.length === 0} />
    </div>
  ) : (
    parts.map((part) => <Fragment key={part.uid}>{part.type === "strip" ? rail(part) : part.node}</Fragment>)
  );

  return (
    <section
      className={`strip py-[clamp(3rem,7vw,5.5rem)] ${deep ? "strip-deep bg-bg-deep" : ""}`}
      aria-labelledby={`project-${project.slug}`}
      {...(edit ? { ...boardMarks(edit), "data-edit-board-label": project.title, ...(collection ? { "data-edit-board-collection": collection } : {}) } : {})}
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
                <span data-project-inline="context" data-placeholder="Contexte">
                  {project.context}
                </span>
                {" · "}
                <span data-project-inline="year" data-placeholder="Année">
                  {project.year}
                </span>
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
          >
            {project.title}
          </Heading>
          <p
            className="mt-4 text-base leading-relaxed text-ink-soft"
            {...(editable ? { "data-project-inline": "description", "data-placeholder": "Présentation du projet" } : {})}
          >
            {project.description}
          </p>
        </div>
        )}

        {hasStrip && (
        <span className="eyebrow strip-count">
          {tg("count", { count: shownArtworks.length })}
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
function BoardAdd({ board, index, last = false, empty = false }: { board: number; index: number; last?: boolean; empty?: boolean }) {
  return (
    <div className="pe-bitem-add" data-last={last || undefined} data-empty={empty || undefined} lang="fr">
      <button type="button" data-edit-bitem-add={index} data-board={board} aria-haspopup="menu">
        <span aria-hidden="true">+</span> {empty ? "Ajouter un composant" : "Ajouter"}
        <span className="sr-only"> {index === 0 ? "en tête de la planche" : last ? "en bas de la planche" : `après le composant ${index}`}</span>
      </button>
    </div>
  );
}

/**
 * Toile de l'éditeur : enveloppe d'un composant de la planche, avec sa barre (monter, descendre, réglages,
 * supprimer). Les boutons sont de vrais boutons : le clavier les atteint, BoardLayer les écoute.
 */
function BoardItemFrame({ board, part, index, count, children }: { board: number; part: BoardPart; index: number; count: number; children: ReactNode }) {
  // Bande des images du PROJET (la bande d'origine) ou carrousel à liste propre (lot 31b).
  const projectStrip = part.type === "strip" && !part.artworks;
  const label = projectStrip ? "Images du projet" : BOARD_ITEM_LABELS[part.type];
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
      {...(projectStrip ? { "data-edit-bitem-project": "" } : {})}
      data-board={board}
      {...(part.props ? { "data-edit-bitem-props": part.props } : {})}
      lang="fr"
    >
      <div className="pe-bitem-bar" role="group" aria-label={`${label}, composant ${index + 1} sur ${count}`}>
        {/* Poignée : glisser pour déplacer le composant (BoardLayer) ; les flèches font la même chose au clavier. */}
        <span className="pe-bitem-handle" data-edit-bitem-handle={part.uid} data-board={board} aria-hidden="true" title="Glisser pour déplacer">
          ⠿
        </span>
        <span className="pe-bitem-name">{label}</span>
        {!projectStrip && (
          <button type="button" className="pe-bitem-btn pe-bitem-edit" data-edit-bitem-op="settings" data-uid={part.uid} data-board={board}>
            Réglages
          </button>
        )}
        {op("up", "Monter", "↑", index === 0)}
        {op("down", "Descendre", "↓", index === count - 1)}
        {op("remove", "Supprimer", "✕")}
      </div>
      {!projectStrip && part.empty ? (
        <div className="pe-bitem-empty" data-edit-bitem-pick="">
          <p>{label} : rien à montrer pour le moment.</p>
          <button type="button" data-edit-bitem-op="settings" data-uid={part.uid} data-board={board}>
            {part.type === "rich-text" ? "Écrire le texte" : part.type === "grid" || part.type === "strip" ? "Choisir les images" : part.type === "image" ? "Choisir une image" : "Choisir une vidéo"}
          </button>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
