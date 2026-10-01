/**
 * Écritures des projets et de leurs emplacements (admin). Validation serveur ;
 * suppression d'un projet bloquée s'il est cité par un bloc ; un emplacement
 * vidé garde sa place (media_id null, masqué côté public).
 */
import { and, asc, eq, max } from "drizzle-orm";
import { z } from "zod";

import { BLOCKS } from "@/blocks/registry";
import { getDb, schema } from "@/lib/db";
import { own } from "@/lib/own";
import { findProjectReferences } from "@/lib/references";
import { slugify } from "@/lib/slug";

import { done, fail, zodFieldErrors, type ActionResult } from "./result";

const short = (label: string) =>
  z.strictObject({ fr: z.string().trim().min(1, `Donne ${label} en français.`).max(120), en: z.string().trim().max(120) });
const text = z.strictObject({ fr: z.string().trim().max(2000), en: z.string().trim().max(2000) });
const shortText = z.strictObject({ fr: z.string().trim().max(200), en: z.string().trim().max(200) });

export const ProjectMetaSchema = z.strictObject({
  title: short("un titre"),
  context: shortText,
  description: text,
  year: z.string().trim().min(1, "Indique l'année ou la période (ex. 2024 ou 2023–2024).").max(20),
  featured: z.boolean(),
});

export const SlotSchema = z.strictObject({
  title: z.strictObject({ fr: z.string().trim().max(120), en: z.string().trim().max(120) }),
  description: text,
  collection: z.enum(["characters", "backgrounds", "animation"]),
  year: z.number().int().min(1900, "Année invalide.").max(2200, "Année invalide."),
  featured: z.boolean(),
});

const Ids = z.array(z.number().int().positive()).max(500);

function uniqueProjectSlug(base: string): string {
  const db = getDb();
  const root = slugify(base) || "projet";
  let slug = root;
  for (let n = 2; db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.slug, slug)).get(); n++) {
    slug = `${root}-${n}`;
  }
  return slug;
}

function uniqueSlotSlug(projectSlug: string): string {
  const db = getDb();
  for (let n = 1; ; n++) {
    const slug = `${projectSlug}-${n}`.slice(0, 80);
    if (!db.select({ id: schema.slots.id }).from(schema.slots).where(eq(schema.slots.slug, slug)).get()) return slug;
  }
}

/** Ordre exact : mêmes identifiants que l'existant, sans doublon. */
function isPermutation(ids: number[], existing: number[]): boolean {
  return ids.length === existing.length && new Set(ids).size === ids.length && ids.every((id) => existing.includes(id));
}

export function createProject(input: unknown): ActionResult<{ id: number }> {
  const parsed = z.strictObject({ title: short("un titre") }).safeParse(input);
  if (!parsed.success) return fail("Corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  const db = getDb();
  const [{ m }] = db.select({ m: max(schema.projects.position) }).from(schema.projects).all();
  const title = { fr: parsed.data.title.fr, en: parsed.data.title.en || parsed.data.title.fr };
  const row = db
    .insert(schema.projects)
    .values({
      slug: uniqueProjectSlug(title.fr),
      title,
      context: { fr: "", en: "" },
      description: { fr: "", en: "" },
      year: String(new Date().getFullYear()),
      featured: false,
      position: (m ?? -1) + 1,
    })
    .returning({ id: schema.projects.id })
    .get();
  return done({ id: row.id });
}

export function saveProject(id: number, input: unknown): ActionResult<null> {
  const parsed = ProjectMetaSchema.safeParse(input);
  if (!parsed.success) return fail("Le projet n'a pas été enregistré : corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  const db = getDb();
  if (!db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, id)).get()) {
    return fail("Ce projet n'existe plus. Recharge la liste des projets.");
  }
  db.update(schema.projects).set({ ...parsed.data, updatedAt: new Date() }).where(eq(schema.projects.id, id)).run();
  return done(null);
}

export function reorderProjects(input: unknown): ActionResult<null> {
  const parsed = Ids.safeParse(input);
  const db = getDb();
  const existing = db.select({ id: schema.projects.id }).from(schema.projects).all().map((p) => p.id);
  if (!parsed.success || !isPermutation(parsed.data, existing)) return fail("La liste a changé entre-temps. Recharge la page et recommence.");
  db.transaction((tx) => parsed.data.forEach((id, i) => tx.update(schema.projects).set({ position: i }).where(eq(schema.projects.id, id)).run()));
  return done(null);
}

export type ProjectReference = { pageId: number; pageTitle: string; blockType: string };

export function deleteProject(id: number): ActionResult<null> | { ok: false; message: string; references: ProjectReference[] } {
  const db = getDb();
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!project) return fail("Ce projet n'existe plus.");
  const refs = findProjectReferences(project.slug).flatMap((u) => (u.kind === "block" ? [u] : []));
  if (refs.length) {
    const titles = new Map(db.select({ id: schema.pages.id, title: schema.pages.title }).from(schema.pages).all().map((p) => [p.id, p.title.fr]));
    return {
      ok: false,
      message: `Ce projet est affiché par ${refs.length} bloc${refs.length > 1 ? "s" : ""} : retire-le de ces blocs avant de le supprimer.`,
      references: refs.map((r) => ({ pageId: r.pageId, pageTitle: titles.get(r.pageId) ?? `page ${r.pageId}`, blockType: own(BLOCKS, r.type)?.label ?? r.type })),
    };
  }
  db.delete(schema.projects).where(eq(schema.projects.id, id)).run(); // emplacements en cascade ; médias conservés
  return done(null);
}

/* ---- Emplacements ------------------------------------------------------- */

function slotRow(id: number) {
  return getDb().select().from(schema.slots).where(eq(schema.slots.id, id)).get();
}

/** Ratio largeur/hauteur d'un média, ou null. */
function aspectOf(m: { width: number | null; height: number | null } | undefined): number | null {
  return m?.width && m.height ? m.width / m.height : null;
}

/**
 * Ajoute des emplacements en fin de planche, un par média (null = vide).
 * Sans titre : le nom du fichier n'est jamais publié (le panneau le propose
 * comme suggestion). Collection : la plus fréquente du projet.
 */
/**
 * Ajoute des emplacements (un par média) en fin de planche, ou à la position
 * `at` (0 = avant le premier) : les suivants sont décalés. Un média en échec
 * ne se place pas ; un média en traitement, si (il apparaît une fois prêt).
 */
export function addSlots(projectId: number, input: unknown, atInput?: unknown): ActionResult<{ ids: number[] }> {
  const parsed = z.array(z.number().int().positive().nullable()).min(1).max(50).safeParse(input);
  if (!parsed.success) return fail("Requête invalide.");
  const at = z.number().int().min(0).max(10_000).optional().safeParse(atInput ?? undefined);
  if (!at.success) return fail("Position invalide.");
  const db = getDb();
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) return fail("Ce projet n'existe plus. Recharge la page.");
  const existing = db.select().from(schema.slots).where(eq(schema.slots.projectId, projectId)).orderBy(asc(schema.slots.position)).all();
  const counts = new Map<string, number>();
  for (const s of existing) counts.set(s.collection, (counts.get(s.collection) ?? 0) + 1);
  const collection = ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "characters") as "characters";
  const mediaRows = new Map(db.select().from(schema.media).all().map((m) => [m.id, m]));
  for (const mid of parsed.data) if (mid !== null && !mediaRows.has(mid)) return fail("Une image n'existe plus : recharge la page.");
  if (parsed.data.some((mid) => mid !== null && mediaRows.get(mid)?.status === "failed")) {
    return fail("Ce média est en échec : relance-le depuis la médiathèque avant de le placer.");
  }
  const insertAt = Math.min(at.data ?? existing.length, existing.length);
  const year = new Date().getFullYear();
  const ids = db.transaction((tx) => {
    const created = parsed.data.map((mid) =>
      tx
        .insert(schema.slots)
        .values({
          projectId,
          position: 0,
          mediaId: mid,
          aspect: mid !== null ? aspectOf(mediaRows.get(mid)) : null,
          slug: uniqueSlotSlug(project.slug),
          collection,
          title: { fr: "", en: "" },
          description: { fr: "", en: "" },
          year,
          featured: false,
        })
        .returning({ id: schema.slots.id })
        .get().id,
    );
    // Toute la planche renumérotée 0…n-1 (un trou ou un doublon antérieur disparaît).
    const order = [...existing.slice(0, insertAt).map((s) => s.id), ...created, ...existing.slice(insertAt).map((s) => s.id)];
    order.forEach((id, position) => tx.update(schema.slots).set({ position }).where(eq(schema.slots.id, id)).run());
    return created;
  });
  return done({ ids });
}

export function saveSlot(slotId: number, input: unknown): ActionResult<{ projectId: number }> {
  const slot = slotRow(slotId);
  if (!slot) return fail("Cet emplacement n'existe plus. Recharge la page.");
  const parsed = SlotSchema.safeParse(input);
  if (!parsed.success) return fail("L'emplacement n'a pas été enregistré : corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  getDb().update(schema.slots).set(parsed.data).where(eq(schema.slots.id, slotId)).run();
  return done({ projectId: slot.projectId });
}

export function setSlotMedia(slotId: number, mediaId: unknown): ActionResult<{ projectId: number }> {
  const slot = slotRow(slotId);
  if (!slot) return fail("Cet emplacement n'existe plus. Recharge la page.");
  const parsed = z.number().int().positive().nullable().safeParse(mediaId);
  if (!parsed.success) return fail("Requête invalide.");
  const db = getDb();
  if (parsed.data !== null) {
    const target = db.select({ status: schema.media.status }).from(schema.media).where(eq(schema.media.id, parsed.data)).get();
    if (!target) return fail("Cette image n'existe plus : recharge la médiathèque.");
    if (target.status === "failed") return fail("Ce média est en échec : relance-le depuis la médiathèque avant de le placer.");
  }
  // Retirer l'image garde le ratio de la place (aspect inchangé) ; une
  // nouvelle image impose le sien.
  const patch: Partial<typeof schema.slots.$inferInsert> = { mediaId: parsed.data };
  if (parsed.data !== null) {
    const m = db.select({ width: schema.media.width, height: schema.media.height }).from(schema.media).where(eq(schema.media.id, parsed.data)).get();
    patch.aspect = aspectOf(m) ?? slot.aspect;
  } else if (slot.aspect === null && slot.mediaId !== null) {
    const m = db.select({ width: schema.media.width, height: schema.media.height }).from(schema.media).where(eq(schema.media.id, slot.mediaId)).get();
    patch.aspect = aspectOf(m);
  }
  db.update(schema.slots).set(patch).where(eq(schema.slots.id, slotId)).run();
  return done({ projectId: slot.projectId });
}

export function deleteSlot(slotId: number): ActionResult<{ projectId: number }> {
  const slot = slotRow(slotId);
  if (!slot) return fail("Cet emplacement n'existe plus.");
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(schema.slots).where(eq(schema.slots.id, slotId)).run();
    const rest = tx.select({ id: schema.slots.id }).from(schema.slots).where(eq(schema.slots.projectId, slot.projectId)).orderBy(asc(schema.slots.position)).all();
    rest.forEach((s, i) => tx.update(schema.slots).set({ position: i }).where(eq(schema.slots.id, s.id)).run());
  });
  return done({ projectId: slot.projectId });
}

export function reorderSlots(projectId: number, input: unknown): ActionResult<null> {
  const parsed = Ids.safeParse(input);
  const db = getDb();
  const existing = db.select({ id: schema.slots.id }).from(schema.slots).where(eq(schema.slots.projectId, projectId)).all().map((s) => s.id);
  if (!parsed.success || !isPermutation(parsed.data, existing)) return fail("La planche a changé entre-temps. Recharge la page et recommence.");
  db.transaction((tx) =>
    parsed.data.forEach((id, i) =>
      tx.update(schema.slots).set({ position: i }).where(and(eq(schema.slots.id, id), eq(schema.slots.projectId, projectId))).run(),
    ),
  );
  return done(null);
}
