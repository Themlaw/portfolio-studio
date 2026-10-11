"use client";

/**
 * File d'envoi globale de l'admin (contexte posé par AdminShell) : elle
 * survit aux changements d'écran. Les fichiers partent l'un après l'autre
 * (pipeline existant : envoi simple ou par morceaux), avec leurs tags.
 *
 * - Lot (batch) : fichiers déposés ensemble dans un Uploader ; ses tags
 *   s'appliquent à chacun, plus les tags propres à un fichier.
 * - Tags : envoyés avec le fichier (init / formulaire) ; ceux ajoutés ou
 *   retirés pendant ou après l'envoi sont synchronisés dès que le média existe.
 * - Placement (planche) : seulement une fois le média créé en base ; si
 *   l'envoi échoue, rien n'est inséré et le fichier reste avec « Réessayer ».
 * - Réessayer : reprise par morceaux (même envoi), nouvel envoi simple, ou
 *   relance du traitement si le média existe déjà. Refus définitif (quota
 *   plein, taille, type) : pas de nouvel essai.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { addMediaTagsAction, listTagsAction, removeMediaTagsAction, retryMediaAction } from "@/app/admin/(espace)/medias/actions";
import { addSlotsAction, setSlotMediaAction } from "@/app/admin/(espace)/projets/actions";
import type { AdminMediaRow } from "@/lib/admin";
import { tagKey } from "@/lib/tag-key";
import type { TagRow } from "@/lib/tags";

import { useDismiss } from "../edit/useDismiss";
import { toast } from "./editing";
import { isPdfFile, isVideoFile, readRatio, readVideoFrame, sendFile, useMediaWatch, type UploadedMedia } from "./uploads";

export type Target = { kind: "library" } | { kind: "end"; projectId: number; at?: number } | { kind: "slot"; projectId: number; slotId: number };

export type QueueItem = {
  key: string;
  batchId: string;
  name: string;
  size: number;
  video: boolean;
  /** Aperçu local (objet URL d'une image, première image d'une vidéo). */
  preview?: string;
  /** La vidéo n'a pas pu être décodée par le navigateur : icône. */
  previewFailed?: boolean;
  ratio: number;
  phase: "waiting" | "uploading" | "processing" | "ready" | "failed";
  progress: number;
  sent: number;
  /** Échec : message, refus définitif, envoi par morceaux à reprendre. */
  message?: string;
  definitive?: boolean;
  uploadId?: string;
  mediaId?: number;
  target: Target;
  /** Tags propres à ce fichier. */
  fileTags: string[];
  /** Tags effectivement posés sur le média (synchronisation). */
  applied: string[];
  /**
   * Tags demandés (clé de l'ensemble) refusés par le serveur (plafonds) : pas
   * de nouvel essai tant que la demande ne change pas.
   */
  tagRefused?: string;
};

export type Batch = { id: string; origin: string; tags: string[]; dismissed: boolean };

type Listener = (item: QueueItem, media: UploadedMedia) => void;

type QueueApi = {
  items: QueueItem[];
  batches: Batch[];
  tags: TagRow[];
  refreshTags: () => void;
  addFiles: (files: File[], opts: { origin: string; target?: Target; batchId?: string; resumeId?: string }) => string;
  setBatchTags: (batchId: string, tags: string[]) => void;
  setFileTags: (key: string, tags: string[]) => void;
  retry: (key: string) => void;
  dismiss: (key: string) => void;
  dismissBatch: (batchId: string) => void;
  /** Abonnement : un média vient d'être créé (après placement éventuel). */
  onMediaCreated: (fn: Listener) => () => void;
};

const QueueContext = createContext<QueueApi | null>(null);

export function useUploadQueue(): QueueApi {
  const api = useContext(QueueContext);
  if (!api) throw new Error("useUploadQueue hors de UploadQueueProvider");
  return api;
}

let seq = 0;
const nextKey = (prefix: string) => `${prefix}${Date.now().toString(36)}${++seq}`;

/** Union de libellés, dédoublonnée par clé (le premier libellé gagne). */
export function unionTags(...lists: string[][]): string[] {
  const out = new Map<string, string>();
  for (const list of lists) for (const t of list) if (!out.has(tagKey(t))) out.set(tagKey(t), t);
  return [...out.values()];
}
/** Identité d'un ensemble de tags (ordre et casse indifférents). */
export const wantKey = (tags: string[]) => tags.map(tagKey).sort().join("|");
const diffTags = (a: string[], b: string[]) => {
  const keys = new Set(b.map(tagKey));
  return a.filter((t) => !keys.has(tagKey(t)));
};

export const isActive = (i: QueueItem) => i.phase === "waiting" || i.phase === "uploading";
/** Envoi terminé (média créé), qu'il soit prêt ou encore en traitement. */
export const isUploaded = (i: QueueItem) => i.phase === "processing" || i.phase === "ready";

export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const files = useRef(new Map<string, File>());
  const queue = useRef<string[]>([]);
  const running = useRef(false);
  const listeners = useRef(new Set<Listener>());
  // Copies à jour pour la boucle d'envoi (hors rendu).
  const itemsRef = useRef(items);
  const batchesRef = useRef(batches);
  useEffect(() => {
    itemsRef.current = items;
    batchesRef.current = batches;
  }, [items, batches]);

  const refreshTags = useCallback(() => {
    void listTagsAction().then((r) => r.ok && setTags(r.data));
  }, []);
  useEffect(() => {
    refreshTags();
  }, [refreshTags]);

  const patch = useCallback((key: string, p: Partial<QueueItem>) => {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
    itemsRef.current = itemsRef.current.map((i) => (i.key === key ? { ...i, ...p } : i));
  }, []);

  const wanted = (item: QueueItem) => unionTags(batchesRef.current.find((b) => b.id === item.batchId)?.tags ?? [], item.fileTags);

  const place = async (item: QueueItem, mediaId: number): Promise<string | null> => {
    const t = item.target;
    if (t.kind === "library") return null;
    const r = t.kind === "end" ? await addSlotsAction(t.projectId, [mediaId], t.at) : await setSlotMediaAction(t.slotId, mediaId);
    return r.ok ? null : r.message;
  };

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    while (queue.current.length) {
      const key = queue.current.shift()!;
      const item = itemsRef.current.find((i) => i.key === key);
      const file = files.current.get(key);
      if (!item || !file || item.phase !== "waiting") continue;
      patch(key, { phase: "uploading", message: undefined });
      const sentTags = wanted(item);
      const result = await sendFile(file, (sent, total) => patch(key, { progress: total ? sent / total : 0, sent }), item.uploadId, sentTags);
      if (!result.ok) {
        patch(key, { phase: "failed", message: result.message, definitive: result.definitive, uploadId: result.definitive ? undefined : (result.uploadId ?? item.uploadId) });
        continue;
      }
      const media = result.media;
      const ratio = media.width && media.height ? media.width / media.height : item.ratio;
      const phase = media.status === "ready" ? "ready" : media.status === "failed" ? "failed" : "processing";
      patch(key, {
        phase,
        progress: 1,
        sent: item.size,
        mediaId: media.id,
        ratio,
        uploadId: undefined,
        applied: media.tagWarning ? [] : sentTags,
        tagRefused: media.tagWarning ? wantKey(sentTags) : undefined,
        message: phase === "failed" ? "Le traitement a échoué." : undefined,
      });
      if (media.tagWarning) toast(media.tagWarning, "error");
      const placeError = await place(item, media.id);
      if (placeError) patch(key, { message: `Ajouté à la bibliothèque, mais pas à la planche : ${placeError}` });
      files.current.delete(key);
      refreshTags();
      const done = itemsRef.current.find((i) => i.key === key) ?? item;
      for (const fn of listeners.current) fn(done, media);
    }
    running.current = false;
  }, [patch, refreshTags]);

  const addFiles = useCallback<QueueApi["addFiles"]>(
    (list, { origin, target = { kind: "library" }, batchId, resumeId }) => {
      const id = batchId ?? nextKey("b");
      if (!batchId || !batchesRef.current.some((b) => b.id === id)) {
        const batch = { id, origin, tags: [], dismissed: false };
        setBatches((bs) => [...bs, batch]);
        batchesRef.current = [...batchesRef.current, batch];
      }
      const fresh: QueueItem[] = list.map((file) => {
        const video = isVideoFile(file);
        const pdf = isPdfFile(file);
        const key = nextKey("u");
        files.current.set(key, file);
        return {
          key,
          batchId: id,
          name: file.name,
          size: file.size,
          video,
          // Image : aperçu immédiat (objet URL) ; vidéo : première image ci-dessous ; PDF : aucun (rendu serveur).
          preview: video || pdf ? undefined : URL.createObjectURL(file),
          ratio: video ? 16 / 9 : pdf ? 210 / 297 : 4 / 3,
          phase: "waiting",
          progress: 0,
          sent: 0,
          uploadId: resumeId,
          target,
          fileTags: [],
          applied: [],
        };
      });
      setItems((l) => [...l, ...fresh]);
      itemsRef.current = [...itemsRef.current, ...fresh];
      queue.current.push(...fresh.map((f) => f.key));
      void pump();
      // Ratios et premières images, sans retarder l'envoi.
      for (const item of fresh) {
        const file = files.current.get(item.key)!;
        if (isPdfFile(file)) continue;
        void (item.video ? readVideoFrame(file) : readRatio(file)).then((info) => {
          if (info) patch(item.key, { ratio: info.ratio, ...(item.video ? { preview: info.preview } : {}) });
          else if (item.video) patch(item.key, { previewFailed: true });
          // readRatio crée son propre objet URL : on garde le premier.
          if (info && !item.video && info.preview !== item.preview) URL.revokeObjectURL(info.preview);
        });
      }
      return id;
    },
    [pump, patch],
  );

  const setBatchTags = useCallback((batchId: string, next: string[]) => {
    setBatches((bs) => bs.map((b) => (b.id === batchId ? { ...b, tags: next } : b)));
    batchesRef.current = batchesRef.current.map((b) => (b.id === batchId ? { ...b, tags: next } : b));
  }, []);
  const setFileTags = useCallback((key: string, next: string[]) => patch(key, { fileTags: next }), [patch]);

  const retry = useCallback(
    (key: string) => {
      const item = itemsRef.current.find((i) => i.key === key);
      if (!item || item.phase !== "failed" || item.definitive) return;
      if (item.mediaId) {
        // Le média existe : c'est son traitement qui a échoué.
        patch(key, { phase: "processing", message: undefined });
        void retryMediaAction(item.mediaId).then((r) => !r.ok && patch(key, { phase: "failed", message: r.message }));
        return;
      }
      if (!files.current.has(key)) return;
      patch(key, { phase: "waiting", progress: item.uploadId ? item.progress : 0, message: undefined });
      queue.current.push(key);
      void pump();
    },
    [patch, pump],
  );

  const dismiss = useCallback((key: string) => {
    const item = itemsRef.current.find((i) => i.key === key);
    if (item?.preview?.startsWith("blob:")) URL.revokeObjectURL(item.preview);
    files.current.delete(key);
    queue.current = queue.current.filter((k) => k !== key);
    setItems((l) => l.filter((i) => i.key !== key));
    itemsRef.current = itemsRef.current.filter((i) => i.key !== key);
  }, []);
  const dismissBatch = useCallback((batchId: string) => {
    setBatches((bs) => bs.map((b) => (b.id === batchId ? { ...b, dismissed: true } : b)));
    batchesRef.current = batchesRef.current.map((b) => (b.id === batchId ? { ...b, dismissed: true } : b));
  }, []);

  const onMediaCreated = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  // Tags ajoutés ou retirés après l'envoi : synchronisés (léger délai de frappe).
  // Un refus (plafond de 20 par média, de 500 en tout) est mémorisé : pas de
  // nouvel essai, ni de nouveau toast, tant que la demande reste la même.
  const syncing = useRef(new Set<string>());
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const item of items) {
        if (!item.mediaId || !isUploaded(item) || syncing.current.has(item.key)) continue;
        const want = unionTags(batches.find((b) => b.id === item.batchId)?.tags ?? [], item.fileTags);
        const add = diffTags(want, item.applied);
        const remove = diffTags(item.applied, want);
        if (!add.length && !remove.length) continue;
        const key = wantKey(want);
        if (item.tagRefused === key) continue;
        syncing.current.add(item.key);
        void (async () => {
          let applied = item.applied;
          let refused: string | undefined;
          try {
            if (add.length) {
              const r = await addMediaTagsAction([item.mediaId!], add);
              if (r.ok) applied = unionTags(applied, add);
              else {
                refused = key;
                toast(r.message, "error");
              }
            }
            if (remove.length && !refused) {
              const r = await removeMediaTagsAction([item.mediaId!], remove);
              if (r.ok) applied = diffTags(applied, remove);
              else {
                refused = key;
                toast(r.message, "error");
              }
            }
            if (!refused) refreshTags();
          } catch {
            // Réseau : mémorisé comme un refus ; un changement de tags relance.
            refused = key;
            toast("Les tags n'ont pas pu être enregistrés (connexion). Modifie-les pour réessayer.", "error");
          } finally {
            patch(item.key, { applied, tagRefused: refused });
            syncing.current.delete(item.key);
          }
        })();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [items, batches, patch, refreshTags]);

  // Traitements en cours (images, conversions) : état suivi jusqu'au bout.
  const processing = items.filter((i) => i.phase === "processing" && i.mediaId).map((i) => i.mediaId!);
  useMediaWatch(processing, (rows: AdminMediaRow[]) => {
    for (const row of rows) {
      if (row.status === "processing") continue;
      for (const item of itemsRef.current.filter((i) => i.mediaId === row.id && i.phase === "processing")) {
        patch(item.key, row.status === "ready" ? { phase: "ready" } : { phase: "failed", message: row.error ?? "Le traitement a échoué." });
      }
    }
  });

  // Quitter la page pendant un envoi : avertissement du navigateur.
  const uploading = items.some(isActive);
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const api = useMemo<QueueApi>(
    () => ({ items, batches, tags, refreshTags, addFiles, setBatchTags, setFileTags, retry, dismiss, dismissBatch, onMediaCreated }),
    [items, batches, tags, refreshTags, addFiles, setBatchTags, setFileTags, retry, dismiss, dismissBatch, onMediaCreated],
  );
  return <QueueContext.Provider value={api}>{children}</QueueContext.Provider>;
}

/** Indicateur discret (barre latérale) : « 2 envois en cours », ouvre la file. */
export function QueueIndicator() {
  const { items, retry, dismiss } = useUploadQueue();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, () => setOpen(false), { enabled: open });
  const active = items.filter(isActive).length;
  const failed = items.filter((i) => i.phase === "failed").length;
  const converting = items.filter((i) => i.phase === "processing").length;
  if (!active && !failed && !converting && !open) return null;
  const label = active
    ? `${active} envoi${active > 1 ? "s" : ""} en cours`
    : failed
      ? `${failed} envoi${failed > 1 ? "s" : ""} en échec`
      : `${converting} traitement${converting > 1 ? "s" : ""} en cours`;
  return (
    <div ref={root} className="a-queue">
      <button type="button" className="a-queue-toggle" aria-expanded={open} aria-controls="a-queue-panel" onClick={() => setOpen(!open)} data-failed={failed > 0 || undefined}>
        <span className="a-queue-dot" aria-hidden="true" data-active={active > 0 || undefined} />
        {label}
      </button>
      {open && (
        <div id="a-queue-panel" className="a-queue-panel" role="region" aria-label="File d'envoi">
          {items.length === 0 ? (
            <p className="muted">Aucun envoi.</p>
          ) : (
            <ul>
              {items.map((i) => (
                <li key={i.key} data-phase={i.phase}>
                  <span className="a-queue-name">{i.name}</span>
                  <span className="a-queue-state">
                    {i.phase === "waiting" && "En attente"}
                    {i.phase === "uploading" && `${Math.round(i.progress * 100)} %`}
                    {i.phase === "processing" && (i.video ? "Conversion…" : "Traitement…")}
                    {i.phase === "ready" && "✓"}
                    {i.phase === "failed" && <span className="a-danger-text">{i.message}</span>}
                  </span>
                  {i.phase === "failed" && !i.definitive && (
                    <button type="button" className="a-btn a-btn-small" onClick={() => retry(i.key)}>
                      Réessayer
                    </button>
                  )}
                  {!isActive(i) && (
                    <button type="button" className="a-icon-btn" aria-label={`Retirer ${i.name} de la file`} onClick={() => dismiss(i.key)}>
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
