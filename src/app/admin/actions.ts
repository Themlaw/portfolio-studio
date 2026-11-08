"use server";

/**
 * Server actions de l'admin. Règle (scripts/test-admin-guard.mjs) : chaque
 * action exportée commence par `await assertAdmin()`. (L'aperçu de thème passe
 * par les routes POST /admin/apercu : un formulaire natif peut ouvrir un nouvel
 * onglet, ce que React empêche pour une server action.)
 */
import { cookies, draftMode, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { assertAdmin, LOGIN_PATH } from "@/lib/auth/guard";
import { DRAFT_VIEW_COOKIE } from "@/lib/draft-view";
import { PREVIEW_FROM_COOKIE } from "@/lib/preview";
import { PREVIEW_BANNER_COOKIE, PREVIEW_COOKIE } from "@/lib/theme";
import { audited } from "@/lib/journal/audit";

export const signOutAction = audited("signOutAction", async function signOutAction(): Promise<void> {
  await assertAdmin();
  await getAuth().api.signOut({ headers: await headers() });
  // Fin de l'aperçu de thème et de la vue brouillon avec la session ; tous les cookies de l'app sont effacés (docs/SECURITE.md N19),
  // dont l'indicateur « portfolio-admin » du bouton « Modifier cette page » (src/components/EditThisPage.tsx, posé par le proxy).
  (await draftMode()).disable();
  const jar = await cookies();
  for (const name of [PREVIEW_COOKIE, PREVIEW_BANNER_COOKIE, PREVIEW_FROM_COOKIE, DRAFT_VIEW_COOKIE, "portfolio-admin"]) jar.delete(name);
  redirect(LOGIN_PATH);
});
