/**
 * Données globales du site éditables depuis la toile (v0.13) : identité
 * (nom, métier, e-mail, mention), menu (liens de l'en-tête) et réseaux.
 * Schémas stricts partagés par le serveur (brouillon, publication, réglages)
 * et les tests. Module pur (zod seulement).
 */
import { z } from "zod";

import { SiteStylesSchema } from "./look";

const Loc = (max: number) => z.strictObject({ fr: z.string().trim().max(max), en: z.string().trim().max(max) });

/** Espaces, caractères de contrôle, bruts ou encodés (%00–%20, %7F) : jamais dans un lien. */
const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f]|%(?:[01][0-9a-f]|20|7f)/i;

/** Lien de menu libre : chemin du site (/…) hors administration et API, ou adresse http(s). */
export function safeNavHref(v: string): boolean {
  if (UNSAFE_CHARS.test(v)) return false;
  if (/^\/(?!\/)[\w\-./~%]*$/.test(v)) {
    if (v.includes("..")) return false;
    // L'administration, l'API, les médias et les fichiers de Next ne sont pas des pages du site.
    return !/^\/(admin|api|media|_next)(\/|$)/i.test(v);
  }
  return safeWebUrl(v);
}

/** Adresse web http(s) (jamais javascript:, data:…, ni espace ou caractère de contrôle, même encodé). */
export function safeWebUrl(v: string): boolean {
  if (UNSAFE_CHARS.test(v)) return false;
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+$/;
/** Lien de réseau : http(s), ou `mailto:adresse` SEULE pour l'e-mail (aucun paramètre ?bcc=, ?body=…). */
export function safeSocialHref(v: string): boolean {
  if (v.startsWith("mailto:")) return v.length <= 260 && !UNSAFE_CHARS.test(v) && !/[?&#]/.test(v) && EMAIL.test(v.slice(7));
  return safeWebUrl(v);
}

/**
 * Lien « à compléter » (données d'avant : `#`, vide) : gardé dans les
 * réglages pour ne rien perdre, montré dans le panneau, jamais publié.
 */
export const isPlaceholderHref = (v: string): boolean => v.trim() === "" || v.trim() === "#";

export const NETWORKS = [
  "instagram",
  "artstation",
  "behance",
  "linkedin",
  "x",
  "bluesky",
  "youtube",
  "vimeo",
  "tiktok",
  "twitch",
  "tumblr",
  "pinterest",
  "cara",
  "linktree",
  "patreon",
  "kofi",
  "kickstarter",
  "discord",
  "email",
  "website",
  "other",
] as const;
export type Network = (typeof NETWORKS)[number];

export const NavItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("page"), pageId: z.number().int().positive(), label: Loc(60).optional() }),
  z.strictObject({
    kind: z.literal("link"),
    href: z.string().trim().max(300).refine(safeNavHref, "Lien invalide : une adresse https://… ou un chemin du site (/…)."),
    label: Loc(60),
  }),
]);
export type NavItem = z.infer<typeof NavItemSchema>;
export const NavSchema = z.array(NavItemSchema).max(12, "12 liens au plus dans le menu.");

export const SocialSchema = z.strictObject({
  label: z.string().trim().min(1, "Donne un nom à ce réseau (ex. Instagram).").max(40),
  // « # » ou vide : lien à compléter (jamais affiché sur le site).
  href: z
    .string()
    .trim()
    .max(300)
    .refine((v) => isPlaceholderHref(v) || safeSocialHref(v), "Lien invalide : une adresse https://… (ou une adresse e-mail)."),
  kind: z.enum(NETWORKS).optional(),
});
export type SocialItem = z.infer<typeof SocialSchema>;
export const SocialsSchema = z.array(SocialSchema).max(12, "12 réseaux au plus.");

/**
 * Nom du site, fr / en (v0.16). `en` vide = le nom français. Une donnée d'avant
 * (simple chaîne : réglage non migré, brouillon, onglet ouvert) est lue comme { fr: chaîne, en: "" }.
 */
export const SiteNameSchema = z.preprocess(
  (v) => (typeof v === "string" ? { fr: v, en: "" } : v),
  z.strictObject({ fr: z.string().trim().min(1, "Le nom du site est obligatoire.").max(80), en: z.string().trim().max(80) }),
);
export type SiteName = { fr: string; en: string };

/** Nom du site dans la langue demandée : le français si l'anglais est vide. */
export function siteNameFor(name: unknown, locale: string): string {
  if (typeof name === "string") return name;
  const o = (name ?? {}) as Partial<SiteName>;
  const fr = typeof o.fr === "string" ? o.fr : "";
  const own = locale === "en" && typeof o.en === "string" ? o.en.trim() : "";
  return own || fr;
}

/** Nom du site lu dans des données quelconques (réglage ancien : chaîne ; nouveau : { fr, en }). */
export function asSiteName(v: unknown): SiteName {
  if (typeof v === "string") return { fr: v, en: "" };
  const o = (v ?? {}) as Partial<SiteName>;
  return { fr: typeof o.fr === "string" ? o.fr : "", en: typeof o.en === "string" ? o.en : "" };
}

export const IdentitySchema = z.strictObject({
  name: SiteNameSchema,
  role: Loc(160),
  email: z.union([z.literal(""), z.string().trim().max(254).regex(EMAIL, "Adresse e-mail invalide (ex. nom@domaine.fr).")]),
  credit: Loc(160),
  /** Icônes des réseaux dans l'en-tête, avant FR/EN (v0.13.1) ; absent = non. */
  headerSocials: z.boolean().optional(),
});

/**
 * Instantané de tout ce qui est commun aux pages (en-tête, pied, réseaux ;
 * lot 2 : styles du site — textes par rôle, arrondi des images).
 */
export const SiteSnapSchema = z.strictObject({ identity: IdentitySchema, nav: NavSchema, socials: SocialsSchema, styles: SiteStylesSchema.optional() });
export type SiteSnap = z.infer<typeof SiteSnapSchema>;

/**
 * Forme canonique d'un instantané du site : `headerSocials: false` ≡ absent
 * (sinon cocher puis décocher laisserait un brouillon « différent » du
 * publié, et un bouton Publier pour rien).
 */
export function canonicalSnap<T extends { identity: { headerSocials?: boolean } }>(snap: T): T {
  if (snap.identity.headerSocials === true) return snap;
  const { headerSocials: _drop, ...identity } = snap.identity;
  void _drop;
  return { ...snap, identity };
}

/** Réseau reconnu d'après l'adresse (sans la réécrire). */
const HOSTS: [RegExp, Network][] = [
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)artstation\.com$/, "artstation"],
  [/(^|\.)behance\.net$/, "behance"],
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)(x|twitter)\.com$/, "x"],
  [/(^|\.)bsky\.(app|social)$/, "bluesky"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)vimeo\.com$/, "vimeo"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)twitch\.tv$/, "twitch"],
  [/(^|\.)tumblr\.com$/, "tumblr"],
  [/(^|\.)pinterest\.[a-z.]+$/, "pinterest"],
  [/(^|\.)cara\.app$/, "cara"],
  [/(^|\.)(linktr\.ee|linktree\.com)$/, "linktree"],
  [/(^|\.)patreon\.com$/, "patreon"],
  [/(^|\.)ko-fi\.com$/, "kofi"],
  [/(^|\.)kickstarter\.com$/, "kickstarter"],
  [/(^|\.)(discord\.gg|discord\.com)$/, "discord"],
];
export function detectNetwork(href: string): Network | null {
  if (href.startsWith("mailto:")) return "email";
  try {
    const host = new URL(href).hostname.toLowerCase();
    for (const [re, n] of HOSTS) if (re.test(host)) return n;
    return "website";
  } catch {
    return null;
  }
}

export const NETWORK_LABELS: Record<Network, string> = {
  instagram: "Instagram",
  artstation: "ArtStation",
  behance: "Behance",
  linkedin: "LinkedIn",
  x: "X (Twitter)",
  bluesky: "Bluesky",
  youtube: "YouTube",
  vimeo: "Vimeo",
  tiktok: "TikTok",
  twitch: "Twitch",
  tumblr: "Tumblr",
  pinterest: "Pinterest",
  cara: "Cara",
  linktree: "Linktree",
  patreon: "Patreon",
  kofi: "Ko-fi",
  kickstarter: "Kickstarter",
  discord: "Discord",
  email: "E-mail",
  website: "Site web",
  other: "Autre lien",
};

/** Réseau retenu pour un lien ajouté : celui choisi, sinon reconnu d'après l'adresse. */
export function socialKind(network: Network, href: string): Network {
  return network === "other" ? (detectNetwork(href) ?? "other") : network;
}

/** Réseau après modification de l'adresse : reconnu si l'ancien était générique. */
export function editedKind(previous: Network | undefined, href: string): Network | undefined {
  const found = detectNetwork(href);
  return found && (!previous || previous === "website" || previous === "other") ? found : previous;
}

/* ---- Repères d'identité des listes de la toile (aperçu instantané, v0.16) ------------ */

/** Clés uniques : un doublon reçoit « #2 », « #3 »… (même adresse listée deux fois). */
export function uniqueKeys(keys: string[]): string[] {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n > 1 ? `${k}#${n}` : k;
  });
}

/** Clé d'un lien du menu : la page, ou l'adresse d'un lien libre. */
export const navKeyOf = (item: { pageId?: number; href: string }): string => (item.pageId ? `p${item.pageId}` : `l:${item.href}`);

/** Clés des liens du menu, dans l'ordre. */
export const navKeys = (items: { pageId?: number; href: string }[]): string[] => uniqueKeys(items.map(navKeyOf));

/** Clé d'un réseau : son nom et son adresse. */
export const socialKeyOf = (s: { label: string; href: string }): string => `${s.label.trim()}|${s.href.trim()}`;

/** Clés des réseaux, dans l'ordre. */
export const socialKeys = (items: { label: string; href: string }[]): string[] => uniqueKeys(items.map(socialKeyOf));
