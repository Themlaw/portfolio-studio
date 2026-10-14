"use server";

/**
 * Server actions des pages. Chacune : `await assertAdmin()`, validation
 * serveur (src/lib/edit/pages.ts), puis invalidation de la page et du menu.
 */
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import {
  createPage,
  deletePage,
  reorderMenu,
  restorePage,
  setInMenu,
  setPublished,
  type PageReference,
} from "@/lib/edit/pages";
import { discardDraft, publishDraft, saveDraft, savePageFromForm, syncDraftFlags, type DraftResult, type PublishResult } from "@/lib/edit/drafts";
import { boardOp, createDraftProject, restoreBoard, type BoardResult } from "@/lib/edit/boards";
import { saveSiteDraft, type SiteResult } from "@/lib/edit/site";
import { collectFonts, installGoogleFont, type InstallResult } from "@/lib/fonts/library";
import { fail, type ActionResult } from "@/lib/edit/result";
import { enqueueCropWarm } from "@/lib/jobs/crop-warm";
import { revalidateNav, revalidatePage, revalidateProject, revalidateSettings } from "@/lib/revalidate";

const Id = z.number().int().positive();

function pageId(id: unknown): number | null {
  const parsed = Id.safeParse(id);
  return parsed.success ? parsed.data : null;
}

export async function createPageAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  await assertAdmin();
  const result = createPage(input);
  if (result.ok) revalidateNav();
  return result;
}

/**
 * Formulaire de page : publie ce qu'il montre (brouillon compris) et vide le
 * brouillon. `rev` : version lue au chargement (contrôle optimiste).
 */
export async function savePageAction(id: unknown, input: unknown, rev: unknown): Promise<DraftResult<{ rev: number }>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  const result = savePageFromForm(pid, input, rev);
  if (!result.ok) return result;
  revalidatePage(pid, { structure: true });
  enqueueCropWarm(pid);
  if (result.data.site) revalidateSettings();
  for (const project of result.data.projects) revalidateProject(project, { structure: true });
  return { ok: true, data: { rev: result.data.rev } };
}

/**
 * Éditeur visuel : enregistrement automatique du brouillon. Rien n'est
 * revalidé : un brouillon n'est jamais dans le cache public, la vue brouillon
 * de l'admin le relit sans cache.
 */
export async function saveDraftAction(id: unknown, draft: unknown, rev: unknown): Promise<DraftResult<{ savedAt: number; rev: number }>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  return saveDraft(pid, draft, rev);
}

/** Publier : validation complète (comme un enregistrement), page et projets touchés revalidés. */
export async function publishDraftAction(id: unknown, rev: unknown): Promise<DraftResult<PublishResult>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  const result = publishDraft(pid, rev);
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
  return result;
}

/** Abandonner les modifications : brouillon et surcouche de la page effacés. */
export async function discardDraftAction(id: unknown, rev: unknown): Promise<DraftResult<{ projects: number[]; rev: number }>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  const result = discardDraft(pid, rev);
  if (!result.ok) return result;
  // Les emplacements « added » supprimés n'étaient pas publics : revalidation
  // par prudence du cache des projets touchés.
  for (const project of result.data.projects) revalidateProject(project, { structure: true });
  return result;
}

/**
 * Planche sur la toile (ajouter à une position, déplacer, retirer l'image ou
 * la place, remplacer, textes) : surcouche d'emplacements de CETTE page,
 * jamais publique avant « Publier ». Rien n'est revalidé.
 */
export async function boardAction(id: unknown, projectId: unknown, op: unknown, rev: unknown): Promise<DraftResult<BoardResult>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  return boardOp(pid, projectId, op, rev);
}

/**
 * Annuler / Rétablir sur une planche : réécrit l'instantané d'avant ou d'après.
 * `from` : la planche telle que l'éditeur la croit ; les textes du projet qui n'en
 * diffèrent pas dans l'instantané gardent leur valeur d'aujourd'hui.
 */
export async function restoreBoardAction(id: unknown, snap: unknown, rev: unknown, from?: unknown): Promise<DraftResult<BoardResult>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  return restoreBoard(pid, snap, rev, from);
}

/**
 * En-tête, pied de page et réseaux (communs au site) modifiés sur la toile :
 * brouillon du site porté par CETTE page (version de la page contrôlée et
 * incrémentée), jamais public avant « Publier ». Rien n'est revalidé.
 */
export async function siteDraftAction(id: unknown, snap: unknown, rev: unknown): Promise<DraftResult<SiteResult>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  return saveSiteDraft(pid, snap, rev);
}

/** Planche neuve : projet créé dans le brouillon de la page (invisible ailleurs). */
export async function createDraftProjectAction(id: unknown, title: unknown): Promise<ActionResult<{ id: number; slug: string; title: string }>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  return createDraftProject(pid, title);
}

export async function setPublishedAction(id: unknown, published: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid || typeof published !== "boolean") return fail("Requête invalide.");
  const result = setPublished(pid, published);
  if (result.ok) {
    syncDraftFlags(pid, { published });
    revalidatePage(pid, { structure: true });
    if (published) enqueueCropWarm(pid);
  }
  return result;
}

export async function setInMenuAction(id: unknown, inMenu: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid || typeof inMenu !== "boolean") return fail("Requête invalide.");
  const result = setInMenu(pid, inMenu);
  if (result.ok) {
    syncDraftFlags(pid, { inMenu });
    revalidateNav();
  }
  return result;
}

export async function reorderMenuAction(ids: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const result = reorderMenu(ids);
  if (result.ok) revalidateNav();
  return result;
}

/** Supprimer = mettre à la corbeille (restaurable 30 jours : `restorePageAction`). */
export async function deletePageAction(
  id: unknown,
): Promise<ActionResult<{ title: string }> | { ok: false; message: string; references: PageReference[] }> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  const result = deletePage(pid);
  if (result.ok) revalidatePage(pid, { structure: true });
  return result;
}

/** Restaure une page de la corbeille (l'adresse reprise entre-temps est remplacée par une variante libre). */
export async function restorePageAction(id: unknown): Promise<ActionResult<{ title: string; slugChanged: boolean }>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  const result = restorePage(pid);
  if (result.ok) {
    revalidatePage(pid, { structure: true });
    // Page publiée : recadrages préparés de nouveau (ils n'étaient plus rendus à la corbeille).
    enqueueCropWarm(pid);
  }
  return result;
}

/**
 * Police Google choisie dans l'éditeur (lot 2) : le serveur télécharge le
 * style demandé (s'il manque) puis le sert lui-même. En cas d'échec, message
 * clair et rien n'est appliqué (l'éditeur n'enregistre le style qu'après).
 */
export async function installFontAction(family: unknown, weight: unknown, italic: unknown): Promise<ActionResult<InstallResult>> {
  await assertAdmin();
  const result = await installGoogleFont(family, weight, italic);
  // Nouvelle face : la feuille @font-face (réglages) change sur toutes les pages.
  if (result.ok && result.data.installed) revalidateSettings();
  return result;
}
