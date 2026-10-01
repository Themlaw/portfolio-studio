/**
 * Schéma SQLite (Drizzle) — phase 2 : contenu, thèmes, réglages, médias.
 * Tables Better Auth (phase 3) et `jobs` (phase 4b) plus bas.
 *
 * Conventions : textes localisés en JSON `{ fr, en }` ; booléens en entier
 * (mode boolean) ; ordre explicite par colonne `position`.
 *
 * Les documents libres (props des blocs, valeurs de réglages, thèmes) sont en
 * TEXTE brut, analysés par src/lib/ avec tolérance : une ligne corrompue est
 * ignorée avec un log, elle ne fait jamais tomber une page.
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

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
  /** SHA-256 du contenu envoyé (null : média du seed). Un contenu = une ligne. */
  sha256: text("sha256").unique(),
  kind: text("kind", { enum: ["image", "video"] }).notNull(),
  mime: text("mime").notNull(),
  originalName: text("original_name"),
  size: integer("size").notNull(),
  width: integer("width"),
  height: integer("height"),
  duration: real("duration"),
  /** Vidéo : présence d'une piste audio (une boucle est muette et courte). */
  hasAudio: integer("has_audio", { mode: "boolean" }),
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
  /**
   * Brouillon de l'éditeur visuel (JSON : titre, adresses, méta, accent,
   * blocs) ; null = pas de brouillon, la page publiée fait foi. Lu seulement
   * par l'admin (éditeur, aperçu en draft mode) ; « Publier » le valide comme
   * un enregistrement, l'applique aux colonnes et aux blocs, puis le vide.
   */
  draft: text("draft", { mode: "json" }),
  draftUpdatedAt: integer("draft_updated_at", { mode: "timestamp" }),
  /**
   * Version du contenu éditable (contrôle optimiste) : augmente à chaque
   * écriture du brouillon, publication, abandon ou enregistrement du
   * formulaire. Chaque écriture envoie la version lue ; refusée si elle a changé.
   */
  draftRev: integer("draft_rev").notNull().default(0),
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
  /**
   * Projet créé dans le brouillon d'une page (éditeur visuel, planche neuve) :
   * invisible du site public et de l'écran Projets tant que cette page n'est
   * pas publiée ; supprimé si elle est abandonnée (ou supprimée).
   */
  draftPageId: integer("draft_page_id").references((): AnySQLiteColumn => pages.id, { onDelete: "cascade" }),
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
    /** Ratio largeur/hauteur de la dernière image de l'emplacement : un
     *  emplacement vidé garde sa largeur. null = créé vide (4:3). */
    aspect: real("aspect"),
    slug: text("slug").notNull(),
    collection: text("collection", { enum: ["characters", "backgrounds", "animation"] }).notNull(),
    title: text("title", { mode: "json" }).notNull().$type<Localized>(),
    description: text("description", { mode: "json" }).notNull().$type<Localized>(),
    year: integer("year").notNull(),
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    duration: text("duration"),
    videoId: text("video_id"),
    reel: integer("reel", { mode: "boolean" }).notNull().default(false),
    /**
     * Surcouche de brouillon (éditeur visuel, docs/ARCHITECTURE.md) : jamais
     * lue par le site public. « added » : emplacement créé dans un brouillon,
     * invisible tant qu'il n'est pas publié ; « removed » : média retiré (la
     * place est gardée à la publication) ; « retired » : place retirée
     * (l'emplacement est supprimé à la publication). `draft_position` /
     * `draft_media_id` / `draft_title` / `draft_description` : ordre, média et
     * textes du brouillon. `draft_key` : identifiant stable d'un emplacement
     * « added » (recréé à l'identique par Annuler/Rétablir). Appliquée à la
     * publication de la page qui l'a créée (`draft_page_id`), effacée par son
     * « Abandonner ».
     */
    draftState: text("draft_state", { enum: ["added", "removed", "retired"] }),
    draftPosition: integer("draft_position"),
    draftMediaId: integer("draft_media_id").references(() => media.id, { onDelete: "set null" }),
    /** Page dont le brouillon porte cette surcouche : seule sa publication
     *  ou son abandon l'applique ou l'efface. */
    draftPageId: integer("draft_page_id").references(() => pages.id, { onDelete: "set null" }),
    draftTitle: text("draft_title", { mode: "json" }).$type<Localized>(),
    draftDescription: text("draft_description", { mode: "json" }).$type<Localized>(),
    draftKey: text("draft_key"),
  },
  (t) => [
    index("slots_project_idx").on(t.projectId, t.position),
    uniqueIndex("slots_slug_idx").on(t.slug),
  ],
);

/**
 * File de traitements (images ; vidéo en phase 5). Un worker en processus,
 * concurrence 1, les exécute dans l'ordre (src/lib/jobs). Un job `running`
 * orphelin (processus arrêté) est remis en file au démarrage.
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** image : file légère ; video, kit (export), kit-import : file lourde (un seul à la fois). */
    kind: text("kind", { enum: ["image", "video", "kit", "kit-import"] }).notNull(),
    /** Média traité (image, vidéo) ; null pour un export de kit. */
    mediaId: integer("media_id").references(() => media.id, { onDelete: "cascade" }),
    /** Paramètres d'un job sans média (kit : { themeId, version } ; kit-import : { importId, themeId }), JSON. */
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    status: text("status", { enum: ["queued", "running", "done", "failed"] }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    /** Pas avant (délai croissant entre deux essais) ; null = tout de suite. */
    runAfter: integer("run_after", { mode: "timestamp" }),
    /** Avancement 0–100 (conversion vidéo). */
    progress: integer("progress").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.id)],
);

/**
 * Envois par morceaux en cours (vidéos, grandes images) : reprenables tant
 * qu'ils ne sont pas terminés ; purgés après 24 h sans nouvelle.
 */
/**
 * Tags de la bibliothèque : libellé tel que saisi la première fois, clé
 * normalisée (minuscules, sans accents, espaces réduits) unique.
 */
export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    label: text("label").notNull(),
    key: text("key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("tags_key_idx").on(t.key)],
);

export const mediaTags = sqliteTable(
  "media_tags",
  {
    mediaId: integer("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.mediaId, t.tagId] }), index("media_tags_tag_idx").on(t.tagId)],
);

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  /** Type annoncé par le navigateur (indicatif : le contenu fait foi). */
  declaredType: text("declared_type").notNull(),
  /** kit : PSD d'un kit de thème (jamais un média). */
  kind: text("kind", { enum: ["image", "video", "kit"] }).notNull(),
  offset: integer("offset").notNull().default(0),
  /** Cible de l'envoi (kit : identifiant du thème). */
  target: text("target"),
  /** Administrateur qui a ouvert l'envoi (seul à pouvoir le poursuivre). */
  userId: text("user_id").notNull().default(""),
  /** Tags demandés à l'envoi (libellés, JSON), attachés au média à sa création. */
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

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
