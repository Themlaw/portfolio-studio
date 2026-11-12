"use server";

/** Server action des réglages : assertAdmin + zod (https seulement) + étiquette « settings ». */
import { assertAdmin } from "@/lib/auth/guard";
import { readStoredSeo, saveFavicon, saveSeo } from "@/lib/edit/seo";
import { saveSettings } from "@/lib/edit/settings";
import { deleteFont } from "@/lib/fonts/library";
import { done, fail, type ActionResult } from "@/lib/edit/result";
import { buildFavicons, previewIcon, type FaviconPreview } from "@/lib/favicon";
import { planIcon } from "@/lib/favicon-plan";
import { FaviconInputSchema } from "@/lib/favicon-spec";
import { getSite } from "@/lib/settings";
import { getPublishedTheme } from "@/lib/theme";
import { revalidateSettings, revalidateTheme } from "@/lib/revalidate";
import { audited } from "@/lib/journal/audit";
import { adminT } from "@/i18n/admin-msg";

export const saveSettingsAction = audited("saveSettingsAction", async function saveSettingsAction(input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const result = saveSettings(input);
  if (result.ok) revalidateSettings();
  return result;
});

/** Partage et moteurs de recherche (lot 52) : description du site, image de partage, icône de l'onglet. */
export const saveSeoAction = audited("saveSeoAction", async function saveSeoAction(input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const result = await saveSeo(input);
  if (result.ok) revalidateSettings();
  return result;
});

/** Icône de l'onglet (lot 83) : un seul réglage de site, enregistré depuis Réglages ET depuis l'étape « Logo » de l'éditeur de thème. */
export const saveFaviconAction = audited("saveFaviconAction", async function saveFaviconAction(input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const result = await saveFavicon(input);
  if (result.ok) {
    revalidateSettings();
    revalidateTheme();
  }
  return result;
});

/** Aperçu de l'icône pour un réglage pas encore enregistré (thème en ligne) : onglet clair et sombre, écran d'accueil, avertissements. */
export async function previewFaviconAction(input: unknown): Promise<ActionResult<FaviconPreview>> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = FaviconInputSchema.safeParse(input);
  if (!parsed.success) return fail(t("Réglage invalide."));
  const { mode, mediaId, mono, crop } = parsed.data;
  const seo = readStoredSeo();
  let favicon = seo.favicon;
  if (mode === "image") {
    if (mediaId === null) return fail(t("Choisis d'abord une image de la médiathèque."));
    const built = await buildFavicons(mediaId, crop);
    if (!built.ok) return fail(built.message);
    favicon = { mediaId, dir: built.dir };
  }
  const site = await getSite("fr");
  const plan = planIcon({ ...seo, favicon, faviconMode: { mode, mono, crop } }, await getPublishedTheme(), site.name);
  const preview = await previewIcon(plan);
  return "message" in preview ? fail(preview.message) : done(preview);
}

/** Supprime une police téléchargée inutilisée (Réglages → Polices téléchargées). */
export const deleteFontAction = audited("deleteFontAction", async function deleteFontAction(family: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const result = await deleteFont(family);
  if (!result.ok) return result;
  revalidateSettings();
  return { ok: true, data: null };
});
