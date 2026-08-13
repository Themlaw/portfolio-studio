import { defineRouting } from "next-intl/routing";

export const locales = ["fr", "en"] as const;
export type AppLocale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "fr",
  localePrefix: "always",
  pathnames: {
    "/": "/",
    "/characters": { fr: "/personnages", en: "/characters" },
    "/backgrounds": { fr: "/decors", en: "/backgrounds" },
    "/animation": { fr: "/animation", en: "/animation" },
    "/about": { fr: "/a-propos", en: "/about" },
  },
});

export type AppPathname = keyof typeof routing.pathnames;
