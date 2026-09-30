/**
 * Schéma SQLite (Drizzle) — phase 2 : contenu, thèmes, réglages, médias.
 * Les tables Better Auth et `jobs` viendront avec les phases 3 et 5.
 *
 * Conventions : textes localisés en JSON `{ fr, en }` ; booléens en entier
 * (mode boolean) ; ordre explicite par colonne `position`.
 *
 * Les documents libres (props des blocs, valeurs de réglages, thèmes) sont en
 * TEXTE brut, analysés par src/lib/ avec tolérance : une ligne corrompue est
 * ignorée avec un log, elle ne fait jamais tomber une page.
 */
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type Localized = { fr: string; en: string };

/** Thèmes : `data` est un document validé par ThemeSchema (src/themes/schema.ts). */
export const themes = sqliteTable("themes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  preset: integer("preset", { mode: "boolean" }).notNull().default(false),
  /** JSON (texte) ; analysé et validé à la lecture. */
  data: text("data").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

/** Réglages clé/valeur JSON (activeThemeId, site, socials…). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  /** JSON (texte) ; analysé et validé à la lecture. */
  value: text("value").notNull(),
});

export const media = sqliteTable("media", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Clé de stockage, versionnée par le hash du contenu. */
  key: text("key").notNull().unique(),
  kind: text("kind", { enum: ["image", "video"] }).notNull(),
  mime: text("mime").notNull(),
  originalName: text("original_name"),
  size: integer("size").notNull(),
  width: integer("width"),
  height: integer("height"),
  duration: real("duration"),
  variants: text("variants", { mode: "json" }),
  dominantColor: text("dominant_color"),
  alt: text("alt", { mode: "json" }).$type<Localized>(),
  status: text("status", { enum: ["processing", "ready", "failed"] }).notNull().default("ready"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const pages = sqliteTable("pages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Slug localisé, sans barre ; "" = accueil. */
  slug: text("slug", { mode: "json" }).notNull().$type<Localized>(),
  /** Titre court (menu, fil). */
  title: text("title", { mode: "json" }).notNull().$type<Localized>(),
  /** <title> et meta description. */
  meta: text("meta", { mode: "json" }).$type<{ title: Localized; description: Localized }>(),
  /** null = hors menu. */
  navOrder: integer("nav_order"),
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  themeOverrides: text("theme_overrides", { mode: "json" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const blocks = sqliteTable(
  "blocks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pageId: integer("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: text("type").notNull(),
    /** JSON (texte) ; analysé puis validé par le registre de blocs. */
    props: text("props").notNull(),
  },
  (t) => [index("blocks_page_idx").on(t.pageId, t.position)],
);

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  title: text("title", { mode: "json" }).notNull().$type<Localized>(),
  /** Nature du projet et rôle tenu. */
  context: text("context", { mode: "json" }).notNull().$type<Localized>(),
  description: text("description", { mode: "json" }).notNull().$type<Localized>(),
  /** Période affichée telle quelle, ex. « 2023–2024 ». */
  year: text("year").notNull(),
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),
  position: integer("position").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

/**
 * Emplacements d'une planche. Un slot porte l'œuvre (titre, description,
 * collection…) ; `media_id` null = place gardée (image retirée).
 * L'ordre global des œuvres (collections, couverture, demoreel) suit `id`.
 */
export const slots = sqliteTable(
  "slots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    mediaId: integer("media_id").references(() => media.id, { onDelete: "set null" }),
    slug: text("slug").notNull(),
    collection: text("collection", { enum: ["characters", "backgrounds", "animation"] }).notNull(),
    title: text("title", { mode: "json" }).notNull().$type<Localized>(),
    description: text("description", { mode: "json" }).notNull().$type<Localized>(),
    year: integer("year").notNull(),
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    duration: text("duration"),
    videoId: text("video_id"),
    reel: integer("reel", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("slots_project_idx").on(t.projectId, t.position),
    uniqueIndex("slots_slug_idx").on(t.slug),
  ],
);

/* ------------------------------------------------------------------------
 * Authentification (Better Auth, adaptateur Drizzle). Noms de propriétés =
 * champs attendus par Better Auth ; colonnes SQL en snake_case.
 * --------------------------------------------------------------------- */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    /** Haché (scrypt) pour le fournisseur « credential ». */
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** Compteurs de limitation de débit (connexion), persistés entre redémarrages. */
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

/**
 * Dernière identité Authentik AUTORISÉE, par `sub` : claims retenus à la
 * connexion (e-mail vérifié ou non, groupes). Relue à CHAQUE requête de
 * l'admin pour revérifier l'accès contre la configuration courante.
 */
export const oidcIdentity = sqliteTable("oidc_identity", {
  sub: text("sub").primaryKey(),
  providerId: text("provider_id").notNull(),
  email: text("email"),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  /** JSON (texte) : tableau des groupes. */
  groups: text("groups").notNull().default("[]"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Échecs de connexion par couple (e-mail, IP) : délai progressif, jamais de
 * blocage dur. La colonne `email` porte la clé « e-mail|IP ».
 */
export const authThrottle = sqliteTable("auth_throttle", {
  email: text("email").primaryKey(),
  failures: integer("failures").notNull(),
  firstAt: integer("first_at").notNull(),
  lastAt: integer("last_at").notNull(),
});
