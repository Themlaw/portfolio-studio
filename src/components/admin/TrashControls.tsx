"use client";

/**
 * Suppression définitive depuis la corbeille (lot 23) : un élément, ou toute la corbeille. La confirmation est
 * intégrée à la page (jamais de `confirm()`) et nomme ce qui sera perdu.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { emptyTrashAction, purgeTrashItemAction } from "@/app/admin/(espace)/corbeille/actions";
import type { TrashSummary } from "@/lib/admin";
import { emptyTrashParts, willBeDeleted } from "@/lib/trash";

import { toast } from "./editing";

function Confirm({ message, busy, label, onConfirm, onCancel }: { message: string; busy: boolean; label: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="a-inline-confirm" role="alert" data-testid="confirmation-definitive">
      <p>{message}</p>
      <div className="a-inline-confirm-actions">
        <button type="button" className="a-btn a-btn-small" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
        <button type="button" className="a-btn a-btn-small a-btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? "Un instant…" : label}
        </button>
      </div>
    </div>
  );
}

/** « Supprimer définitivement » d'un élément ; `lost` : ce qui part avec lui, pour la confirmation. */
export function PurgeItem({ kind, id, name, lost }: { kind: "page" | "project" | "media" | "wallpaper"; id: number; name: string; lost: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className="a-btn a-btn-small a-btn-quiet a-danger-text" onClick={() => setOpen(true)}>
        Supprimer définitivement
      </button>
    );
  }
  return (
    <Confirm
      message={`« ${name} » sera supprimé pour de bon : ${lost} Cette action ne s'annule pas.`}
      label="Supprimer définitivement"
      busy={busy}
      onCancel={() => setOpen(false)}
      onConfirm={() =>
        start(async () => {
          const r = await purgeTrashItemAction({ kind, id });
          if (!r.ok) {
            setOpen(false);
            return toast(r.message, "error");
          }
          toast(`« ${name} » supprimé définitivement`);
          router.refresh();
        })
      }
    />
  );
}

/** « Vider la corbeille » : tout part, dans l'ordre (pages, projets, médias). */
export function EmptyTrash({ summary }: { summary: TrashSummary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  if (summary.total === 0) return null;
  const parts = emptyTrashParts(summary);
  return (
    <div className="a-trash-empty">
      {!open ? (
        <button type="button" className="a-btn a-btn-small a-danger-text" onClick={() => setOpen(true)}>
          Vider la corbeille
        </button>
      ) : (
        <Confirm
          message={`${willBeDeleted(summary.total)} pour de bon : ${parts.join(", ")}.${summary.projects ? " Les images des projets restent dans la médiathèque." : ""} Cette action ne s'annule pas.`}
          label="Vider la corbeille"
          busy={busy}
          onCancel={() => setOpen(false)}
          onConfirm={() =>
            start(async () => {
              const r = await emptyTrashAction();
              setOpen(false);
              if (!r.ok) return toast(r.message, "error");
              const n = r.data.pages + r.data.projects + r.data.media;
              toast(`Corbeille vidée · ${n} élément${n > 1 ? "s" : ""} supprimé${n > 1 ? "s" : ""}${r.data.kept ? ` · ${r.data.kept} encore utilisé${r.data.kept > 1 ? "s" : ""}, gardé${r.data.kept > 1 ? "s" : ""}` : ""}`);
              router.refresh();
            })
          }
        />
      )}
    </div>
  );
}
