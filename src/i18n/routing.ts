import { defineRouting } from "next-intl/routing";

export const locales = ["fr", "en"] as const;
export type AppLocale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "fr",
  localePrefix: "always",
  // Lot 126 : le français par défaut, JAMAIS une détection automatique. next-intl choisissait la langue d'après l'en-tête
  // Accept-Language du navigateur (et son cookie NEXT_LOCALE, posé d'après le même en-tête) : un navigateur réglé en anglais
  // arrivait toujours sur /en. Ni l'un ni l'autre : « / » et les adresses sans langue vont en français, sauf choix explicite du
  // visiteur au sélecteur (cookie LANG_CHOICE_COOKIE, lu par src/proxy.ts). Une adresse /en/… reste en anglais.
  localeDetection: false,
  localeCookie: false,
  // L'en-tête HTTP `Link` de next-intl déduirait des hreflang faux (il ignore
  // les slugs localisés en base). Source unique : les <link rel="alternate">
  // émis par generateMetadata.
  alternateLinks: false,
  // Pas de `pathnames` : les slugs localisés viennent de la base (table
  // pages) et sont résolus par la route src/app/[locale]/[[...slug]].
});
