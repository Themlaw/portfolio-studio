import type { LocalizedProject } from "@/lib/gallery";

/** Repères de la toile pour un projet : identifiant, projet créé ici, images / textes tenus par une autre page. */
export function boardMarks(edit: NonNullable<LocalizedProject["edit"]>): Record<string, string> {
  return {
    "data-edit-board": String(edit.id),
    ...(edit.draft ? { "data-edit-board-draft": "" } : {}),
    ...(edit.heldBy ? { "data-edit-board-held": edit.heldBy } : {}),
    ...(edit.textHeldBy ? { "data-edit-board-text-held": edit.textHeldBy } : {}),
  };
}
