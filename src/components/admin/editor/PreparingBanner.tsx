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
  const useModel = async (mode?: "replace" | "second") => {
    setBusy(true);
    await flush();
    const result = await applyModelAction(preparing.id, mode);
    if (!result.ok) {
      setBusy(false);
      toast(result.message, "error");
      return;
    }
    if (result.data.second) {
      toast(`Second thème créé : « ${preparing.name} » (dans « Mes anciens thèmes »)`);
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
      else void useModel();
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

  const label = preparing.kind === "model" ? "Utiliser ce modèle" : preparing.kind === "old" ? "En faire mon thème" : "Publier cette version";
  const sentence =
    preparing.kind === "mine" ? (
      <>
        Tu prépares <strong>{preparing.name}</strong> (version {preparing.mineVersion}, brouillon) : elle n&apos;est pas encore en ligne (tes visiteurs voient encore « {preparing.liveLabel} »).
      </>
    ) : (
      <>
        Tu prépares le thème <strong>{preparing.name}</strong> : il n&apos;est pas encore en ligne (tes visiteurs voient encore « {preparing.liveName} »).
      </>
    );

  return (
    <div className="ve-preparing" role="status" data-testid="preparing-banner" data-kind={preparing.kind}>
      <span>{sentence}</span>
      <span className="ve-preparing-actions">
        <button type="button" className="a-btn a-btn-small a-btn-primary" disabled={busy} onClick={primary} data-testid="preparing-publish">
          {label}
        </button>
        <button type="button" className="a-btn a-btn-small" disabled={busy} onClick={() => void stop()} data-testid="preparing-stop">
          Arrêter l&apos;aperçu
        </button>
      </span>

      <ConfirmDialog
        open={dialog?.kind === "replace"}
        title={`Remplacer mon thème (version ${preparing.mineVersion ?? ""}) par ${preparing.name} ?`}
        confirmLabel="Remplacer"
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => void useModel("replace")}
        extra={
          <button type="button" className="a-btn" onClick={() => void useModel("second")} disabled={busy} data-testid="replace-second">
            Créer un second thème
          </button>
        }
      >
        <p data-testid="replace-text">Tu pourras revenir à la version {preparing.mineVersion}.</p>
        <p className="muted">« Remplacer » ajoute une nouvelle version à Mon thème (la version {preparing.mineVersion} reste dans l&apos;historique). Ton site ne change pas tant que tu ne publies pas.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "publish"}
        title={dialog?.kind === "publish" ? (dialog.fresh ? `Version ${dialog.version} de Mon thème créée : la mettre en ligne ?` : `Publier la version ${dialog.version} de « ${preparing.name} » ?`) : ""}
        confirmLabel="Publier cette version"
        busy={busy}
        onClose={() => (dialog?.kind === "publish" && dialog.fresh ? void later(dialog.mineId) : setDialog(null))}
        onConfirm={() => dialog?.kind === "publish" && void publish(dialog.mineId)}
      >
        <p className="a-swap" data-testid="activate-swap">
          <span>{preparing.liveLabel}</span>
          <span aria-hidden="true">→</span>
          <strong>Mon thème : v{dialog?.kind === "publish" ? dialog.version : ""}</strong>
        </p>
        <p className="muted">Tous tes visiteurs verront cette version dès maintenant, sur toutes les pages.{dialog?.kind === "publish" && dialog.fresh ? " Sinon elle reste en brouillon : tu la retrouves dans l'éditeur et sur l'écran Thèmes." : ""}</p>
      </ConfirmDialog>
    </div>
  );
}
