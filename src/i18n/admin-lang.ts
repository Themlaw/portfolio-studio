/**
 * Langue de l'interface d'administration (lot 130) : INDÉPENDANTE de la langue du site public (FR / EN du contenu).
 * Réglage par compte (Admin → Sécurité du compte, défaut FR) + cookie `portfolio-admin-lang` pour l'écran de connexion et les
 * appareils sans session. Catalogues `messages/admin.fr.json` / `admin.en.json`, chargés dans /admin seulement (le site public
 * ne les embarque jamais). Module sans dépendance serveur : importé par le serveur, les composants clients et les tests.
 */
import { createTranslator } from "next-intl";

export const ADMIN_LANGS = ["fr", "en"] as const;
export type AdminLang = (typeof ADMIN_LANGS)[number];
export const DEFAULT_ADMIN_LANG: AdminLang = "fr";
export const ADMIN_LANG_COOKIE = "portfolio-admin-lang";
export const ADMIN_LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Langue valide ou null (valeur inconnue, absente ou d'un autre type). */
export function parseAdminLang(value: unknown): AdminLang | null {
  return value === "fr" || value === "en" ? value : null;
}

export type AdminMessages = Record<string, unknown>;

/** Catalogue d'une langue (import dynamique : un seul des deux fichiers part avec la page). */
export async function loadAdminMessages(lang: AdminLang): Promise<AdminMessages> {
  return (lang === "en" ? await import("../../messages/admin.en.json") : await import("../../messages/admin.fr.json")).default as AdminMessages;
}

/** Locale Intl de dates et de nombres pour une langue d'interface. */
export const intlLocale = (lang: AdminLang): string => (lang === "en" ? "en-GB" : "fr-FR");

/** Traducteur sur un espace de noms (serveur, actions, tests) : pluriels et nombres ICU, dates en Intl. */
export function makeAdminTranslator(lang: AdminLang, messages: AdminMessages, namespace?: string) {
  return createTranslator({ locale: intlLocale(lang), messages: messages as never, namespace: namespace as never, onError: () => {}, getMessageFallback: ({ namespace: ns, key }) => `${ns ? `${ns}.` : ""}${key}` }) as unknown as (key: string, values?: Record<string, string | number | Date>) => string;
}
