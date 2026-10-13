"use client";

/**
 * « Télécharger le kit Photoshop » : demande l'export de l'état ENREGISTRÉ du
 * thème (file lourde, quelques secondes, ou plus si une vidéo est en cours de
 * conversion), suit sa préparation, puis lance le téléchargement.
 */
import { useState } from "react";

import { toast } from "./editing";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function KitDownloadButton({ themeId, small = false }: { themeId: string; small?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const url = `/admin/api/theme-kit/${encodeURIComponent(themeId)}`;

  const start = async () => {
    setBusy(true);
    setStatus("Préparation du kit…");
    try {
      // 3 minutes au plus (une conversion vidéo peut passer avant).
      for (let i = 0; i < 120; i++) {
        const res = await fetch(url, { method: "POST", credentials: "same-origin" });
        const body = (await res.json().catch(() => null)) as { ok?: boolean; ready?: boolean; status?: string; lastError?: string; message?: string } | null;
        if (!res.ok || !body?.ok) throw new Error(body?.message ?? `Erreur ${res.status}`);
        if (body.ready) {
          setStatus("Kit prêt : téléchargement.");
          // Téléchargement (Content-Disposition: attachment) sans quitter la page.
          const link = document.createElement("a");
          link.href = url;
          link.download = `kit-${themeId}.zip`;
          document.body.append(link);
          link.click();
          link.remove();
          toast("Kit Photoshop téléchargé");
          return;
        }
        setStatus(body.status === "running" ? "Génération du kit…" : "Kit en file d'attente (une conversion vidéo est peut-être en cours)…");
        await sleep(1500);
      }
      throw new Error("La préparation du kit prend trop de temps : réessaie dans un moment.");
    } catch (error) {
      setStatus("");
      toast(error instanceof Error ? error.message : "La préparation du kit a échoué.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={`a-btn${small ? " a-btn-small" : ""}`} onClick={start} disabled={busy} aria-busy={busy}>
        {busy ? "Préparation du kit…" : "Télécharger le kit Photoshop"}
      </button>
      <span className="sr-only" aria-live="polite">
        {status}
      </span>
    </>
  );
}
