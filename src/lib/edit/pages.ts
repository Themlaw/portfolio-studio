/**
 * Écritures des pages et de leurs blocs (admin). Validation serveur : slugs
 * (format, mots réservés, unicité par langue), blocs (schéma du registre et
 * références existantes), accent de page (contraste AA contre le thème actif).
 */
import { own } from "@/lib/own";
import { and, asc, eq, inArray, isNotNull, max } from "drizzle-orm";
import { z } from "zod";

import { BLOCKS } from "@/blocks/registry";
import { extractProjectRefs, extractRefs } from "@/blocks/refs";
import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { findPageReferences } from "@/lib/references";
import { accentProblem } from "@/themes/contrast";
import { ThemeSchema } from "@/themes/schema";

import { done, fail, zodFieldErrors, type ActionResult } from "./result";

type L = { fr: string; en: string };
const LOCALES = ["fr", "en"] as const;

export const RESERVED_SLUGS = ["admin", "api", "media", "_next", "_404"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Message d'erreur d'un slug, ou null s'il est valable. */
export function slugProblem(slug: string): string | null {
  if (slug === "") return "L'adresse est vide : seule la page d'accueil n'a pas d'adresse.";
  if (slug.startsWith("_")) return "Une adresse ne peut pas commencer par « _ ».";
  if (RESERVED_SLUGS.includes(slug)) return `« ${slug} » est réservé par le site : choisis une autre adresse.`;
  if (!SLUG.test(slug)) return "Utilise seulement des minuscules sans accents, des chiffres et des tirets (ex. mes-carnets).";
  if (slug.length > 60) return "60 caractères au plus.";
  return null;
}

const isHome = (slug: L) => slug.fr === "" && slug.en === "";

function slugErrors(slug: L, exceptId: number | null): Record<string, string> {
  const errors: Record<string, string> = {};
  const others = getDb()
    .select({ id: schema.pages.id, slug: schema.pages.slug })
    .from(schema.pages)
    .all()
    .filter((p) => p.id !== exceptId);
  for (const l of LOCALES) {
    const problem = slugProblem(slug[l]);
    if (problem) errors[`slug.${l}`] = problem;
    else if (others.some((p) => p.slug[l] === slug[l])) {
      errors[`slug.${l}`] = `L'adresse « /${l}/${slug[l]} » est déjà prise par une autre page.`;
    }
  }
  return errors;
}

const titleSchema = z.object({
  fr: z.string().trim().min(1, "Donne un titre en français.").max(80),
  en: z.string().trim().min(1, "Donne un titre en anglais (il sert au menu en anglais).").max(80),
});
const slugSchema = z.object({ fr: z.string().trim().toLowerCase().max(120), en: z.string().trim().toLowerCase().max(120) });

export const CreatePageSchema = z.object({ title: titleSchema, slug: slugSchema });

export function createPage(input: unknown): ActionResult<{ id: number }> {
  const parsed = CreatePageSchema.safeParse(input);
  if (!parsed.success) return fail("Corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  const errors = slugErrors(parsed.data.slug, null);
  if (Object.keys(errors).length) return fail("Cette adresse ne convient pas : corrige-la.", errors);
  const row = getDb()
    .insert(schema.pages)
    .values({
      slug: parsed.data.slug,
      title: parsed.data.title,
      meta: { title: parsed.data.title, description: { fr: "", en: "" } },
      navOrder: null,
      published: false,
    })
    .returning({ id: schema.pages.id })
    .get();
  return done({ id: row.id });
}

const HEX = /^#[0-9a-fA-F]{6}$/;

const SavePageSchema = z.object({
  title: titleSchema,
  slug: slugSchema,
  meta: z.object({
    title: z.object({ fr: z.string().trim().max(120), en: z.string().trim().max(120) }),
    description: z.object({ fr: z.string().trim().max(300), en: z.string().trim().max(300) }),
  }),
  published: z.boolean(),
  inMenu: z.boolean(),
  accent: z.string().max(7).regex(HEX, "Couleur attendue au format #rrggbb.").nullable(),
  blocks: z.array(z.object({ type: z.string().max(60), props: z.unknown() })).max(40, "40 blocs au plus par page."),
});

/** Couleurs du thème actif (pour contrôler l'accent d'une page). */
function activeColors() {
  const db = getDb();
  const active = parseJson(db.select().from(schema.settings).where(eq(schema.settings.key, "activeThemeId")).get()?.value);
  const row = typeof active === "string" ? db.select().from(schema.themes).where(eq(schema.themes.id, active)).get() : undefined;
  const parsed = ThemeSchema.safeParse(parseJson(row?.data));
  return parsed.success ? parsed.data.tokens.color : null;
}

export function savePage(id: number, input: unknown): ActionResult<null> {
  const db = getDb();
  const page = db.select().from(schema.pages).where(eq(schema.pages.id, id)).get();
  if (!page) return fail("Cette page n'existe plus. Recharge la liste des pages.");
  const parsed = SavePageSchema.safeParse(input);
  if (!parsed.success) return fail("Corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  const data = parsed.data;
  const home = isHome(page.slug);
  const errors: Record<string, string> = {};

  const slug = home ? { fr: "", en: "" } : data.slug;
  if (!home) Object.assign(errors, slugErrors(slug, id));
  if (home && !data.published) errors.published = "La page d'accueil reste toujours publiée.";

  if (data.accent) {
    const colors = activeColors();
    const problem = colors ? accentProblem(data.accent, colors) : null;
    if (problem) errors.accent = `${problem} Choisis une teinte plus contrastée ou retire l'accent.`;
  }

  // Blocs : type connu, props valides, références existantes.
  const pageIds = new Set(db.select({ id: schema.pages.id }).from(schema.pages).all().map((p) => p.id));
  const mediaIds = new Set(db.select({ id: schema.media.id }).from(schema.media).all().map((m) => m.id));
  const projectPages = new Map(db.select({ slug: schema.projects.slug, page: schema.projects.draftPageId }).from(schema.projects).all().map((p) => [p.slug, p.page]));
  const blocks: { type: string; props: unknown }[] = [];
  data.blocks.forEach((block, i) => {
    const def = own(BLOCKS, block.type);
    if (!def) {
      errors[`blocks.${i}`] = `Type de bloc inconnu « ${block.type} ».`;
      return;
    }
    const result = def.schema.safeParse(block.props);
    if (!result.success) {
      Object.assign(errors, zodFieldErrors(result.error.issues, `blocks.${i}.props`));
      return;
    }
    const refs = extractRefs(block.type, result.data);
    if (refs.pages.some((p) => !pageIds.has(p))) errors[`blocks.${i}`] = "Ce bloc pointe vers une page qui n'existe plus : choisis-en une autre.";
    // Projets cités : existants, publiés ou créés dans le brouillon de CETTE page.
    for (const slug of extractProjectRefs(block.type, result.data)) {
      if (!projectPages.has(slug)) errors[`blocks.${i}`] = "Ce bloc cite un projet qui n'existe plus : choisis-en un autre.";
      else if (![null, id].includes(projectPages.get(slug) ?? null)) errors[`blocks.${i}`] = "Ce bloc cite un projet en cours de création dans une autre page.";
    }
    const required = def.publishCheck?.(result.data as Record<string, unknown>);
    if (required) errors[`blocks.${i}`] = required;
    if (refs.media.some((m) => !mediaIds.has(m))) errors[`blocks.${i}`] = "Ce bloc utilise un média qui n'existe plus : choisis-en un autre.";
    blocks.push({ type: block.type, props: result.data });
  });

  if (Object.keys(errors).length) return fail("La page n'a pas été enregistrée : corrige les champs signalés.", errors);

  let navOrder = page.navOrder;
  if (data.inMenu && navOrder === null) {
    const [{ m }] = db.select({ m: max(schema.pages.navOrder) }).from(schema.pages).all();
    navOrder = (m ?? 0) + 1;
  }
  if (!data.inMenu) navOrder = null;

  db.transaction((tx) => {
    tx.update(schema.pages)
      .set({
        slug,
        title: data.title,
        meta: data.meta,
        published: home ? true : data.published,
        navOrder,
        themeOverrides: data.accent ? { primary: data.accent } : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, id))
      .run();
    tx.delete(schema.blocks).where(eq(schema.blocks.pageId, id)).run();
    blocks.forEach((b, position) =>
      tx.insert(schema.blocks).values({ pageId: id, position, type: b.type, props: JSON.stringify(b.props) }).run(),
    );
  });
  return done(null);
}

export function setPublished(id: number, published: boolean): ActionResult<null> {
  const page = getDb().select().from(schema.pages).where(eq(schema.pages.id, id)).get();
  if (!page) return fail("Cette page n'existe plus.");
  if (isHome(page.slug) && !published) return fail("La page d'accueil reste toujours publiée.");
  getDb().update(schema.pages).set({ published, updatedAt: new Date() }).where(eq(schema.pages.id, id)).run();
  return done(null);
}

export function setInMenu(id: number, inMenu: boolean): ActionResult<null> {
  const db = getDb();
  const page = db.select().from(schema.pages).where(eq(schema.pages.id, id)).get();
  if (!page) return fail("Cette page n'existe plus.");
  let navOrder: number | null = null;
  if (inMenu) {
    const [{ m }] = db.select({ m: max(schema.pages.navOrder) }).from(schema.pages).all();
    navOrder = page.navOrder ?? (m ?? 0) + 1;
  }
  db.update(schema.pages).set({ navOrder }).where(eq(schema.pages.id, id)).run();
  return done(null);
}

/** Nouvel ordre du menu (identifiants des pages du menu, dans l'ordre). */
export function reorderMenu(input: unknown): ActionResult<null> {
  const parsed = z.array(z.number().int().positive()).max(50).safeParse(input);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) {
    return fail("Ordre du menu invalide. Recharge la page.");
  }
  const db = getDb();
  const inMenu = db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(isNotNull(schema.pages.navOrder))
    .orderBy(asc(schema.pages.navOrder))
    .all()
    .map((p) => p.id);
  const same = parsed.data.length === inMenu.length && parsed.data.every((id) => inMenu.includes(id));
  if (!same) return fail("Le menu a changé entre-temps. Recharge la page et recommence.");
  db.transaction((tx) => {
    parsed.data.forEach((id, i) => tx.update(schema.pages).set({ navOrder: i + 1 }).where(eq(schema.pages.id, id)).run());
  });
  return done(null);
}

export type PageReference = { pageId: number; pageTitle: string; blockType: string };

export function deletePage(id: number): ActionResult<null> | { ok: false; message: string; references: PageReference[] } {
  const db = getDb();
  const page = db.select().from(schema.pages).where(eq(schema.pages.id, id)).get();
  if (!page) return fail("Cette page n'existe plus.");
  if (isHome(page.slug)) return fail("La page d'accueil ne se supprime pas.");
  const refs = findPageReferences(id).flatMap((u) => (u.kind === "block" && u.pageId !== id ? [u] : []));
  if (refs.length > 0) {
    const titles = new Map(
      db
        .select({ id: schema.pages.id, title: schema.pages.title })
        .from(schema.pages)
        .where(inArray(schema.pages.id, refs.map((r) => r.pageId)))
        .all()
        .map((p) => [p.id, p.title.fr]),
    );
    return {
      ok: false,
      message: `Cette page est utilisée par ${refs.length} bloc${refs.length > 1 ? "s" : ""} : retire ces liens avant de la supprimer.`,
      references: refs.map((r) => ({
        pageId: r.pageId,
        pageTitle: titles.get(r.pageId) ?? `page ${r.pageId}`,
        blockType: own(BLOCKS, r.type)?.label ?? r.type,
      })),
    };
  }
  db.transaction((tx) => {
    // Surcouche d'emplacements portée par le brouillon de la page : abandonnée avec elle.
    tx.delete(schema.slots).where(and(eq(schema.slots.draftPageId, id), eq(schema.slots.draftState, "added"))).run();
    tx.update(schema.slots)
      .set({ draftState: null, draftPosition: null, draftMediaId: null, draftPageId: null, draftTitle: null, draftDescription: null, draftKey: null })
      .where(eq(schema.slots.draftPageId, id))
      .run();
    tx.delete(schema.pages).where(eq(schema.pages.id, id)).run();
  });
  return done(null);
}
