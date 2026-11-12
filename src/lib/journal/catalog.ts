/**
 * Catalogue du journal d'édition (lot 97) : pour chaque server action ou route d'écriture, ce qu'elle fait en français,
 * son type, où lire la page et la version, et (pour le brouillon) comment obtenir l'état d'avant.
 * Une action absente du catalogue est quand même journalisée (type « modification », libellé = son nom).
 * Les LECTURES n'y figurent pas et ne sont pas enveloppées (aucun bruit).
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

import type { EntryType } from "./store";

export type Spec = {
  label: string;
  type: EntryType;
  /** Rang de l'argument qui porte l'identifiant de la page. */
  page?: number;
  /** Rang de l'argument « version du brouillon » (rev). */
  rev?: number;
  /** Rang d'un argument qui nomme la cible (identifiant de thème, de projet, de média…). */
  target?: number;
  /** Rangs des arguments résumés (chemins + valeurs courtes). Défaut : tous sauf page, rev et target. */
  values?: number[];
  /** Brouillon enregistré : instantané d'avant (capturé avant l'action, complété en différé) comparé à l'argument de ce rang. */
  diff?: { arg: number; capture: (args: unknown[]) => unknown; resolve: (captured: unknown, args: unknown[]) => unknown | Promise<unknown> };
  /** Le résultat porte `before` et `after` (en-tête, pied, réseaux du site). */
  diffResult?: boolean;
  /** Ce que la modification touche vit dans : brouillon (pas public) ou en ligne. */
  state?: "brouillon" | "publié";
};

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const pageIdOf = (v: unknown): number | null => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

/**
 * État d'avant d'un enregistrement de brouillon, en deux temps pour ne rien coûter à l'artiste :
 *  - `capture` (avant l'action, une requête) garde le brouillon enregistré tel quel ;
 *  - `resolve` (après la réponse, en différé) le complète, au premier enregistrement d'une séance (pas encore de brouillon), par la
 *    version publiée telle que l'éditeur la reprend.
 */
function captureDraft(args: unknown[]): unknown {
  const id = pageIdOf(args[0]);
  if (id === null) return undefined;
  const row = getDb().select({ draft: schema.pages.draft }).from(schema.pages).where(eq(schema.pages.id, id)).get();
  return row ? { id, draft: row.draft ?? null } : undefined;
}

async function resolveDraft(captured: unknown, args: unknown[]): Promise<unknown> {
  if (!isObj(captured)) return undefined;
  let base: unknown = captured.draft;
  if (!isObj(base)) {
    // Imports à l'appel (pas en tête de fichier) : admin.ts tire l'éditeur et les actions, qui importent ce catalogue (cycle).
    const page = (await import("@/lib/admin")).getPageForEdit(captured.id as number);
    if (!page) return undefined;
    const { title, slug, meta, published, inMenu, accent, wallpaper, collection, blocks } = page;
    base = { title, slug, meta, published, inMenu, accent, wallpaper, collection, blocks: blocks.map((b, i) => ({ uid: `b${i}`, type: b.type, props: b.props })) };
  }
  // Un brouillon d'avant ne porte pas `wallpaper` ni `collection` (= ceux de la page publiée) : on ne signale pas leur apparition comme une modification.
  const draft: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  const next = args[1];
  if (isObj(next)) for (const k of ["wallpaper", "collection"]) if (!(k in draft) && k in next) draft[k] = next[k];
  return draft;
}

export const SPECS: Record<string, Spec> = {
  // Pages et éditeur
  createPageAction: { label: "Page créée", type: "creation" },
  savePageInfoAction: { label: "Infos de la page modifiées", type: "modification", page: 0, rev: 2, values: [1], state: "brouillon" },
  saveDraftAction: { label: "Brouillon modifié", type: "modification", page: 0, rev: 2, state: "brouillon", diff: { arg: 1, capture: captureDraft, resolve: resolveDraft } },
  // Copier / coller (lot 133) : le contenu collé n'est jamais journalisé (seulement la page).
  pasteBlocksAction: { label: "Blocs collés dans le brouillon", type: "creation", page: 0, values: [], state: "brouillon" },
  pasteStyleAction: { label: "Style collé dans le brouillon", type: "modification", page: 0, values: [], state: "brouillon" },
  publishDraftAction: { label: "Page publiée", type: "publication", page: 0, rev: 1, values: [2], state: "publié" },
  discardDraftAction: { label: "Brouillon abandonné", type: "abandon", page: 0, rev: 1, state: "brouillon" },
  boardAction: { label: "Planche d'un projet modifiée", type: "modification", page: 0, rev: 3, values: [1, 2], state: "brouillon" },
  restoreBoardAction: { label: "Planche rétablie (annuler ou rétablir)", type: "restauration", page: 0, rev: 2, values: [3], state: "brouillon" },
  siteDraftAction: { label: "En-tête, pied ou réseaux du site modifiés", type: "modification", page: 0, rev: 2, state: "brouillon", diffResult: true },
  discardSiteDraftAction: { label: "Changements du site annulés", type: "abandon", rev: 0, state: "brouillon" },
  createDraftProjectAction: { label: "Projet créé depuis l'éditeur", type: "creation", page: 0, values: [1] },
  setPublishedAction: { label: "Page mise en ligne ou retirée", type: "publication", page: 0, values: [1], state: "publié" },
  setInMenuAction: { label: "Présence de la page dans le menu modifiée", type: "modification", page: 0, values: [1], state: "publié" },
  addToMenuFromEditorAction: { label: "Page ajoutée au menu", type: "modification", page: 0, state: "publié" },
  reorderMenuAction: { label: "Ordre du menu modifié", type: "modification", state: "publié" },
  deletePageAction: { label: "Page mise à la corbeille", type: "suppression", page: 0 },
  restorePageAction: { label: "Page restaurée depuis la corbeille", type: "restauration", page: 0 },
  installFontAction: { label: "Police installée", type: "import" },
  // Projets
  createProjectAction: { label: "Projet créé", type: "creation" },
  saveProjectAction: { label: "Projet modifié", type: "modification", target: 0, values: [1] },
  reorderProjectsAction: { label: "Ordre des projets modifié", type: "modification" },
  deleteProjectAction: { label: "Projet mis à la corbeille", type: "suppression", target: 0 },
  restoreProjectAction: { label: "Projet restauré", type: "restauration", target: 0 },
  addSlotsAction: { label: "Images ajoutées à un projet", type: "modification", target: 0 },
  saveSlotAction: { label: "Image d'un projet modifiée", type: "modification", target: 0, values: [1] },
  setSlotMediaAction: { label: "Image d'un projet remplacée", type: "modification", target: 0 },
  deleteSlotAction: { label: "Image retirée d'un projet", type: "suppression", target: 0 },
  reorderSlotsAction: { label: "Ordre des images d'un projet modifié", type: "modification", target: 0 },
  // Réglages
  saveSettingsAction: { label: "Réglages du site modifiés", type: "reglage", state: "publié" },
  saveSeoAction: { label: "Partage et référencement modifiés", type: "reglage", state: "publié" },
  saveFaviconAction: { label: "Icône du site modifiée", type: "reglage", state: "publié" },
  deleteFontAction: { label: "Police supprimée", type: "suppression" },
  // Corbeille
  purgeTrashItemAction: { label: "Élément supprimé définitivement", type: "suppression" },
  emptyTrashAction: { label: "Corbeille vidée", type: "suppression" },
  // Médiathèque
  saveMediaAltAction: { label: "Texte alternatif d'une image modifié", type: "modification", target: 0, values: [1] },
  deleteMediaAction: { label: "Média mis à la corbeille", type: "suppression", target: 0 },
  restoreMediaAction: { label: "Média restauré", type: "restauration", target: 0 },
  retryMediaAction: { label: "Traitement d'un média relancé", type: "modification", target: 0 },
  setMediaTagsAction: { label: "Étiquettes d'un média modifiées", type: "modification", target: 0, values: [1] },
  addMediaTagsAction: { label: "Étiquettes ajoutées à des médias", type: "modification", values: [0, 1] },
  removeMediaTagsAction: { label: "Étiquettes retirées de médias", type: "modification", values: [0, 1] },
  renameTagAction: { label: "Étiquette renommée", type: "modification", target: 0, values: [1] },
  mergeTagsAction: { label: "Étiquettes fusionnées", type: "modification", values: [0, 1] },
  deleteTagAction: { label: "Étiquette supprimée", type: "suppression", target: 0 },
  deleteUnusedTagsAction: { label: "Étiquettes inutilisées supprimées", type: "suppression" },
  // Messages (jamais le texte des messages)
  markMessagesSeenAction: { label: "Messages marqués comme lus", type: "modification", values: [] },
  deleteMessageAction: { label: "Message supprimé", type: "suppression", target: 0 },
  deleteAllMessagesAction: { label: "Tous les messages supprimés", type: "suppression", values: [] },
  // Papiers peints, cadres
  createWallpaperAction: { label: "Papier peint ajouté", type: "creation" },
  renameWallpaperAction: { label: "Papier peint renommé", type: "modification", target: 0, values: [1] },
  saveWallpaperPaintAction: { label: "Peinture d'un papier peint modifiée", type: "modification", target: 0, values: [1] },
  trashWallpaperAction: { label: "Papier peint mis à la corbeille", type: "suppression", target: 0 },
  restoreWallpaperAction: { label: "Papier peint restauré", type: "restauration", target: 0 },
  saveCardWallpaperAction: { label: "Papier peint des cartes modifié", type: "modification" },
  renameFrameAction: { label: "Cadre renommé", type: "modification", target: 0, values: [1] },
  setFrameThicknessAction: { label: "Épaisseur d'un cadre modifiée", type: "modification", target: 0, values: [1] },
  deleteFrameAction: { label: "Cadre supprimé", type: "suppression", target: 0 },
  // Thèmes
  duplicateThemeAction: { label: "Thème dupliqué", type: "theme", target: 0 },
  applyModelAction: { label: "Modèle de thème appliqué", type: "theme" },
  revertVersionAction: { label: "Ancienne version de thème rétablie", type: "restauration", target: 0 },
  keepVersionCopyAction: { label: "Copie d'une version de thème gardée", type: "theme", target: 0 },
  pinVersionAction: { label: "Version de thème épinglée ou libérée", type: "theme", target: 0 },
  adoptOldThemeAction: { label: "Ancien thème repris dans Mon thème", type: "theme" },
  closeEditSessionAction: { label: "Session d'édition du thème fermée", type: "theme", target: 0 },
  saveThemeAction: { label: "Thème enregistré", type: "theme", target: 0, values: [1], state: "brouillon" },
  activateThemeAction: { label: "Thème mis en ligne", type: "theme", target: 0, state: "publié" },
  resetSiteColorsAction: { label: "Couleurs du site réinitialisées", type: "theme", state: "publié" },
  deleteThemeAction: { label: "Thème supprimé", type: "suppression", target: 0 },
  applyKitImportAction: { label: "Kit de thème importé", type: "import", target: 0, values: [2] },
  importThemeLogoAction: { label: "Logo du thème importé", type: "import" },
  saveThemeFrameAllAction: { label: "Cadre de tout le thème modifié", type: "theme" },
  // Sauvegardes, compte, premiers pas
  saveBackupSettingsAction: { label: "Réglages des sauvegardes modifiés", type: "reglage" },
  backupNowAction: { label: "Sauvegarde lancée à la main", type: "creation" },
  // Audit P2 : trace du déverrouillage des téléchargements (le mot de passe n'est jamais résumé : aucun argument).
  unlockBackupDownloadAction: { label: "Téléchargement des sauvegardes déverrouillé", type: "compte", values: [] },
  setOnboardingHiddenAction: { label: "Premiers pas masqués ou affichés", type: "modification" },
  signOutAction: { label: "Déconnexion", type: "compte" },
  // Audit P3 : jamais de résumé des arguments (mots de passe).
  changePasswordAction: { label: "Mot de passe changé (autres sessions déconnectées)", type: "compte", values: [] },
  revokeOtherSessionsAction: { label: "Autres sessions déconnectées", type: "compte", values: [] },
  // Routes d'écriture
  "route:upload": { label: "Fichier envoyé", type: "import", values: [] },
  "route:animation": { label: "Animation image par image envoyée", type: "import", values: [] },
  "route:upload-complete": { label: "Envoi par morceaux terminé", type: "import", values: [] },
  "route:upload-cancel": { label: "Envoi annulé", type: "suppression", values: [] },
  "route:theme-import": { label: "Thème importé (archive)", type: "import", values: [] },
  "route:cadre-import": { label: "Cadre importé", type: "import", values: [] },
};
