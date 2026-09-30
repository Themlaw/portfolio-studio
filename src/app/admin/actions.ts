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
import { PREVIEW_COOKIE } from "@/lib/theme";

export async function signOutAction(): Promise<void> {
  await assertAdmin();
  await getAuth().api.signOut({ headers: await headers() });
  // Fin de l'aperçu de thème avec la session.
  (await draftMode()).disable();
  (await cookies()).delete(PREVIEW_COOKIE);
  redirect(LOGIN_PATH);
}
