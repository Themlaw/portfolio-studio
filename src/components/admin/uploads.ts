"use client";

/**
 * Envoi d'images depuis l'admin : une requête par fichier (progression
 * individuelle), un envoi à la fois ; puis suivi du traitement (le média
 * passe de « processing » à « ready » ou « failed »).
 */
import { useEffect, useRef } from "react";

import { mediaStatusAction } from "@/app/admin/(espace)/medias/actions";
import type { AdminMediaRow } from "@/lib/admin";

export const isVideoFile = (file: File) => file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name);

export const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm,.mkv,application/pdf,.pdf";
/** PDF (bloc CV) : type déclaré ou extension ; le serveur vérifie la signature. */
export const isPdfFile = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

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

const isVideo = isVideoFile;

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
export async function uploadChunked(file: File, onProgress: (sent: number, total: number) => void, resumeId?: string, tags: string[] = []): Promise<UploadResult> {
  let id = resumeId;
  let offset = 0;
  let chunkSize = 8 * 1024 * 1024;
  if (id) {
    const st = await api<{ upload: { offset: number; size: number; chunkSize: number } }>(`/admin/api/upload/${id}/status`, { method: "GET" });
    if (!st.ok) return { ok: false, message: st.message, status: st.status };
    if (st.data.upload.size !== file.size) return { ok: false, message: "Ce n'est pas le même fichier (taille différente) : choisis le fichier d'origine.", definitive: true };
    offset = st.data.upload.offset;
    chunkSize = st.data.upload.chunkSize;
  } else {
    const init = await api<{ upload: { id: string; chunkSize: number } }>("/admin/api/upload/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, type: file.type || "application/octet-stream", tags }),
    });
    if (!init.ok) return { ok: false, message: init.message, status: init.status, definitive: init.status !== 0 && init.status < 500 && init.status !== 409 };
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
        return { ok: false, message: res.message, status: res.status, definitive: true };
      }
      if (attempt >= RETRY_DELAYS.length) return { ok: false, message: `${res.message} L'envoi est mis de côté : « Réessayer » le reprend où il s'est arrêté.`, status: res.status, uploadId: id };
      await sleep(RETRY_DELAYS[attempt++]);
      const st = await api<{ upload: { offset: number } }>(`/admin/api/upload/${id}/status`, { method: "GET" });
      if (st.ok) offset = st.data.upload.offset;
      onProgress(offset, file.size);
      if (offset >= file.size) break;
    }
    onProgress(offset, file.size);
  }
  // Tags COURANTS (une reprise a pu les changer depuis init) : ce sont eux qui sont attachés.
  const done = await api<{ media: UploadedMedia }>(`/admin/api/upload/${id}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tags }),
  });
  if (!done.ok && (done.status === 0 || done.status >= 500)) return { ok: false, message: done.message, status: done.status, uploadId: id };
  writePending(readPending().filter((p) => p.id !== id));
  if (!done.ok) return { ok: false, message: done.message, status: done.status, definitive: true };
  return { ok: true, media: done.data.media };
}

/**
 * Envoi d'UN fichier du kit (PSD ou archive .zip) : même envoi par morceaux (reprise après
 * coupure), refus avant l'envoi (taille, extension), contrôle à la fin sans décodage.
 * `batch` : fichier d'un envoi groupé ; le dernier (`last`) lance l'import.
 */
async function uploadKitFile(file: File, themeId: string, batch: { id: string; last: boolean } | undefined, onProgress: (sent: number, total: number) => void): Promise<{ ok: true; importId: string } | { ok: false; message: string }> {
  const init = await api<{ upload: { id: string; chunkSize: number } }>("/admin/api/upload/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, type: file.type || (/\.zip$/i.test(file.name) ? "application/zip" : "image/vnd.adobe.photoshop"), purpose: { kind: "kit", themeId, ...(batch ? { batch } : {}) } }),
  });
  if (!init.ok) return { ok: false, message: init.message };
  const id = init.data.upload.id;
  const chunkSize = init.data.upload.chunkSize;
  let offset = 0;
  onProgress(0, file.size);
  while (offset < file.size) {
    const blob = file.slice(offset, Math.min(file.size, offset + chunkSize));
    let attempt = 0;
    for (;;) {
      const res = await putChunk(id, offset, blob, (n) => onProgress(offset + n, file.size));
      if (res.ok) {
        offset = res.offset;
        break;
      }
      const retryable = res.status === 0 || res.status === 409 || (res.status >= 500 && res.status !== 507);
      if (!retryable || attempt >= RETRY_DELAYS.length) {
        await api(`/admin/api/upload/${id}`, { method: "DELETE" });
        return { ok: false, message: res.message };
      }
      await sleep(RETRY_DELAYS[attempt++]);
      const st = await api<{ upload: { offset: number } }>(`/admin/api/upload/${id}/status`, { method: "GET" });
      if (st.ok) offset = st.data.upload.offset;
      if (offset >= file.size) break;
    }
    onProgress(offset, file.size);
  }
  const done = await api<{ kitImport: { id: string } }>(`/admin/api/upload/${id}/complete`, { method: "POST" });
  if (!done.ok) return { ok: false, message: done.message };
  return { ok: true, importId: done.data.kitImport.id };
}

/**
 * Envoi du kit Photoshop rempli d'un thème : l'archive .zip, un seul .psd, ou plusieurs .psd
 * choisis ensemble (envoyés l'un après l'autre, importés d'un seul coup). Renvoie l'identifiant
 * de l'import. Un fichier refusé arrête l'envoi, avec son nom dans le message.
 */
export async function uploadKit(files: File[], themeId: string, onProgress: (sent: number, total: number) => void): Promise<{ ok: true; importId: string } | { ok: false; message: string }> {
  if (files.length === 0) return { ok: false, message: "Choisis le kit : l'archive .zip, ou un ou plusieurs fichiers Photoshop (.psd)." };
  if (files.length === 1) return uploadKitFile(files[0], themeId, undefined, onProgress);
  const bad = files.find((f) => !/\.psd$/i.test(f.name));
  if (bad) return { ok: false, message: `« ${bad.name} » n'est pas un fichier Photoshop (.psd) : pour plusieurs fichiers, choisis seulement des .psd (ou envoie le .zip seul).` };
  if (files.length > 3) return { ok: false, message: "Le kit compte 3 fichiers au plus." };
  const total = files.reduce((n, f) => n + f.size, 0);
  const batch = crypto.randomUUID();
  let done = 0;
  let importId = batch;
  for (const [i, file] of files.entries()) {
    const res = await uploadKitFile(file, themeId, { id: batch, last: i === files.length - 1 }, (sent) => onProgress(done + sent, total));
    if (!res.ok) return { ok: false, message: `« ${file.name} » : ${res.message}` };
    importId = res.importId;
    done += file.size;
  }
  return { ok: true, importId };
}

/** Envoi d'un fichier : direct (petite image) ou par morceaux (vidéo, grande image). */
export function sendFile(file: File, onProgress: (sent: number, total: number) => void, resumeId?: string, tags: string[] = []): Promise<UploadResult> {
  if (resumeId || isVideo(file) || file.size > CHUNKED_ABOVE) return uploadChunked(file, onProgress, resumeId, tags);
  return uploadFile(file, (ratio) => onProgress(Math.round(ratio * file.size), file.size), tags);
}

export type UploadedMedia = { id: number; status: string; width: number | null; height: number | null; name: string; reused: boolean; /** ms du dernier envoi (renvoi d'un contenu déjà présent). */ importedAt?: number; tagWarning?: string };
/**
 * Échec : `definitive` = refus du serveur (quota plein, taille, type, droits)
 * qu'un nouvel essai ne changerait pas ; `uploadId` = envoi par morceaux à
 * reprendre là où il s'est arrêté.
 */
export type UploadResult = { ok: true; media: UploadedMedia } | { ok: false; message: string; status?: number; definitive?: boolean; uploadId?: string };

export function uploadFile(file: File, onProgress: (ratio: number) => void, tags: string[] = []): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/admin/api/upload");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = xhr.response as UploadResult | null;
      if (body && typeof body === "object" && "ok" in body) {
        resolve(body.ok ? body : { ...body, status: xhr.status, definitive: xhr.status < 500 && xhr.status !== 408 });
      } else if (xhr.status === 401 || xhr.status === 403 || xhr.responseURL.includes("/admin/connexion")) resolve({ ok: false, message: "Ta session a expiré : reconnecte-toi.", status: xhr.status });
      else resolve({ ok: false, message: `L'envoi a échoué (erreur ${xhr.status}). Réessaie.`, status: xhr.status });
    };
    xhr.onerror = () => resolve({ ok: false, message: "Connexion interrompue pendant l'envoi. Réessaie.", status: 0 });
    const form = new FormData();
    // Tags d'abord : le serveur les lit avant le fichier.
    if (tags.length) form.append("tags", JSON.stringify(tags));
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

/**
 * Première image d'une vidéo (aperçu local) : <video> + canvas. null si le
 * navigateur ne décode pas le format (MKV, ProRes…) : l'interface montre une icône.
 */
export function readVideoFrame(file: File): Promise<{ ratio: number; preview: string } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    let settled = false;
    const done = (value: { ratio: number; preview: string } | null) => {
      if (settled) return;
      settled = true;
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    v.onloadeddata = () => {
      // Un peu après le début : la toute première image est souvent noire.
      v.currentTime = Math.min(0.5, (v.duration || 1) / 10);
    };
    v.onseeked = () => {
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) return done(null);
        const scale = Math.min(1, 480 / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
        done({ ratio: w / h, preview: canvas.toDataURL("image/jpeg", 0.75) });
      } catch {
        done(null);
      }
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 6000);
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
