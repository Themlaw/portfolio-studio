"use client";

/**
 * Suppression définitive depuis la corbeille (lot 23) : un élément, ou toute la corbeille. La confirmation est
 * intégrée à la page (jamais de `confirm()`) et nomme ce qui sera perdu.
 */
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { emptyTrashAction, purgeTrashItemAction } from "@/app/admin/(espace)/corbeille/actions";
import type { TrashSummary } from "@/lib/admin";

import { toast } from "./editing";

function Confirm({ message, busy, label, onConfirm, onCancel }: { message: string; busy: boolean; label: string; onConfirm: () => void; onCancel: () => void }) {
  const tc = useTranslations("common");
  return (
    <div className="a-inline-confirm" role="alert" data-testid="confirmation-definitive">
      <p>{message}</p>
      <div className="a-inline-confirm-actions">
        <button type="button" className="a-btn a-btn-small" onClick={onCancel} disabled={busy}>
          {tc("cancel")}
        </button>
        <button type="button" className="a-btn a-btn-small a-btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? tc("pleaseWait") : label}
        </button>
      </div>
    </div>
  );
}

/** « Supprimer définitivement » d'un élément ; `lost` : ce qui part avec lui, pour la confirmation. */
export function PurgeItem({ kind, id, name, lost }: { kind: "page" | "project" | "media" | "wallpaper"; id: number; name: string; lost: string }) {
  const router = useRouter();
  const t = useTranslations("trash");
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className="a-btn a-btn-small a-btn-quiet a-danger-text" onClick={() => setOpen(true)}>
        {t("purge")}
      </button>
    );
  }
  return (
    <Confirm
      message={t("purgeConfirm", { name, lost })}
      label={t("purge")}
      busy={busy}
      onCancel={() => setOpen(false)}
      onConfirm={() =>
        start(async () => {
          const r = await purgeTrashItemAction({ kind, id });
          if (!r.ok) {
            setOpen(false);
            return toast(r.message, "error");
          }
          toast(t("purged", { name }));
          router.refresh();
        })
      }
    />
  );
}

/** « Vider la corbeille » : tout part, dans l'ordre (pages, projets, médias). */
export function EmptyTrash({ summary }: { summary: TrashSummary }) {
  const router = useRouter();
  const t = useTranslations("trash");
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  if (summary.total === 0) return null;
  const parts = [
    summary.pages ? t("partPages", { count: summary.pages }) : "",
    summary.projects ? `${t("partProjects", { count: summary.projects })}${summary.slots ? ` (${t("withSlots", { count: summary.slots })})` : ` (${t("withoutSlot")})`}` : "",
    summary.media ? t("partMedia", { count: summary.media }) : "",
  ].filter(Boolean);
  return (
    <div className="a-trash-empty">
      {!open ? (
        <button type="button" className="a-btn a-btn-small a-danger-text" onClick={() => setOpen(true)}>
          {t("empty")}
        </button>
      ) : (
        <Confirm
          message={t("emptyConfirm", { total: summary.total, parts: parts.join(", "), keepsImages: summary.projects ? 1 : 0 })}
          label={t("empty")}
          busy={busy}
          onCancel={() => setOpen(false)}
          onConfirm={() =>
            start(async () => {
              const r = await emptyTrashAction();
              setOpen(false);
              if (!r.ok) return toast(r.message, "error");
              const n = r.data.pages + r.data.projects + r.data.media;
              toast(t("emptied", { count: n, kept: r.data.kept ?? 0 }));
              router.refresh();
            })
          }
        />
      )}
    </div>
  );
}
