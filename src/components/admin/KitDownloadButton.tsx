"use client";

/**
 * « Télécharger le kit Photoshop » : demande l'export de l'état ENREGISTRÉ du
 * thème (file lourde, quelques secondes, ou plus si une vidéo est en cours de
 * conversion), suit sa préparation, puis lance le téléchargement.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import { toast } from "./editing";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Un seul export à la fois sur la page (tous les boutons « Télécharger le kit » se bloquent ensemble). */
let exporting = false;
const listeners = new Set<() => void>();
const setExporting = (v: boolean) => {
  exporting = v;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const useExporting = () => useSyncExternalStore(subscribe, () => exporting, () => false);

/** Préparation puis téléchargement du kit : l'état vit chez l'appelant (un menu qui se referme ne l'interrompt pas). */
export function useKitDownload(themeId: string) {
  const [busy, setBusy] = useState(false);
  const anyExport = useExporting();
  const [status, setStatus] = useState("");
  const url = `/admin/api/theme-kit/${encodeURIComponent(themeId)}`;

  const start = async () => {
    if (exporting) return;
    setExporting(true);
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
      setExporting(false);
    }
  };

  return { start, busy, status, blocked: anyExport && !busy };
}

export default function KitDownloadButton({ themeId, small = false }: { themeId: string; small?: boolean }) {
  const { start, busy, status, blocked } = useKitDownload(themeId);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => {
      clearInterval(timer);
      setSeconds(0);
    };
  }, [busy]);
  return (
    <>
      <button type="button" className={`a-btn${small ? " a-btn-small" : ""}`} onClick={start} disabled={busy || blocked} aria-busy={busy} data-testid="kit-download">
        {busy ? "Préparation du kit…" : "Télécharger le kit Photoshop"}
      </button>
      {busy && (
        <span className="a-kit-progress" data-testid="kit-download-progress">
          <span className="a-spinner" aria-hidden="true" />
          {status || "Préparation du kit…"} {seconds > 0 ? `${seconds} s` : ""} (jusqu&apos;à 20 secondes)
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {status}
      </span>
    </>
  );
}
