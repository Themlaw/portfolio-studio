"use server";

/**
 * Server actions des pages. Chacune : `await assertAdmin()`, validation
 * serveur (src/lib/edit/pages.ts), puis invalidation de la page et du menu.
 */
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import {
  addToMenuFromEditor,
  createPage,
  deletePage,
  reorderMenu,
  restorePage,
  setInMenu,
  setPublished,
  type PageReference,
} from "@/lib/edit/pages";
import { publishWarnings } from "@/lib/edit/warnings";
import { pasteBlocks, pasteStyle } from "@/lib/edit/paste";
import type { ClipBlock } from "@/lib/edit/clip";
import { discardDraft, publishDraft, saveDraft, savePageInfo, syncDraftFlags, type DraftResult, type PublishResult } from "@/lib/edit/drafts";
import { boardOp, createDraftProject, restoreBoard, type BoardResult } from "@/lib/edit/boards";
import { discardSiteDraft, saveSiteDraft, type SiteResult } from "@/lib/edit/site";
import { readSiteRev } from "@/lib/edit/site-rev";
import type { SiteSnap } from "@/lib/site-schema";
import { collectFonts, installGoogleFont, type InstallResult } from "@/lib/fonts/library";
import { fail, type ActionResult } from "@/lib/edit/result";
import { enqueueCropWarm } from "@/lib/jobs/crop-warm";
import { revalidateNav, revalidatePage, revalidateProject, revalidateSettings } from "@/lib/revalidate";
import { audited } from "@/lib/journal/audit";
import { adminT } from "@/i18n/admin-msg";

const Id = z.number().int().positive();

function pageId(id: unknown): number | null {
  const parsed = Id.safeParse(id);
  return parsed.success ? parsed.data : null;
}

export const createPageAction = audited("createPageAction", async function createPageAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const result = createPage(input);
  if (result.ok) revalidateNav();
  return result;
});

/**
 * Formulaire d'infos de la page (lot 51) : enregistre SEULEMENT les infos (titre, adresses, menu, mise en ligne…).
 * Le brouillon de contenu de l'éditeur n'est jamais publié ici. `keepOldAddress` : ancienne adresse gardée en redirection.
 */
export const savePageInfoAction = audited("savePageInfoAction", async function savePageInfoAction(id: unknown, input: unknown, rev: unknown, keepOldAddress?: unknown): Promise<DraftResult<{ rev: number; redirected: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  const result = savePageInfo(pid, input, rev, { keepOldAddress: keepOldAddress !== false });
  if (!result.ok) return result;
  revalidatePage(pid, { structure: true });
  enqueueCropWarm(pid);
  return result;
});

/**
 * Éditeur visuel : enregistrement automatique du brouillon. Rien n'est
 * revalidé : un brouillon n'est jamais dans le cache public, la vue brouillon
 * de l'admin le relit sans cache.
 */
export const saveDraftAction = audited("saveDraftAction", async function saveDraftAction(id: unknown, draft: unknown, rev: unknown): Promise<DraftResult<{ savedAt: number; rev: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  return saveDraft(pid, draft, rev);
});

/**
 * Coller des blocs (lot 133) : le presse-papiers (localStorage) n'est jamais cru, les blocs repassent par les schémas du registre, les références
 * sont vérifiées et de nouveaux uid sont attribués. Ne modifie rien : l'éditeur pose le résultat dans son brouillon (annuler / rétablir).
 */
export const pasteBlocksAction = audited("pasteBlocksAction", async function pasteBlocksAction(id: unknown, clip: unknown, where: unknown): Promise<ActionResult<{ blocks: ClipBlock[] }>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  return pasteBlocks(pid, clip, where);
});

/** Coller le style seulement (lot 133) : ce que les schémas du bloc visé acceptent (look, carte, fond, apparition). */
export const pasteStyleAction = audited("pasteStyleAction", async function pasteStyleAction(id: unknown, clip: unknown, target: unknown): Promise<ActionResult<{ style: Record<string, unknown> }>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  return pasteStyle(clip, target);
});

/** Publier : validation complète (comme un enregistrement), page et projets touchés revalidés. */
export const publishDraftAction = audited("publishDraftAction", async function publishDraftAction(id: unknown, rev: unknown, live?: unknown): Promise<DraftResult<PublishResult>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  // `live` : l'éditeur a obtenu la confirmation « Mettre cette page en ligne ? » (lot 51) ; un seul geste met contenu et page en ligne.
  const result = publishDraft(pid, rev, { live: live === true });
  if (!result.ok) return result;
  revalidatePage(pid, { structure: true });
  // Recadrages de la page publiée préparés en fond (file image, basse priorité) : pas de première visite lente.
  enqueueCropWarm(pid);
  // En-tête, pied ou réseaux publiés avec la page : toutes les pages changent.
  if (result.data.site) revalidateSettings();
  for (const project of result.data.projects) revalidateProject(project, { structure: true });
  // Polices téléchargées qu'aucun style n'utilise plus (publié ni brouillon) : retirées.
  const fonts = await collectFonts().catch(() => null);
  if (fonts?.removed.length) revalidateSettings();
  // Avertissements non bloquants (lot 52) : images sans description, textes sans traduction anglaise.
  return { ...result, data: { ...result.data, siteRev: readSiteRev(), warnings: publishWarnings(pid) } };
});

/** Abandonner les modifications : brouillon et surcouche de la page effacés. */
export const discardDraftAction = audited("discardDraftAction", async function discardDraftAction(id: unknown, rev: unknown): Promise<DraftResult<{ projects: number[]; rev: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  const result = discardDraft(pid, rev);
  if (!result.ok) return result;
  // Les emplacements « added » supprimés n'étaient pas publics : revalidation
  // par prudence du cache des projets touchés.
  for (const project of result.data.projects) revalidateProject(project, { structure: true });
  return result;
});

/**
 * Planche sur la toile (ajouter à une position, déplacer, retirer l'image ou
 * la place, remplacer, textes) : surcouche d'emplacements de CETTE page,
 * jamais publique avant « Publier ». Rien n'est revalidé.
 */
export const boardAction = audited("boardAction", async function boardAction(id: unknown, projectId: unknown, op: unknown, rev: unknown): Promise<DraftResult<BoardResult>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  return boardOp(pid, projectId, op, rev);
});

/**
 * Annuler / Rétablir sur une planche : réécrit l'instantané d'avant ou d'après.
 * `from` : la planche telle que l'éditeur la croit ; les textes du projet qui n'en
 * diffèrent pas dans l'instantané gardent leur valeur d'aujourd'hui.
 */
export const restoreBoardAction = audited("restoreBoardAction", async function restoreBoardAction(id: unknown, snap: unknown, rev: unknown, from?: unknown): Promise<DraftResult<BoardResult>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  return restoreBoard(pid, snap, rev, from);
});

/**
 * En-tête, pied de page et réseaux (communs au site) modifiés sur la toile :
 * brouillon COMMUN du site (lot 96 ; `id` = la page d'où vient le geste), version du
 * brouillon du site contrôlée et incrémentée, jamais public avant « Publier » d'une page. Rien n'est revalidé.
 */
export const siteDraftAction = audited("siteDraftAction", async function siteDraftAction(id: unknown, snap: unknown, rev: unknown, pageRev: unknown): Promise<DraftResult<SiteResult>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  // `pageRev` : obligatoire pour l'éditeur (la toile s'en sert pour savoir quand son rendu a rattrapé l'écriture).
  if (pageRev === undefined) return fail(t("Requête invalide (version de la page manquante) : recharge l'éditeur."));
  return saveSiteDraft(pid, snap, rev, pageRev);
});

/** « Annuler ces changements du site » : efface le brouillon commun du site (les pages gardent les leurs). */
export const discardSiteDraftAction = audited("discardSiteDraftAction", async function discardSiteDraftAction(rev: unknown): Promise<DraftResult<{ rev: number; snap: SiteSnap }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  return discardSiteDraft(rev);
});

/** Planche neuve : projet créé dans le brouillon de la page (invisible ailleurs). */
export const createDraftProjectAction = audited("createDraftProjectAction", async function createDraftProjectAction(id: unknown, title: unknown): Promise<ActionResult<{ id: number; slug: string; title: string }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  return createDraftProject(pid, title);
});

export const setPublishedAction = audited("setPublishedAction", async function setPublishedAction(id: unknown, published: unknown): Promise<ActionResult<{ warnings?: ReturnType<typeof publishWarnings> } | null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid || typeof published !== "boolean") return fail(t("Requête invalide."));
  const result = setPublished(pid, published);
  if (result.ok) {
    syncDraftFlags(pid, { published });
    revalidatePage(pid, { structure: true });
    if (published) enqueueCropWarm(pid);
    // Mêmes avertissements non bloquants que « Publier » dans l'éditeur (lots 51 + 52).
    if (published) return { ...result, data: { warnings: publishWarnings(pid) } };
  }
  return result;
});

export const setInMenuAction = audited("setInMenuAction", async function setInMenuAction(id: unknown, inMenu: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid || typeof inMenu !== "boolean") return fail(t("Requête invalide."));
  const result = setInMenu(pid, inMenu);
  if (result.ok) {
    syncDraftFlags(pid, { inMenu });
    revalidateNav();
  }
  return result;
});

/** « Ajouter au menu » de l'avertissement de publication (lot 67, CONC-02) : voir `addToMenuFromEditor`. */
export const addToMenuFromEditorAction = audited("addToMenuFromEditorAction", async function addToMenuFromEditorAction(id: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid) return fail(t("Requête invalide."));
  const result = addToMenuFromEditor(pid);
  if (result.ok) revalidateNav();
  return result;
});

export const reorderMenuAction = audited("reorderMenuAction", async function reorderMenuAction(ids: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const result = reorderMenu(ids);
  if (result.ok) revalidateNav();
  return result;
});

/** Supprimer = mettre à la corbeille (restaurable 30 jours : `restorePageAction`). */
export const deletePageAction = audited("deletePageAction", async function deletePageAction(
  id: unknown,
): Promise<ActionResult<{ title: string }> | { ok: false; message: string; references: PageReference[] }> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  const result = deletePage(pid);
  if (result.ok) revalidatePage(pid, { structure: true });
  return result;
});

/** Restaure une page de la corbeille (l'adresse reprise entre-temps est remplacée par une variante libre). */
export const restorePageAction = audited("restorePageAction", async function restorePageAction(id: unknown): Promise<ActionResult<{ title: string; slugChanged: boolean; collectionDropped: boolean; unpublished?: string }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  const result = restorePage(pid);
  if (result.ok) {
    revalidatePage(pid, { structure: true });
    // Page publiée : recadrages préparés de nouveau (ils n'étaient plus rendus à la corbeille).
    enqueueCropWarm(pid);
  }
  return result;
});

/**
 * Police Google choisie dans l'éditeur (lot 2) : le serveur télécharge le
 * style demandé (s'il manque) puis le sert lui-même. En cas d'échec, message
 * clair et rien n'est appliqué (l'éditeur n'enregistre le style qu'après).
 */
export const installFontAction = audited("installFontAction", async function installFontAction(family: unknown, weight: unknown, italic: unknown): Promise<ActionResult<InstallResult>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const result = await installGoogleFont(family, weight, italic);
  // Nouvelle face : la feuille @font-face (réglages) change sur toutes les pages.
  if (result.ok && result.data.installed) revalidateSettings();
  return result;
});
