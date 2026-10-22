"use client";

/**
 * Bandeau fixe de l'éditeur de page quand un thème est en préparation (lot 55) : aperçu admin d'un thème
 * pas encore en ligne. La toile le montre déjà ; le bandeau le dit, et propose les deux issues.
 * « Mettre en ligne » : le thème devient celui des visiteurs, l'aperçu s'arrête. « Arrêter l'aperçu » :
 * retour au thème en ligne. Dans les deux cas l'éditeur se recharge pour reprendre le bon thème.
 */
import { useState } from "react";

import { activateThemeAction } from "@/app/admin/(espace)/themes/actions";

import { toast } from "../editing";
import type { PreparingInfo } from "@/lib/edit/look-context";

async function leavePreview(): Promise<void> {
  try {
    await fetch("/admin/apercu/quitter", { method: "POST", body: new URLSearchParams({ retour: window.location.pathname }), credentials: "same-origin", redirect: "manual" });
  } catch {
    /* hors ligne : le rechargement montrera l'état réel */
  }
}

export default function PreparingBanner({ preparing, flush }: { preparing: PreparingInfo; flush: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);

  const stop = async () => {
    setBusy(true);
    await flush();
    await leavePreview();
    window.location.reload();
  };
  const publish = async () => {
    setBusy(true);
    await flush();
    const result = await activateThemeAction(preparing.id);
    if (!result.ok) {
      setBusy(false);
      toast(result.message, "error");
      return;
    }
    await leavePreview();
    window.location.reload();
  };

  return (
    <div className="ve-preparing" role="status" data-testid="preparing-banner">
      <span>
        Tu prépares le thème <strong>{preparing.name}</strong> : il n&apos;est pas encore en ligne (tes visiteurs voient encore « {preparing.liveName} »).
      </span>
      <span className="ve-preparing-actions">
        <button type="button" className="a-btn a-btn-small a-btn-primary" disabled={busy} onClick={() => void publish()} data-testid="preparing-publish">
          Mettre en ligne
        </button>
        <button type="button" className="a-btn a-btn-small" disabled={busy} onClick={() => void stop()} data-testid="preparing-stop">
          Arrêter l&apos;aperçu
        </button>
      </span>
    </div>
  );
}
