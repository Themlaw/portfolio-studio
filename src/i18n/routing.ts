import { defineRouting } from "next-intl/routing";

export const locales = ["fr", "en"] as const;
export type AppLocale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "fr",
  localePrefix: "always",
  // L'en-tête HTTP `Link` de next-intl déduirait des hreflang faux (il ignore
  // les slugs localisés en base). Source unique : les <link rel="alternate">
  // émis par generateMetadata.
  alternateLinks: false,
  // Pas de `pathnames` : les slugs localisés viennent de la base (table
  // pages) et sont résolus par la route src/app/[locale]/[[...slug]].
});
