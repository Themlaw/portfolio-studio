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
  saveProject,
  saveSlot,
  setSlotMedia,
  type ProjectReference,
} from "@/lib/edit/projects";
import { fail, type ActionResult } from "@/lib/edit/result";
import { revalidateMedia, revalidateProject, revalidateProjects } from "@/lib/revalidate";

const Id = z.number().int().positive();
const id = (v: unknown) => {
  const parsed = Id.safeParse(v);
  return parsed.success ? parsed.data : null;
};

export async function createProjectAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  await assertAdmin();
  const result = createProject(input);
  if (result.ok) revalidateProject(result.data.id, { structure: true });
  return result;
}

export async function saveProjectAction(projectId: unknown, input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const pid = id(projectId);
  if (!pid) return fail("Projet inconnu.");
  const result = saveProject(pid, input);
  if (result.ok) revalidateProject(pid, { structure: true });
  return result;
}

export async function reorderProjectsAction(ids: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const result = reorderProjects(ids);
  if (result.ok) revalidateProjects();
  return result;
}

export async function deleteProjectAction(
  projectId: unknown,
): Promise<ActionResult<null> | { ok: false; message: string; references: ProjectReference[] }> {
  await assertAdmin();
  const pid = id(projectId);
  if (!pid) return fail("Projet inconnu.");
  const result = deleteProject(pid);
  if (result.ok) revalidateProject(pid, { structure: true });
  return result;
}

export async function addSlotsAction(projectId: unknown, mediaIds: unknown): Promise<ActionResult<{ ids: number[] }>> {
  await assertAdmin();
  const pid = id(projectId);
  if (!pid) return fail("Projet inconnu.");
  const result = addSlots(pid, mediaIds);
  if (result.ok) revalidateProject(pid);
  return result;
}

export async function saveSlotAction(slotId: unknown, input: unknown): Promise<ActionResult<{ projectId: number }>> {
  await assertAdmin();
  const sid = id(slotId);
  if (!sid) return fail("Emplacement inconnu.");
  const result = saveSlot(sid, input);
  if (result.ok) revalidateProject(result.data.projectId);
  return result;
}

export async function setSlotMediaAction(slotId: unknown, mediaId: unknown): Promise<ActionResult<{ projectId: number }>> {
  await assertAdmin();
  const sid = id(slotId);
  if (!sid) return fail("Emplacement inconnu.");
  const result = setSlotMedia(sid, mediaId);
  if (result.ok) {
    revalidateProject(result.data.projectId);
    revalidateMedia();
  }
  return result;
}

export async function deleteSlotAction(slotId: unknown): Promise<ActionResult<{ projectId: number }>> {
  await assertAdmin();
  const sid = id(slotId);
  if (!sid) return fail("Emplacement inconnu.");
  const result = deleteSlot(sid);
  if (result.ok) revalidateProject(result.data.projectId);
  return result;
}

export async function reorderSlotsAction(projectId: unknown, ids: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const pid = id(projectId);
  if (!pid) return fail("Projet inconnu.");
  const result = reorderSlots(pid, ids);
  if (result.ok) revalidateProject(pid);
  return result;
}
