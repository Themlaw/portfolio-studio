/**
 * Messages d'interface produits CÔTÉ SERVEUR, de façon synchrone (lot 130c) : résultats d'actions, erreurs des routes d'admin,
 * libellés renvoyés par src/lib. La langue est celle du compte qui agit, posée UNE fois par requête par la garde
 * (requireAdmin / assertAdmin : primeAdminLang) dans un emplacement propre à la requête (React cache, comme draft-view.ts) ;
 * hors requête (scripts, tests Node, tâches de fond) : français, sans erreur. Les deux catalogues sont lus statiquement (serveur
 * seulement : le public ne les embarque jamais).
 *
 *   const t = adminT("kitImport");  t("tooBig", { max: 40 })
 *
 * Les valeurs STOCKÉES (journal, base) ne passent jamais par ici : elles restent neutres et se traduisent à l'affichage.
 */
import { cookies } from "next/headers";
import { cache } from "react";

import en from "../../messages/admin.en.json";
import fr from "../../messages/admin.fr.json";
import { readUserAdminLang } from "@/lib/admin-lang";

import { ADMIN_LANG_COOKIE, DEFAULT_ADMIN_LANG, makeAdminTranslator, parseAdminLang, type AdminLang, type AdminMessages, type AdminT } from "./admin-lang";

const slot = cache(() => ({ lang: null as AdminLang | null }));

/** Langue de la requête en cours (français hors requête ou avant la garde). */
export function currentAdminLang(): AdminLang {
  return slot().lang ?? DEFAULT_ADMIN_LANG;
}

export function primeAdminLang(lang: AdminLang): void {
  slot().lang = lang;
}

/** Langue du compte (réglage), sinon du cookie, sinon français : même ordre que getAdminLang (admin-server), sans dépendre de la garde. */
export async function adminLangFor(userId: string | null): Promise<AdminLang> {
  const stored = userId ? readUserAdminLang(userId) : null;
  if (stored) return stored;
  try {
    return parseAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value) ?? DEFAULT_ADMIN_LANG;
  } catch {
    return DEFAULT_ADMIN_LANG;
  }
}

const translators = new Map<string, AdminT>();

/** Traducteur d'un espace de noms dans la langue de la requête (ou de `lang`). */
export function adminT(namespace: string, lang: AdminLang = currentAdminLang()): AdminT {
  const k = `${lang}:${namespace}`;
  let t = translators.get(k);
  if (!t) {
    t = makeAdminTranslator(lang, (lang === "en" ? en : fr) as unknown as AdminMessages, namespace);
    translators.set(k, t);
  }
  return t;
}
