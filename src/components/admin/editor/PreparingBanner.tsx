"use client";

/**
 * Bandeau fixe de l'éditeur de page quand un thème est en préparation (lots 55, 60) : aperçu admin d'un thème pas encore en ligne.
 * La toile le montre déjà ; le bandeau le dit, et propose l'issue qui convient (Mon thème évolue par versions) :
 * - un MODÈLE : « Utiliser ce modèle » crée la version N+1 de Mon thème (fenêtre « Remplacer mon thème (version N) par X ? » quand
 *   il existe déjà), puis propose de la publier ;
 * - un ANCIEN thème : « En faire mon thème » (nouvelle version de Mon thème), puis propose de la publier ;
 * - Mon thème en brouillon : « Publier cette version » (fenêtre avant → après).
 * « Arrêter l'aperçu » : retour au thème en ligne. Dans tous les cas l'éditeur se recharge pour reprendre le bon thème.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";

import { activateThemeAction, adoptOldThemeAction, applyModelAction } from "@/app/admin/(espace)/themes/actions";

import { ConfirmDialog, toast } from "../editing";
import type { PreparingInfo } from "@/lib/edit/look-context";

async function leavePreview(): Promise<void> {
  try {
    await fetch("/admin/apercu/quitter", { method: "POST", body: new URLSearchParams({ retour: window.location.pathname }), credentials: "same-origin", redirect: "manual" });
  } catch {
    /* hors ligne : le rechargement montrera l'état réel */
  }
}

/** Met la toile sur Mon thème (version en cours) : c'est ce qu'on prépare une fois la version créée. */
async function previewMine(id: string): Promise<void> {
  try {
    await fetch("/admin/apercu", { method: "POST", body: new URLSearchParams({ id, retour: window.location.pathname }), credentials: "same-origin", redirect: "manual" });
  } catch {
    /* hors ligne : le rechargement montrera l'état réel */
  }
}

type Dialog = { kind: "replace" } | { kind: "publish"; mineId: string; version: number; fresh: boolean } | null;

export default function PreparingBanner({ preparing, flush }: { preparing: PreparingInfo; flush: () => Promise<unknown> }) {
  const t = useTranslations("editorPanelsPreparing");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  const stop = async () => {
    setBusy(true);
    await flush();
    await leavePreview();
    window.location.reload();
  };

  /** Mon thème a une nouvelle version : on la propose à la publication ; refuser la laisse en brouillon, sous les yeux dans l'éditeur. */
  const created = async (mineId: string, version: number) => {
    setBusy(false);
    setDialog({ kind: "publish", mineId, version, fresh: true });
  };
  const applyThisModel = async (mode?: "replace" | "second") => {
    setBusy(true);
    await flush();
    const result = await applyModelAction(preparing.id, mode);
    if (!result.ok) {
      setBusy(false);
      toast(result.message, "error");
      return;
    }
    if (result.data.second) {
      toast(t("secondCreated", { name: preparing.name }));
      setDialog(null);
      await leavePreview();
      window.location.reload();
      return;
    }
    if (result.data.published) {
      // Le modèle était déjà en ligne : Mon thème en a pris la place sans rien changer pour les visiteurs.
      await leavePreview();
      window.location.reload();
      return;
    }
    setDialog(null);
    await created(result.data.id, result.data.version);
  };
  const adopt = async () => {
    setBusy(true);
    await flush();
    const result = await adoptOldThemeAction(preparing.id);
    if (!result.ok) {
      setBusy(false);
      toast(result.message, "error");
      return;
    }
    await created(result.data.id, result.data.version);
  };
  const primary = () => {
    if (preparing.kind === "model") {
      if (preparing.mineVersion != null) setDialog({ kind: "replace" });
      else void applyThisModel();
    } else if (preparing.kind === "old") void adopt();
    else setDialog({ kind: "publish", mineId: preparing.id, version: preparing.mineVersion ?? 0, fresh: false });
  };

  const publish = async (mineId: string) => {
    setBusy(true);
    await flush();
    const result = await activateThemeAction(mineId);
    if (!result.ok) {
      setBusy(false);
      toast(result.message, "error");
      return;
    }
    await leavePreview();
    window.location.reload();
  };
  /** « Plus tard » après création : la toile montre la nouvelle version (brouillon de Mon thème), pas encore en ligne. */
  const later = async (mineId: string) => {
    setBusy(true);
    await previewMine(mineId);
    window.location.reload();
  };

  const label = preparing.kind === "model" ? t("useModel") : preparing.kind === "old" ? t("adoptOld") : t("publishVersion");
  const sentence =
    preparing.kind === "mine" ? (
      <>{t.rich("sentenceMine", { name: preparing.name, version: preparing.mineVersion ?? "", live: preparing.liveLabel, strong: (c) => <strong>{c}</strong> })}</>
    ) : (
      <>{t.rich("sentenceOther", { name: preparing.name, live: preparing.liveName, strong: (c) => <strong>{c}</strong> })}</>
    );

  return (
    <div className="ve-preparing" role="status" data-testid="preparing-banner" data-kind={preparing.kind}>
      <span>{sentence}</span>
      <span className="ve-preparing-actions">
        <button type="button" className="a-btn a-btn-small a-btn-primary" disabled={busy} onClick={primary} data-testid="preparing-publish">
          {label}
        </button>
        <button type="button" className="a-btn a-btn-small" disabled={busy} onClick={() => void stop()} data-testid="preparing-stop">
          {t("stop")}
        </button>
      </span>

      <ConfirmDialog
        open={dialog?.kind === "replace"}
        title={t("replaceTitle", { version: preparing.mineVersion ?? "", name: preparing.name })}
        confirmLabel={t("replace")}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => void applyThisModel("replace")}
        extra={
          <button type="button" className="a-btn" onClick={() => void applyThisModel("second")} disabled={busy} data-testid="replace-second">
            {t("second")}
          </button>
        }
      >
        <p data-testid="replace-text">{t("replaceText", { version: preparing.mineVersion ?? "" })}</p>
        <p className="muted">{t("replaceNote", { version: preparing.mineVersion ?? "" })}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "publish"}
        title={dialog?.kind === "publish" ? (dialog.fresh ? t("publishFresh", { version: dialog.version }) : t("publishTitle", { version: dialog.version, name: preparing.name })) : ""}
        confirmLabel={t("publishVersion")}
        busy={busy}
        onClose={() => (dialog?.kind === "publish" && dialog.fresh ? void later(dialog.mineId) : setDialog(null))}
        onConfirm={() => dialog?.kind === "publish" && void publish(dialog.mineId)}
      >
        <p className="a-swap" data-testid="activate-swap">
          <span>{preparing.liveLabel}</span>
          <span aria-hidden="true">→</span>
          <strong>{t("swap", { version: dialog?.kind === "publish" ? dialog.version : "" })}</strong>
        </p>
        <p className="muted">{t("publishNote")}{dialog?.kind === "publish" && dialog.fresh ? ` ${t("publishLater")}` : ""}</p>
      </ConfirmDialog>
    </div>
  );
}
