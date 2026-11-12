"use server";

/**
 * Server actions de la corbeille (lot 23) : suppression définitive d'un élément, ou de toute la corbeille.
 * Chacune : `await assertAdmin()`, identifiants validés, refus si l'élément n'est pas à la corbeille.
 */
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import { emptyTrash, purgeOne, type PurgeReport } from "@/lib/edit/trash";
import { fail, type ActionResult } from "@/lib/edit/result";
import { revalidateMedia, revalidateNav, revalidateProjects, revalidateWallpapers } from "@/lib/revalidate";
import { audited } from "@/lib/journal/audit";
import { adminT } from "@/i18n/admin-msg";

const Target = z.strictObject({ kind: z.enum(["page", "project", "media", "wallpaper"]), id: z.number().int().positive() });

/** Supprime définitivement UN élément de la corbeille (jamais un élément en ligne). */
export const purgeTrashItemAction = audited("purgeTrashItemAction", async function purgeTrashItemAction(input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const parsed = Target.safeParse(input);
  if (!parsed.success) return fail(t("Requête invalide."));
  const result = await purgeOne(parsed.data.kind, parsed.data.id);
  if (!result.ok) return fail(result.message);
  // Rien de public n'a changé (l'élément n'y était plus) ; les compteurs et usages se relisent.
  revalidateMedia();
  revalidateWallpapers();
  return { ok: true, data: null };
});

/** Vide la corbeille : purge immédiate, dans l'ordre du job. */
export const emptyTrashAction = audited("emptyTrashAction", async function emptyTrashAction(): Promise<ActionResult<PurgeReport & { kept: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const report = await emptyTrash();
  revalidateMedia();
  revalidateProjects();
  revalidateNav();
  return { ok: true, data: report };
});
