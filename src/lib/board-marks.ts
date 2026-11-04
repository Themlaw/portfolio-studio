import type { LocalizedProject } from "@/lib/gallery";

/** Repères de la toile pour un projet : identifiant, projet créé ici, images / textes tenus par une autre page. */
export function boardMarks(edit: NonNullable<LocalizedProject["edit"]>): Record<string, string> {
  return {
    "data-edit-board": String(edit.id),
    ...(edit.draft ? { "data-edit-board-draft": "" } : {}),
    ...(edit.heldBy ? { "data-edit-board-held": edit.heldBy } : {}),
    ...(edit.textHeldBy ? { "data-edit-board-text-held": edit.textHeldBy } : {}),
    // Contenu de la planche (lot 111) : tenu par une autre page, brouillon de cette page à garder pour elle, ou propre au bloc.
    ...(edit.layoutHeldBy ? { "data-edit-layout-held": edit.layoutHeldBy } : {}),
    ...(edit.layoutDraft ? { "data-edit-layout-draft": "" } : {}),
    ...(edit.layoutOwn ? { "data-edit-layout-own": "" } : {}),
  };
}
