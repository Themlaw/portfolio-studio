"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { deleteAllMessagesAction, deleteMessageAction } from "@/app/admin/(espace)/messages/actions";

import { ConfirmDialog, toast } from "./editing";

/** « Supprimer » un message, ou « Tout supprimer » (confirmé). */
export function DeleteMessage({ id }: { id: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="a-btn a-btn-small a-btn-quiet a-danger-text"
      onClick={async () => {
        const r = await deleteMessageAction(id);
        if (r.ok) {
          toast("Message supprimé");
          router.refresh();
        } else toast(r.message, "error");
      }}
    >
      Supprimer
    </button>
  );
}

export function DeleteAllMessages({ count }: { count: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="a-btn a-btn-small a-danger-text" onClick={() => setOpen(true)}>
        Tout supprimer
      </button>
      <ConfirmDialog
        open={open}
        title={`Supprimer les ${count} messages ?`}
        confirmLabel="Tout supprimer"
        danger
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          const r = await deleteAllMessagesAction("tout");
          setOpen(false);
          if (r.ok) {
            toast(`${r.data.deleted} message(s) supprimé(s)`);
            router.refresh();
          } else toast(r.message, "error");
        }}
      >
        <p className="muted">Cette action ne s&apos;annule pas.</p>
      </ConfirmDialog>
    </>
  );
}
