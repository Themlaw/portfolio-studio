"use client";

/**
 * « Télécharger le kit Photoshop » : demande l'export de l'état ENREGISTRÉ du
 * thème (file lourde, quelques secondes, ou plus si une vidéo est en cours de
 * conversion), suit sa préparation, puis lance le téléchargement.
 * Lot 122 : `startPart` télécharge UNE partie du kit (un seul .psd, celui de l'archive) ;
 * la préparation est la même (un seul export à la fois, une seule archive en cache).
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

/** Une partie du kit (réponse de l'API, kit prêt). */
export type KitPartInfo = { role: string; file: string; label: string; elements: string[]; bytes: number | null };
/** Ce que l'API dit d'un kit prêt : poids de chaque partie, de l'archive, durée de génération. */
export type KitReadyInfo = { parts: KitPartInfo[]; zipBytes: number | null; ms: number | null };

/** Préparation puis téléchargement du kit : l'état vit chez l'appelant (un menu qui se referme ne l'interrompt pas). */
export function useKitDownload(themeId: string) {
  const [busy, setBusy] = useState(false);
  const anyExport = useExporting();
  const [status, setStatus] = useState("");
  const [info, setInfo] = useState<KitReadyInfo | null>(null);
  /** Durée (s) du dernier téléchargement, par partie (« zip » : l'archive complète). */
  const [took, setTook] = useState<Record<string, number>>({});
  const [active, setActive] = useState<string | null>(null);
  const url = `/admin/api/theme-kit/${encodeURIComponent(themeId)}`;

  const run = async (part?: { role: string; file: string; label: string }) => {
    if (exporting) return;
    const t0 = Date.now();
    setActive(part?.role ?? "zip");
    setExporting(true);
    setBusy(true);
    setStatus("Préparation du kit…");
    try {
      // 3 minutes au plus (une conversion vidéo peut passer avant).
      for (let i = 0; i < 120; i++) {
        const res = await fetch(url, { method: "POST", credentials: "same-origin" });
        const body = (await res.json().catch(() => null)) as ({ ok?: boolean; ready?: boolean; status?: string; lastError?: string; message?: string } & Partial<KitReadyInfo>) | null;
        if (!res.ok || !body?.ok) throw new Error(body?.message ?? `Erreur ${res.status}`);
        if (body.ready) {
          setStatus("Kit prêt : téléchargement.");
          if (body.parts) setInfo({ parts: body.parts, zipBytes: body.zipBytes ?? null, ms: body.ms ?? null });
          setTook((t) => ({ ...t, [part?.role ?? "zip"]: Math.max(1, Math.round((Date.now() - t0) / 1000)) }));
          // Téléchargement (Content-Disposition: attachment) sans quitter la page.
          const link = document.createElement("a");
          link.href = part ? `${url}?part=${encodeURIComponent(part.role)}` : url;
          link.download = part ? part.file : `kit-${themeId}.zip`;
          document.body.append(link);
          link.click();
          link.remove();
          toast(part ? `Partie « ${part.label} » téléchargée` : "Kit Photoshop téléchargé");
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
      setActive(null);
      setExporting(false);
    }
  };
  const start = () => run();
  const startPart = (part: { role: string; file: string; label: string }) => run(part);

  return { start, startPart, busy, status, info, took, active, blocked: anyExport && !busy };
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

const formatSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);

/**
 * « Télécharger une partie seulement » (lot 122) : une entrée par fichier du kit, avec son
 * contenu, son poids et la durée. Les poids sont connus dès que le kit est généré (page rendue avec
 * ou mise à jour après la préparation) ; les noms de calques sont ceux du kit complet.
 */
export function KitPartsDownload({ themeId, parts: initial, ms: initialMs }: { themeId: string; parts: KitPartInfo[]; ms: number | null }) {
  const { startPart, busy, status, info, took, active, blocked } = useKitDownload(themeId);
  const parts = info?.parts ?? initial;
  const ms = info?.ms ?? initialMs;
  const known = parts.every((p) => p.bytes !== null);
  return (
    <div className="a-kit-parts" data-testid="kit-parts">
      <h3 className="a-kit-parts-title">Ou une partie seulement</h3>
      <p className="a-help">
        Chaque partie est un seul fichier .psd, identique à celui du kit complet (mêmes calques, mêmes noms). Renvoie-le tel quel : seule cette partie est mise à jour, les autres restent comme elles sont.
        {known ? (ms !== null ? ` Génération du kit : ${Math.max(1, Math.round(ms / 1000))} s (une fois, puis chaque partie se télécharge tout de suite).` : "") : " Le poids de chaque partie s'affiche une fois le kit généré."}
      </p>
      <ul className="a-kit-parts-list">
        {parts.map((p) => (
          <li key={p.role} data-part={p.role}>
            <span>
              <strong>{p.label}</strong>
              <small>
                {" "}
                · {p.elements.join(", ")} · <span data-testid={`kit-part-size-${p.role}`}>{p.bytes !== null ? formatSize(p.bytes) : "poids connu après génération"}</span>
                {took[p.role] ? ` · préparé en ${took[p.role]} s` : ""}
              </small>
            </span>
            <button type="button" className="a-btn a-btn-small" onClick={() => void startPart(p)} disabled={busy || blocked} aria-busy={busy && active === p.role} data-testid={`kit-part-${p.role}`}>
              {busy && active === p.role ? "Préparation…" : "Télécharger cette partie"}
            </button>
          </li>
        ))}
      </ul>
      {busy && (
        <span className="a-kit-progress" data-testid="kit-part-progress">
          <span className="a-spinner" aria-hidden="true" />
          {status || "Préparation du kit…"}
        </span>
      )}
    </div>
  );
}
