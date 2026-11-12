"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { deleteAllMessagesAction, deleteMessageAction } from "@/app/admin/(espace)/messages/actions";

import { ConfirmDialog, toast } from "./editing";

/** « Supprimer » un message, ou « Tout supprimer » (confirmé). */
export function DeleteMessage({ id }: { id: number }) {
  const router = useRouter();
  const t = useTranslations("messages");
  const tc = useTranslations("common");
  return (
    <button
      type="button"
      className="a-btn a-btn-small a-btn-quiet a-danger-text"
      onClick={async () => {
        const r = await deleteMessageAction(id);
        if (r.ok) {
          toast(t("deletedOne"));
          router.refresh();
        } else toast(r.message, "error");
      }}
    >
      {tc("delete")}
    </button>
  );
}

export function DeleteAllMessages({ count }: { count: number }) {
  const router = useRouter();
  const t = useTranslations("messages");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="a-btn a-btn-small a-danger-text" onClick={() => setOpen(true)}>
        {t("deleteAll")}
      </button>
      <ConfirmDialog
        open={open}
        title={t("deleteAllTitle", { count })}
        confirmLabel={t("deleteAll")}
        danger
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          const r = await deleteAllMessagesAction("tout");
          setOpen(false);
          if (r.ok) {
            toast(t("deletedMany", { count: r.data.deleted }));
            router.refresh();
          } else toast(r.message, "error");
        }}
      >
        <p className="muted">{t("irreversible")}</p>
      </ConfirmDialog>
    </>
  );
}
