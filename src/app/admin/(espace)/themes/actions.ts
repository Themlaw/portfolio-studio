"use server";

/**
 * Server actions des thèmes. Chacune : `await assertAdmin()` (vérifié par
 * scripts/test-admin-guard.mjs), validation serveur (src/lib/edit/themes.ts :
 * zod + contraste AA), puis invalidation de l'étiquette « theme ».
 */
import { cookies, draftMode } from "next/headers";
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import { applyKitImport } from "@/lib/kit/apply";
import { logoFromMedia } from "@/lib/kit/logo";
import { purgeKitData, purgeKits } from "@/lib/kit/export-job";
import { isImportId, purgeThemeImports } from "@/lib/kit/import-job";
import { activateTheme, deleteTheme, duplicateTheme, saveTheme } from "@/lib/edit/themes";
import { fail, type ActionResult } from "@/lib/edit/result";
import { resetPublishedSitePalette } from "@/lib/edit/site";
import { revalidateSettings, revalidateTheme } from "@/lib/revalidate";
import { PREVIEW_COOKIE } from "@/lib/theme";
import { adoptOldTheme, keepVersionCopy, pinVersion, revertToVersion, sealEditorSession, applyModel, type ApplyModelResult } from "@/lib/themes/versions";
import type { KitImage } from "@/themes/schema";
import { audited } from "@/lib/journal/audit";
import { adminT } from "@/i18n/admin-msg";

const Id = z.string().regex(/^[a-z0-9-]{1,80}$/);

function themeId(id: unknown): string | null {
  const parsed = Id.safeParse(id);
  return parsed.success ? parsed.data : null;
}

export const duplicateThemeAction = audited("duplicateThemeAction", async function duplicateThemeAction(id: unknown): Promise<ActionResult<{ id: string }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const tid = themeId(id);
  if (!tid) return fail(t("Thème inconnu."));
  const result = duplicateTheme(tid);
  if (result.ok) revalidateTheme();
  return result;
});

const Version = z.number().int().min(1).max(999999);

/**
 * « Utiliser ce modèle » (lot 60). Sans Mon thème : le crée (version 1). Avec : `mode` obligatoire, « replace » (nouvelle version de
 * Mon thème à partir du modèle) ou « second » (thème à part, dans « Mes anciens thèmes »).
 */
export const applyModelAction = audited("applyModelAction", async function applyModelAction(modelId: unknown, mode?: unknown): Promise<ActionResult<ApplyModelResult & { second?: boolean }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const id = themeId(modelId);
  if (!id) return fail(t("Modèle inconnu."));
  if (mode !== undefined && mode !== "replace" && mode !== "second") return fail("Choix inconnu.");
  const result = applyModel(id, mode);
  if (result.ok) revalidateTheme();
  return result;
});

/**
 * « Revenir à cette version » : nouvelle version identique à l'ancienne. `publish` : la met aussitôt en ligne (le site reprend l'ancien
 * aspect) ; sinon elle reste un brouillon.
 */
export const revertVersionAction = audited("revertVersionAction", async function revertVersionAction(id: unknown, n: unknown, publish?: unknown): Promise<ActionResult<{ version: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const tid = themeId(id);
  const v = Version.safeParse(n);
  if (!tid || !v.success) return fail("Version inconnue.");
  const result = revertToVersion(tid, v.data);
  if (!result.ok) return result;
  if (publish === true) {
    const live = activateTheme(tid);
    if (!live.ok) return live;
  }
  revalidateTheme();
  return result;
});

/** « Garder une copie à part » : la version devient un thème à part. */
export const keepVersionCopyAction = audited("keepVersionCopyAction", async function keepVersionCopyAction(id: unknown, n: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const tid = themeId(id);
  const v = Version.safeParse(n);
  if (!tid || !v.success) return fail("Version inconnue.");
  const result = keepVersionCopy(tid, v.data);
  if (result.ok) revalidateTheme();
  return result;
});

/** Marque (ou démarque) une version : le nettoyage ne la supprime jamais. */
export const pinVersionAction = audited("pinVersionAction", async function pinVersionAction(id: unknown, n: unknown, pinned: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const tid = themeId(id);
  const v = Version.safeParse(n);
  if (!tid || !v.success || typeof pinned !== "boolean") return fail("Version inconnue.");
  return pinVersion(tid, v.data, pinned);
});

/** « En faire mon thème (nouvelle version) » : un ancien thème devient une version de Mon thème. */
export const adoptOldThemeAction = audited("adoptOldThemeAction", async function adoptOldThemeAction(oldId: unknown): Promise<ActionResult<{ id: string; version: number; created: boolean }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const tid = themeId(oldId);
  if (!tid) return fail(t("Thème inconnu."));
  const result = adoptOldTheme(tid);
  if (result.ok) revalidateTheme();
  return result;
});

/** Sortie de l'éditeur de thème : la séance d'édition est close, le prochain enregistrement crée une nouvelle version. */
export const closeEditSessionAction = audited("closeEditSessionAction", async function closeEditSessionAction(id: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const tid = themeId(id);
  if (!tid) return fail(t("Thème inconnu."));
  sealEditorSession(tid);
  return { ok: true, data: null };
});

/**
 * `confirmLive` : confirmation de la mise en ligne, exigée (côté serveur) quand un ancien thème en ligne est enregistré. Mon thème
 * (lot 60) : l'enregistrement crée ou met à jour la version en cours (brouillon), sans rien publier.
 */
export const saveThemeAction = audited("saveThemeAction", async function saveThemeAction(id: unknown, input: unknown, confirmLive?: unknown): Promise<ActionResult<{ version?: number; created?: boolean } | null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const tid = themeId(id);
  if (!tid) return fail(t("Thème inconnu."));
  const result = saveTheme(tid, input, confirmLive === true);
  if (result.ok) {
    revalidateTheme();
    // Le thème a changé : ses kits en cache sont périmés.
    await purgeKits(tid);
  }
  return result;
});

/**
 * Mise en ligne d'un thème. `options.resetColors` : les couleurs personnalisées du site ne restent pas par-dessus
 * le nouveau thème (lot 55). Le thème qui était en ligne est retenu (« Revenir au thème précédent »).
 */
export const activateThemeAction = audited("activateThemeAction", async function activateThemeAction(id: unknown, options?: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const tid = themeId(id);
  if (!tid) return fail(t("Thème inconnu."));
  const resetColors = Boolean(options && typeof options === "object" && (options as { resetColors?: unknown }).resetColors === true);
  const result = activateTheme(tid, resetColors);
  if (result.ok) {
    revalidateTheme();
    if (resetColors) revalidateSettings();
  }
  return result;
});

/** « Revenir aux couleurs du thème » : retire les couleurs personnalisées du site (lot 55). */
export const resetSiteColorsAction = audited("resetSiteColorsAction", async function resetSiteColorsAction(): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const result = resetPublishedSitePalette();
  if (result.ok) {
    revalidateSettings();
    revalidateTheme();
  }
  return result;
});

export const deleteThemeAction = audited("deleteThemeAction", async function deleteThemeAction(id: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const tid = themeId(id);
  if (!tid) return fail(t("Thème inconnu."));
  const result = deleteTheme(tid);
  if (result.ok) {
    revalidateTheme();
    // Le thème supprimé était peut-être en aperçu : l'aperçu s'arrête (sinon le site passerait en « aperçu des brouillons » sans explication).
    const jar = await cookies();
    if (jar.get(PREVIEW_COOKIE)?.value === tid) {
      jar.delete(PREVIEW_COOKIE);
      (await draftMode()).disable();
    }
    // Kits en cache, manifestes et aperçus, imports du thème.
    await purgeKitData(tid);
    await purgeThemeImports(tid);
  }
  return result;
});

/**
 * Import de kit relu : crée une NOUVELLE VERSION de Mon thème (brouillon, lot 60) avec les nouveaux
 * assets (jamais le thème en ligne remplacé). Options : `mirror` (une seule flèche redessinée : son miroir pour l'autre),
 * `colors` (couleurs repeintes dans « 8 · Palette »), `base` (thème sur lequel poser le kit).
 */
export const applyKitImportAction = audited("applyKitImportAction", async function applyKitImportAction(themeIdInput: unknown, importId: unknown, options: unknown): Promise<ActionResult<{ id: string; version: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const tid = themeId(themeIdInput);
  if (!tid || !isImportId(importId)) return fail("Import inconnu.");
  const o = (options && typeof options === "object" ? options : {}) as { mirror?: unknown; colors?: unknown; base?: unknown };
  const base = o.base === undefined ? undefined : themeId(o.base);
  if (o.base !== undefined && !base) return fail(t("Thème de départ inconnu."));
  const result = await applyKitImport(tid, importId, { mirror: o.mirror === true, colors: o.colors === true, baseThemeId: base ?? undefined });
  if (result.ok) revalidateTheme();
  return result;
});

/**
 * Logo importé depuis une image de la médiathèque (lot 61, étape « Logo » de l'éditeur) : rend l'élément `signature` à poser dans le
 * thème en cours d'édition ; rien n'est écrit sur le thème avant « Enregistrer ».
 */
export const importThemeLogoAction = audited("importThemeLogoAction", async function importThemeLogoAction(mediaId: unknown): Promise<ActionResult<{ signature: KitImage }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  return logoFromMedia(mediaId);
});
