"use client";

/**
 * Envoi d'images depuis l'admin : une requête par fichier (progression
 * individuelle), un envoi à la fois ; puis suivi du traitement (le média
 * passe de « processing » à « ready » ou « failed »).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { mediaStatusAction } from "@/app/admin/(espace)/medias/actions";
import type { AdminMediaRow } from "@/lib/admin";

export const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif";

export type UploadResult = { ok: true; media: { id: number; status: string; width: number | null; height: number | null; name: string; reused: boolean } } | { ok: false; message: string };

export function uploadFile(file: File, onProgress: (ratio: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/admin/api/upload");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = xhr.response as UploadResult | null;
      if (body && typeof body === "object" && "ok" in body) resolve(body);
      else if (xhr.status === 401 || xhr.status === 403 || xhr.responseURL.includes("/admin/connexion")) resolve({ ok: false, message: "Ta session a expiré : reconnecte-toi." });
      else resolve({ ok: false, message: `L'envoi a échoué (erreur ${xhr.status}). Réessaie.` });
    };
    xhr.onerror = () => resolve({ ok: false, message: "Connexion interrompue pendant l'envoi. Réessaie." });
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

/** Ratio largeur/hauteur lu dans le navigateur (réserve la place avant l'envoi). */
export function readRatio(file: File): Promise<{ ratio: number; preview: string } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ ratio: img.naturalWidth / Math.max(1, img.naturalHeight), preview: url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export type UploadItem = {
  key: string;
  name: string;
  phase: "waiting" | "uploading" | "processing" | "ready" | "failed";
  progress: number;
  message?: string;
  ratio: number;
  preview?: string;
  mediaId?: number;
  /** Cible : fin de planche, ou un emplacement vide. */
  target?: number | "end";
};

let seq = 0;

/**
 * File d'envoi : les fichiers partent l'un après l'autre. `onUploaded` est
 * appelé dès qu'un média existe (pour créer ou remplir un emplacement).
 */
type QueueApi = { patch: (key: string, p: Partial<UploadItem>) => void; remove: (key: string) => void };

export function useUploadQueue(onUploaded: (item: UploadItem, mediaId: number, api: QueueApi) => Promise<void> | void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const queue = useRef<{ item: UploadItem; file: File }[]>([]);
  const running = useRef(false);
  const callback = useRef(onUploaded);
  useEffect(() => {
    callback.current = onUploaded;
  }, [onUploaded]);

  const patch = useCallback((key: string, p: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i))), []);
  const remove = useCallback((key: string) => setItems((list) => list.filter((i) => i.key !== key)), []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    while (queue.current.length) {
      const { item, file } = queue.current.shift()!;
      patch(item.key, { phase: "uploading" });
      const result = await uploadFile(file, (r) => patch(item.key, { progress: r }));
      if (!result.ok) {
        patch(item.key, { phase: "failed", message: result.message });
        continue;
      }
      const phase = result.media.status === "ready" ? "ready" : result.media.status === "failed" ? "failed" : "processing";
      const ratio = result.media.width && result.media.height ? result.media.width / result.media.height : item.ratio;
      patch(item.key, { phase, progress: 1, mediaId: result.media.id, ratio });
      await callback.current({ ...item, mediaId: result.media.id, ratio }, result.media.id, { patch, remove });
    }
    running.current = false;
  }, [patch, remove]);

  const add = useCallback(
    async (files: File[], target: number | "end" = "end") => {
      const fresh: { item: UploadItem; file: File }[] = [];
      for (const file of files) {
        const info = await readRatio(file);
        fresh.push({
          file,
          item: { key: `u${++seq}`, name: file.name, phase: "waiting", progress: 0, ratio: info?.ratio ?? 4 / 3, preview: info?.preview, target },
        });
      }
      setItems((list) => [...list, ...fresh.map((f) => f.item)]);
      queue.current.push(...fresh);
      void pump();
    },
    [pump],
  );

  return { items, add, remove, patch };
}

/**
 * Suit des médias en traitement : interroge leur état chaque seconde tant
 * qu'il en reste en « processing », et transmet les lignes à jour.
 */
export function useMediaWatch(ids: number[], onUpdate: (rows: AdminMediaRow[]) => void) {
  const key = [...new Set(ids)].sort((a, b) => a - b).join(",");
  const callback = useRef(onUpdate);
  useEffect(() => {
    callback.current = onUpdate;
  }, [onUpdate]);
  useEffect(() => {
    if (!key) return;
    const wanted = key.split(",").map(Number);
    let stop = false;
    const timer = setInterval(async () => {
      const result = await mediaStatusAction(wanted);
      if (!stop && result.ok) callback.current(result.data);
    }, 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [key]);
}

/** Fichiers image d'un glisser-déposer (les autres sont signalés par le serveur). */
export function filesFrom(dt: DataTransfer | null): File[] {
  return dt ? [...dt.files] : [];
}

export const hasFiles = (dt: DataTransfer | null) => Boolean(dt && [...dt.types].includes("Files"));

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}
