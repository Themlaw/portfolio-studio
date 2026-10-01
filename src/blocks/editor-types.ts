/** Contrat commun des éditeurs de blocs (admin). Module pur, sérialisable. */

import type { AdminMediaRow } from "@/lib/admin";

export type L = { fr: string; en: string };

/** Données de choix fournies par le serveur aux éditeurs (pickers). */
export type EditorContext = {
  pages: { id: number; title: string; slug: string }[];
  projects: { slug: string; title: string }[];
  /** Médiathèque (sans les échecs de traitement). */
  media: AdminMediaRow[];
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
  type: string;
  label: string;
  description: string;
  defaults: Record<string, unknown>;
  summary: string;
  /** Textes modifiables en place sur la toile (registre, `inline`). */
  inline: string[];
};
