/** Contrat commun des éditeurs de blocs (admin). Module pur, sérialisable. */

import type { AdminMediaRow } from "@/lib/admin";

export type L = { fr: string; en: string };

/** Données de choix fournies par le serveur aux éditeurs (pickers). */
export type EditorContext = {
  pages: { id: number; title: string; slug: string }[];
  /**
   * `draft` : projet créé dans le brouillon de la page éditée. `onPage` : déjà
   * montré par une planche d'une page (publiée ou en brouillon).
   */
  projects: { slug: string; title: string; draft?: boolean; onPage?: boolean }[];
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
  mediaFields?: { field: string; kind: "image" | "video" | "any" }[];
  /** Type ancien : jamais proposé. */
  hidden?: boolean;
  /** Raccourci d'un type (palette). */
  preset?: boolean;
};
