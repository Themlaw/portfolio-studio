/** Contrat commun des éditeurs de blocs (admin). Module pur, sérialisable. */

import type { AdminMediaRow } from "@/lib/admin";

import type { BlockGroup } from "./groups";
import type { CollectionPage } from "./collection-pages";

export type L = { fr: string; en: string };

/** Données de choix fournies par le serveur aux éditeurs (pickers). */
export type EditorContext = {
  pages: { id: number; title: string; slug: string; collection?: "characters" | "backgrounds" | "animation" | null }[];
  /**
   * `draft` : projet créé dans le brouillon de la page éditée. `onPage` : déjà
   * montré par une planche d'une page (publiée ou en brouillon).
   */
  projects: { slug: string; title: string; draft?: boolean; onPage?: boolean }[];
  /**
   * Le thème en ligne a une ouverture avec un fond visuel (calques, projecteur) :
   * faux pour l'ouverture typographique, où l'option de fond n'est pas proposée.
   */
  heroBackdrop?: boolean;
  /** Pages de collection publiées, dans l'ordre du menu (entrées automatiques des collections, lot 22). */
  collectionPages?: CollectionPage[];
  /** Papiers peints de la bibliothèque, prêts (lot 35) : choix du papier d'une page. */
  wallpapers?: { id: number; name: string; thumb: string | null; size: number; opacity: number }[];
  /** Médiathèque (sans les échecs de traitement). */
  media: AdminMediaRow[];
  /** Éditeur visuel : crée un projet dans le brouillon de la page (son slug, ou null si refusé). */
  createProject?: (name: string) => Promise<string | null>;
  /** Éditeur visuel : montre sur la toile le formulaire, ou son message de confirmation / d'erreur. */
  previewForm?: (pane: "form" | "success" | "error") => void;
};

export type BlockEditorProps = {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Erreurs du serveur, relatives aux props du bloc : { "title.fr": "…" }. */
  errors: Record<string, string>;
  context: EditorContext;
  /** Préfixe unique pour les id HTML (plusieurs blocs par page). */
  idPrefix: string;
};

/** Métadonnées d'un type de bloc envoyées à l'éditeur de page (client). */
export type BlockCatalogEntry = {
  /** Clé de la palette : le type, ou un raccourci (« grid-videos »). */
  key: string;
  type: string;
  label: string;
  description: string;
  defaults: Record<string, unknown>;
  summary: string;
  /** Textes modifiables en place sur la toile (registre, `inline`). */
  inline: string[];
  /** Conteneur : types acceptés. */
  container?: { accepts: string[] };
  /** Champs média remplaçables sur la toile. */
  mediaFields?: { field: string; kind: "image" | "video" | "pdf" | "any" }[];
  /** Type ancien : jamais proposé. */
  hidden?: boolean;
  /** Groupe d'ajout (src/blocks/groups.ts) et rang dans ce groupe. */
  group?: BlockGroup;
  order?: number;
  /** Raccourci d'un type (palette) : un modèle de départ du type, avec son nom court. */
  preset?: boolean;
  short?: string;
  /** Une seule fois par page : raison affichée quand l'ajout est grisé (déjà présent sur la page). */
  single?: string;
};
