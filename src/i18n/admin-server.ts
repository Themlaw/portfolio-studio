/**
 * Langue et traducteur de l'admin côté serveur (lot 130). Ordre : réglage du compte connecté, puis cookie, puis français.
 * Mis en cache par requête : le layout racine, les pages et les actions partagent la même lecture.
 */
import { cookies } from "next/headers";
import { cache } from "react";

import { getAdminSession } from "@/lib/auth/guard";
import { readUserAdminLang } from "@/lib/admin-lang";

import { ADMIN_LANG_COOKIE, DEFAULT_ADMIN_LANG, loadAdminMessages, makeAdminTranslator, parseAdminLang, type AdminLang } from "./admin-lang";

export const getAdminLang = cache(async (): Promise<AdminLang> => {
  let session = null;
  try {
    session = await getAdminSession();
  } catch {
    session = null;
  }
  const stored = session ? readUserAdminLang(session.user.id) : null;
  if (stored) return stored;
  try {
    return parseAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value) ?? DEFAULT_ADMIN_LANG;
  } catch {
    return DEFAULT_ADMIN_LANG;
  }
});

/** Le catalogue complet n'est JAMAIS servi sans session valide (il décrit toute l'interface) : le layout fournit {} aux visiteurs anonymes. */
export const hasAdminSession = cache(async (): Promise<boolean> => {
  try {
    return Boolean(await getAdminSession());
  } catch {
    return false;
  }
});

/** Catalogue de la langue courante (complet : serveur et pages connectées). */
export const getAdminMessages = cache(async () => loadAdminMessages(await getAdminLang()));

/** Catalogue envoyé au navigateur par le layout : complet avec une session, vide sans. */
export const getClientMessages = cache(async () => ((await hasAdminSession()) ? getAdminMessages() : {}));

/** `const t = await getAdminT("account")` puis `t("title")` : serveur seulement (les composants clients : useTranslations). */
export async function getAdminT(namespace?: string) {
  return makeAdminTranslator(await getAdminLang(), await getAdminMessages(), namespace);
}
