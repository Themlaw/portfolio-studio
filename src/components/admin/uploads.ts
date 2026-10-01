"use client";

/**
 * Envoi d'images depuis l'admin : une requête par fichier (progression
 * individuelle), un envoi à la fois ; puis suivi du traitement (le média
 * passe de « processing » à « ready » ou « failed »).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { mediaStatusAction } from "@/app/admin/(espace)/medias/actions";
import type { AdminMediaRow } from "@/lib/admin";

export const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm,.mkv";

/** Au-delà, envoi par morceaux reprenable (et toujours pour une vidéo). */
const CHUNKED_ABOVE = 8 * 1024 * 1024;
const RETRY_DELAYS = [1000, 3000, 9000];
const PENDING_KEY = "portfolio-envois";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Pending = { id: string; name: string; size: number; lastModified: number };
function readPending(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as Pending[];
  } catch {
    return [];
  }
}
function writePending(list: Pending[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    // stockage indisponible : la reprise passera par la médiathèque
  }
}

const isVideo = (file: File) => file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name);

async function api<T>(url: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  try {
    const res = await fetch(url, { ...init, credentials: "same-origin" });
    const body = (await res.json().catch(() => null)) as ({ ok: boolean; message?: string } & T) | null;
    if (res.ok && body?.ok) return { ok: true, data: body };
    return { ok: false, status: res.status, message: body?.message ?? `L'envoi a échoué (erreur ${res.status}).` };
  } catch {
    return { ok: false, status: 0, message: "Connexion interrompue." };
  }
}

/** Un morceau par XHR (progression fine) ; renvoie le nouvel offset ou une erreur. */
function putChunk(id: string, offset: number, blob: Blob, onBytes: (n: number) => void): Promise<{ ok: true; offset: number } | { ok: false; status: number; message: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/admin/api/upload/${id}/chunk?offset=${offset}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => {
      const body = xhr.response as { ok?: boolean; upload?: { offset: number }; message?: string } | null;
      if (xhr.status === 200 && body?.ok && body.upload) resolve({ ok: true, offset: body.upload.offset });
      else resolve({ ok: false, status: xhr.status, message: body?.message ?? `Morceau refusé (erreur ${xhr.status}).` });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, message: "Connexion interrompue." });
    xhr.send(blob);
  });
}

/**
 * Envoi par morceaux de 8 Mo : reprise automatique après une coupure (3 essais,
 * délai croissant, l'offset est relu sur le serveur), progression réelle.
 * `resumeId` : reprendre un envoi interrompu (même fichier).
 */
export async function uploadChunked(file: File, onProgress: (sent: number, total: number) => void, resumeId?: string): Promise<UploadResult> {
  let id = resumeId;
  let offset = 0;
  let chunkSize = 8 * 1024 * 1024;
  if (id) {
    const st = await api<{ upload: { offset: number; size: number; chunkSize: number } }>(`/admin/api/upload/${id}/status`, { method: "GET" });
    if (!st.ok) return { ok: false, message: st.message };
    if (st.data.upload.size !== file.size) return { ok: false, message: "Ce n'est pas le même fichier (taille différente) : choisis le fichier d'origine." };
    offset = st.data.upload.offset;
    chunkSize = st.data.upload.chunkSize;
  } else {
    const init = await api<{ upload: { id: string; chunkSize: number } }>("/admin/api/upload/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, type: file.type || "application/octet-stream" }),
    });
    if (!init.ok) return { ok: false, message: init.message };
    id = init.data.upload.id;
    chunkSize = init.data.upload.chunkSize;
    writePending([...readPending().filter((p) => p.id !== id), { id, name: file.name, size: file.size, lastModified: file.lastModified }]);
  }
  onProgress(offset, file.size);
  while (offset < file.size) {
    const blob = file.slice(offset, Math.min(file.size, offset + chunkSize));
    let attempt = 0;
    for (;;) {
      const res = await putChunk(id, offset, blob, (n) => onProgress(offset + n, file.size));
      if (res.ok) {
        offset = res.offset;
        break;
      }
      // Refus définitif (quota plein 507, taille, droits…) : envoi annulé côté
      // serveur (sa réservation est rendue), message du serveur affiché.
      const retryable = res.status === 0 || res.status === 409 || (res.status >= 500 && res.status !== 507);
      if (!retryable) {
        await api(`/admin/api/upload/${id}`, { method: "DELETE" });
        writePending(readPending().filter((p) => p.id !== id));
        return { ok: false, message: res.message };
      }
      if (attempt >= RETRY_DELAYS.length) return { ok: false, message: `${res.message} L'envoi est mis de côté : reprends-le depuis la médiathèque.` };
      await sleep(RETRY_DELAYS[attempt++]);
      const st = await api<{ upload: { offset: number } }>(`/admin/api/upload/${id}/status`, { method: "GET" });
      if (st.ok) offset = st.data.upload.offset;
      onProgress(offset, file.size);
      if (offset >= file.size) break;
    }
    onProgress(offset, file.size);
  }
  const done = await api<{ media: { id: number; status: string; width: number | null; height: number | null; name: string; reused: boolean } }>(`/admin/api/upload/${id}/complete`, { method: "POST" });
  writePending(readPending().filter((p) => p.id !== id));
  if (!done.ok) return { ok: false, message: done.message };
  return { ok: true, media: done.data.media };
}

/** Envoi d'un fichier : direct (petite image) ou par morceaux (vidéo, grande image). */
export function sendFile(file: File, onProgress: (sent: number, total: number) => void, resumeId?: string): Promise<UploadResult> {
  if (resumeId || isVideo(file) || file.size > CHUNKED_ABOVE) return uploadChunked(file, onProgress, resumeId);
  return uploadFile(file, (ratio) => onProgress(Math.round(ratio * file.size), file.size));
}

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

/** Ratio d'une vidéo lu dans le navigateur (métadonnées), sans aperçu. */
export function readVideoRatio(file: File): Promise<{ ratio: number; preview?: string } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (value: { ratio: number } | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    v.onloadedmetadata = () => done(v.videoWidth && v.videoHeight ? { ratio: v.videoWidth / v.videoHeight } : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    v.src = url;
  });
}

/** « 120 / 512 Mo » */
export function formatSent(sent = 0, total = 0): string {
  const mb = (n: number) => (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0).replace(".", ",");
  return `${mb(sent)} / ${mb(total)} Mo`;
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
  /** Octets envoyés / total (affichage « 120 / 512 Mo »). */
  sent?: number;
  total?: number;
  video?: boolean;
  phase: "waiting" | "uploading" | "processing" | "ready" | "failed";
  progress: number;
  message?: string;
  ratio: number;
  preview?: string;
  mediaId?: number;
  /** Cible : fin de planche, ou un emplacement vide. */
  target?: number | "end";
  /** Reprise d'un envoi interrompu (identifiant serveur). */
  resumeId?: string;
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
      const result = await sendFile(file, (sent, total) => patch(item.key, { progress: total ? sent / total : 0, sent, total }), item.resumeId);
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
    async (files: File[], target: number | "end" = "end", resumeId?: string) => {
      const fresh: { item: UploadItem; file: File }[] = [];
      for (const file of files) {
        const video = isVideo(file);
        const info = video ? await readVideoRatio(file) : await readRatio(file);
        fresh.push({
          file,
          item: { key: `u${++seq}`, name: file.name, phase: "waiting", progress: 0, ratio: info?.ratio ?? (video ? 16 / 9 : 4 / 3), preview: info?.preview, target, video, resumeId, total: file.size, sent: 0 },
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
