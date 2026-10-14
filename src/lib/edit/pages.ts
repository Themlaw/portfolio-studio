/**
 * Écritures des pages et de leurs blocs (admin). Validation serveur : slugs
 * (format, mots réservés, unicité par langue), blocs (schéma du registre et
 * références existantes), accent de page (contraste AA contre le thème actif).
 */
import { own } from "@/lib/own";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { BLOCKS } from "@/blocks/registry";
import { extractProjectRefs, extractRefs } from "@/blocks/refs";
import { containerAccepts, errorPath, flatBlocks, treeProblem } from "@/blocks/tree";
import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { findPageReferences } from "@/lib/references";
import { accentProblem } from "@/themes/contrast";
import { ThemeSchema } from "@/themes/schema";

import { isPageInNav, readNav, reorderNavPages, setPageInNav } from "./nav";
import { done, fail, zodFieldErrors, type ActionResult } from "./result";
import { discardSiteDraft } from "./site";

/**
 * Identifiant public d'un formulaire de contact (`formId`) en double : sur la
 * page même, ou déjà porté par un formulaire d'une AUTRE page publiée.
 * Chemin d'erreur et message, ou null. Appelée au brouillon et dans la
 * transaction de publication (savePage).
 */
export function formIdProblem(pageId: number, blocks: { type: string; props?: unknown }[]): { path: string; message: string } | null {
  const forms = flatBlocks(blocks).filter((b) => b.type === "contact-form");
  if (!forms.length) return null;
  const elsewhere = new Set<string>();
  const rows = getDb()
    .select({ props: schema.blocks.props, pageId: schema.blocks.pageId })
    .from(schema.blocks)
    .innerJoin(schema.pages, eq(schema.blocks.pageId, schema.pages.id))
    .where(and(eq(schema.blocks.type, "contact-form"), eq(schema.pages.published, true)))
    .all();
  for (const r of rows) {
    if (r.pageId === pageId) continue;
    const id = (parseJson(r.props) as { formId?: unknown } | undefined)?.formId;
    if (typeof id === "string") elsewhere.add(id);
  }
  const seen = new Set<string>();
  for (const f of forms) {
    const id = (f.props as { formId?: unknown } | undefined)?.formId;
    if (typeof id !== "string") continue;
    const path = errorPath(blocks, f) ?? "blocks";
    if (seen.has(id)) return { path, message: "Deux formulaires de cette page portent le même identifiant : supprime la copie et ajoute un nouveau formulaire." };
    if (elsewhere.has(id)) return { path, message: "Ce formulaire porte l'identifiant d'un formulaire d'une autre page : supprime-le et ajoute un nouveau formulaire." };
    seen.add(id);
  }
  return null;
}

/**
 * Média posé dans un champ « image ou vidéo » (`mediaFields`, genre « any » : fond de l'ouverture) :
 * jamais un PDF (le sélecteur ne le propose pas, mais l'envoi d'un brouillon est libre). Message ou null.
 * Appelée à l'enregistrement du brouillon et à la publication (savePage).
 */
export function mediaKindProblem(type: string, props: unknown): string | null {
  const fields = own(BLOCKS, type)?.mediaFields?.filter((f) => f.kind === "any") ?? [];
  if (!fields.length || !props || typeof props !== "object") return null;
  for (const f of fields) {
    const id = Object.hasOwn(props, f.field) ? (props as Record<string, unknown>)[f.field] : undefined;
    if (!Number.isInteger(id)) continue;
    const row = getDb().select({ kind: schema.media.kind }).from(schema.media).where(eq(schema.media.id, id as number)).get();
    // Média disparu : signalé ailleurs (« n'existe plus »).
    if (row && row.kind !== "image" && row.kind !== "video") return "Cette rubrique attend une image ou une vidéo (pas un PDF) : choisis-en une autre.";
  }
  return null;
}

/**
 * « Entrées des collections » : le cadrage (`look.tileCrop`) d'une collection qui n'est plus dans le bloc
 * n'a plus de tuile à cadrer. Retiré à l'enregistrement du bloc (publication) ; props rendues sans copie
 * si rien ne change.
 */
export function prunedTileCrop(type: string, props: Record<string, unknown>): Record<string, unknown> {
  if (type !== "collection-tiles") return props;
  const look = props.look as { tileCrop?: Record<string, unknown> } | undefined;
  if (!look?.tileCrop) return props;
  // Entrées automatiques (lot 22) : les collections montrées dépendent des pages du site, rien à retirer ici.
  if (props.mode === "auto") return props;
  const present = new Set(((props.items as { collection?: string }[] | undefined) ?? []).map((i) => i.collection));
  const kept = Object.fromEntries(Object.entries(look.tileCrop).filter(([k]) => present.has(k)));
  if (Object.keys(kept).length === Object.keys(look.tileCrop).length) return props;
  const { tileCrop: _old, ...rest } = look;
  void _old;
  return { ...props, look: Object.keys(kept).length ? { ...rest, tileCrop: kept } : rest };
}

/**
 * Types retirés de la palette (v0.13 : anciennes planches d'une collection,
 * anciens projets mis en avant, ancienne vitrine vidéo) : encore rendus s'ils
 * traînent sur une page, mais on n'en ajoute plus. Message si `blocks` en
 * contient un que la version publiée de la page n'a pas déjà.
 */
export function deprecatedProblem(pageId: number, blocks: { type: string }[]): string | null {
  const old = blocks.filter((b) => own(BLOCKS, b.type)?.deprecated);
  if (!old.length) return null;
  const existing = new Set(
    getDb().select({ type: schema.blocks.type }).from(schema.blocks).where(eq(schema.blocks.pageId, pageId)).all().map((b) => b.type),
  );
  const added = old.find((b) => !existing.has(b.type));
  return added ? `« ${own(BLOCKS, added.type)?.label ?? added.type} » n'existe plus : compose avec des planches de projet, une grille ou une vidéo.` : null;
}

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
  /** Collection présentée par la page (lot 22) ; absent = inchangée. */
  collection: z.enum(["characters", "backgrounds", "animation"]).nullable().optional(),
  blocks: z.array(z.object({ type: z.string().max(60), props: z.unknown() })).max(40, "40 rubriques au plus par page."),
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

  // Une collection n'a qu'une page.
  if (data.collection) {
    const other = db.select({ id: schema.pages.id, title: schema.pages.title }).from(schema.pages).where(eq(schema.pages.collection, data.collection)).get();
    if (other && other.id !== id) errors.collection = `Cette collection est déjà celle de la page « ${other.title.fr || other.title.en} » : retire-la de cette page d'abord.`;
  }

  if (data.accent) {
    const colors = activeColors();
    const problem = colors ? accentProblem(data.accent, colors) : null;
    if (problem) errors.accent = `${problem} Choisis une teinte plus contrastée ou retire l'accent.`;
  }

  // Blocs : forme de l'arbre (conteneurs), type connu, props valides, références existantes.
  const pageIds = new Set(db.select({ id: schema.pages.id }).from(schema.pages).all().map((p) => p.id));
  const mediaIds = new Set(db.select({ id: schema.media.id }).from(schema.media).all().map((m) => m.id));
  const projectPages = new Map(db.select({ slug: schema.projects.slug, page: schema.projects.draftPageId }).from(schema.projects).all().map((p) => [p.slug, p.page]));
  const shape = treeProblem(data.blocks as { type: string; props?: unknown }[], (t) => Boolean(own(BLOCKS, t)));
  if (shape) errors.blocks = shape;
  const old = deprecatedProblem(id, data.blocks);
  if (old) errors.blocks = old;
  type Out = { uid?: string; type: string; props: Record<string, unknown> };
  /** Valide une liste (la page, ou les composants d'un conteneur), récursivement. */
  const validate = (list: { uid?: unknown; type: string; props: unknown }[], prefix: string, parent: string | null, inherited: string | undefined): Out[] => {
    const out: Out[] = [];
    list.forEach((block, i) => {
      const key = `${prefix}.${i}`;
      const def = own(BLOCKS, block.type);
      if (!def) {
        errors[key] = `Type de rubrique inconnu « ${block.type} ».`;
        return;
      }
      if (parent && !containerAccepts(parent, block.type)) {
        errors[key] = "Cette rubrique n'accepte pas ce composant.";
        return;
      }
      const result = def.schema.safeParse(block.props);
      if (!result.success) {
        Object.assign(errors, zodFieldErrors(result.error.issues, `${key}.props`));
        return;
      }
      const props = prunedTileCrop(block.type, { ...(result.data as Record<string, unknown>) });
      // Entrées automatiques : les textes modifiés d'une page qui n'existe plus n'ont plus de tuile.
      if (block.type === "collection-tiles" && Array.isArray(props.edits)) {
        const kept = (props.edits as { pageId: number }[]).filter((e) => pageIds.has(e.pageId));
        if (kept.length !== props.edits.length) {
          if (kept.length) props.edits = kept;
          else delete props.edits;
        }
      }
      // Références du bloc lui-même (ses composants sont contrôlés un par un).
      const refs = extractRefs(block.type, props, 2);
      if (refs.pages.some((p) => !pageIds.has(p))) errors[key] = "Cette rubrique pointe vers une page qui n'existe plus : choisis-en une autre.";
      // Projets cités : existants, publiés ou créés dans le brouillon de CETTE page.
      for (const slug of extractProjectRefs(block.type, props, 2)) {
        if (!projectPages.has(slug)) errors[key] = "Cette rubrique cite un projet qui n'existe plus : choisis-en un autre.";
        else if (![null, id].includes(projectPages.get(slug) ?? null)) errors[key] = "Cette rubrique cite un projet en cours de création dans une autre page.";
      }
      const required = def.publishCheck?.(props, { project: inherited });
      if (required) errors[key] = required;
      if (refs.media.some((m) => !mediaIds.has(m))) errors[key] = "Cette rubrique utilise un média qui n'existe plus : choisis-en un autre.";
      const wrongKind = mediaKindProblem(block.type, props);
      if (wrongKind) errors[key] = wrongKind;
      if (def.container) {
        const project = typeof props.project === "string" ? props.project : inherited;
        props.children = validate((props.children as Out[]) ?? [], `${key}.props.children`, block.type, project);
      }
      out.push({ ...(typeof block.uid === "string" ? { uid: block.uid } : {}), type: block.type, props });
    });
    return out;
  };
  const blocks = shape ? [] : validate(data.blocks, "blocks", null, undefined).map(({ type, props }) => ({ type, props }));
  // Formulaires : identifiant public unique (page et pages publiées), vérifié dans la transaction de publication.
  const dupForm = shape ? null : formIdProblem(id, data.blocks as { type: string; props?: unknown }[]);
  if (dupForm) errors[dupForm.path] = dupForm.message;

  if (Object.keys(errors).length) return fail("La page n'a pas été enregistrée : corrige les champs signalés.", errors);

  db.transaction((tx) => {
    tx.update(schema.pages)
      .set({
        slug,
        title: data.title,
        meta: data.meta,
        published: home ? true : data.published,
        themeOverrides: data.accent ? { primary: data.accent } : null,
        ...(data.collection !== undefined ? { collection: data.collection } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, id))
      .run();
    tx.delete(schema.blocks).where(eq(schema.blocks.pageId, id)).run();
    blocks.forEach((b, position) =>
      tx.insert(schema.blocks).values({ pageId: id, position, type: b.type, props: JSON.stringify(b.props) }).run(),
    );
    // Menu (réglage `nav`, v0.13) : seulement si la case a CHANGÉ (sinon un
    // menu modifié ailleurs — en-tête, liste des pages — serait défait).
    // (Version de CETTE page gérée par l'appelant : publication, formulaire.)
    if (isPageInNav(id) !== data.inMenu) setPageInNav(id, data.inMenu, { skipRevOf: id });
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
  db.transaction(() => setPageInNav(id, inMenu));
  return done(null);
}

/** Nouvel ordre du menu (identifiants des pages du menu, dans l'ordre). */
export function reorderMenu(input: unknown): ActionResult<null> {
  const parsed = z.array(z.number().int().positive()).max(50).safeParse(input);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) {
    return fail("Ordre du menu invalide. Recharge la page.");
  }
  const db = getDb();
  const inMenu = readNav().flatMap((i) => (i.kind === "page" ? [i.pageId] : []));
  const same = parsed.data.length === inMenu.length && parsed.data.every((id) => inMenu.includes(id));
  if (!same) return fail("Le menu a changé entre-temps. Recharge la page et recommence.");
  db.transaction(() => reorderNavPages(parsed.data));
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
      message: `Cette page est utilisée par ${refs.length} rubrique${refs.length > 1 ? "s" : ""} : retire ces liens avant de la supprimer.`,
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
    tx.update(schema.projects).set({ draftText: null, draftTextPageId: null }).where(eq(schema.projects.draftTextPageId, id)).run();
    // Menu et brouillon de l'en-tête portés par cette page.
    setPageInNav(id, false);
    discardSiteDraft(id);
    tx.delete(schema.pages).where(eq(schema.pages.id, id)).run();
  });
  return done(null);
}
