"use server";

/**
 * Server actions des projets et des planches. Chacune : `await assertAdmin()`,
 * validation serveur (src/lib/edit/projects.ts), puis invalidation des
 * étiquettes du projet (et de la liste des projets si la structure change).
 */
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import {
  addSlots,
  createProject,
  deleteProject,
  deleteSlot,
  reorderProjects,
  reorderSlots,
  restoreProject,
  saveProject,
  saveSlot,
  setSlotMedia,
  type ProjectReference,
} from "@/lib/edit/projects";
import { fail, type ActionResult } from "@/lib/edit/result";
import { revalidateMedia, revalidateProject, revalidateProjects } from "@/lib/revalidate";
import { audited } from "@/lib/journal/audit";
import { adminT } from "@/i18n/admin-msg";

const Id = z.number().int().positive();
const id = (v: unknown) => {
  const parsed = Id.safeParse(v);
  return parsed.success ? parsed.data : null;
};

export const createProjectAction = audited("createProjectAction", async function createProjectAction(input?: unknown): Promise<ActionResult<{ id: number; slug: string }>> {
  await assertAdmin();
  const t = adminT("actions");
  const result = createProject(input);
  if (result.ok) revalidateProject(result.data.id, { structure: true });
  return result;
});

export const saveProjectAction = audited("saveProjectAction", async function saveProjectAction(projectId: unknown, input: unknown): Promise<ActionResult<{ textsHeld: string | null }>> {
  await assertAdmin();
  const t = adminT("actions");
  const pid = id(projectId);
  if (!pid) return fail("Projet inconnu.");
  const result = saveProject(pid, input);
  if (result.ok) revalidateProject(pid, { structure: true });
  return result;
});

export const reorderProjectsAction = audited("reorderProjectsAction", async function reorderProjectsAction(ids: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const result = reorderProjects(ids);
  if (result.ok) revalidateProjects();
  return result;
});

/** Supprimer = mettre à la corbeille (restaurable 30 jours : `restoreProjectAction`). */
export const deleteProjectAction = audited("deleteProjectAction", async function deleteProjectAction(
  projectId: unknown,
): Promise<ActionResult<{ title: string }> | { ok: false; message: string; references: ProjectReference[] }> {
  await assertAdmin();
  const t = adminT("actions");
  const pid = id(projectId);
  if (!pid) return fail("Projet inconnu.");
  const result = deleteProject(pid);
  if (result.ok) revalidateProject(pid, { structure: true });
  return result;
});

/** Restaure un projet de la corbeille. */
export const restoreProjectAction = audited("restoreProjectAction", async function restoreProjectAction(projectId: unknown): Promise<ActionResult<{ title: string }>> {
  await assertAdmin();
  const t = adminT("actions");
  const pid = id(projectId);
  if (!pid) return fail("Projet inconnu.");
  const result = restoreProject(pid);
  if (result.ok) revalidateProject(pid, { structure: true });
  return result;
});

export const addSlotsAction = audited("addSlotsAction", async function addSlotsAction(projectId: unknown, mediaIds: unknown, at?: unknown): Promise<ActionResult<{ ids: number[] }>> {
  await assertAdmin();
  const t = adminT("actions");
  const pid = id(projectId);
  if (!pid) return fail("Projet inconnu.");
  const result = addSlots(pid, mediaIds, at);
  if (result.ok) revalidateProject(pid);
  return result;
});

export const saveSlotAction = audited("saveSlotAction", async function saveSlotAction(slotId: unknown, input: unknown): Promise<ActionResult<{ projectId: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const sid = id(slotId);
  if (!sid) return fail("Emplacement inconnu.");
  const result = saveSlot(sid, input);
  if (result.ok) revalidateProject(result.data.projectId);
  return result;
});

export const setSlotMediaAction = audited("setSlotMediaAction", async function setSlotMediaAction(slotId: unknown, mediaId: unknown): Promise<ActionResult<{ projectId: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const sid = id(slotId);
  if (!sid) return fail("Emplacement inconnu.");
  const result = setSlotMedia(sid, mediaId);
  if (result.ok) {
    revalidateProject(result.data.projectId);
    revalidateMedia();
  }
  return result;
});

export const deleteSlotAction = audited("deleteSlotAction", async function deleteSlotAction(slotId: unknown): Promise<ActionResult<{ projectId: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const sid = id(slotId);
  if (!sid) return fail("Emplacement inconnu.");
  const result = deleteSlot(sid);
  if (result.ok) revalidateProject(result.data.projectId);
  return result;
});

export const reorderSlotsAction = audited("reorderSlotsAction", async function reorderSlotsAction(projectId: unknown, ids: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const pid = id(projectId);
  if (!pid) return fail("Projet inconnu.");
  const result = reorderSlots(pid, ids);
  if (result.ok) revalidateProject(pid);
  return result;
});
