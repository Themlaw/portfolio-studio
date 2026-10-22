"use client";

/**
 * Composant d'envoi unifié (planche, sélecteur de média des blocs,
 * médiathèque). Compact quand il est vide (une ligne) ; il s'ouvre en panneau
 * d'aperçus dès qu'il reçoit des fichiers : aperçu local immédiat, barre de
 * progression par fichier, tags du lot et, en option, tags d'un fichier. Une
 * fois tout envoyé, il se replie en une ligne de bilan.
 *
 * Les envois vivent dans la file globale (UploadQueue) : changer d'écran ne
 * les interrompt pas, et revenir sur l'écran retrouve le panneau (`origin`).
 */
import Link from "next/link";
import { useId, useRef, useState } from "react";

import TagInput from "@/app/admin/_fields/TagInput";

import { formatSent, hasFiles, ACCEPT } from "./uploads";
import { isActive, isUploaded, useUploadQueue, type QueueItem, type Target } from "./UploadQueue";

function stateText(i: QueueItem): string {
  switch (i.phase) {
    case "waiting":
      return "En attente";
    case "uploading":
      return i.size > 8 * 1024 * 1024 ? `Envoi ${formatSent(i.sent, i.size)}` : `Envoi ${Math.round(i.progress * 100)} %`;
    case "processing":
      return i.video ? "Envoyée · conversion…" : "Envoyée · traitement…";
    case "ready":
      return "Ajoutée";
    case "failed":
      return i.message ?? "Échec";
  }
}

function PreviewCard({ item }: { item: QueueItem }) {
  const { tags, setFileTags, retry, dismiss } = useUploadQueue();
  const pct = Math.round(item.progress * 100);
  return (
    <li className="a-up-card" data-phase={item.phase}>
      <div className="a-up-thumb" style={{ aspectRatio: String(Math.min(2.4, Math.max(0.5, item.ratio))) }}>
        {item.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.preview} alt="" />
        ) : (
          <span className="a-up-icon" aria-hidden="true">
            {item.video ? "▶" : "▧"}
          </span>
        )}
        {item.video && item.previewFailed && <span className="a-up-noprev">Aperçu indisponible</span>}
      </div>
      <div className="a-up-body">
        <span className="a-up-name" title={item.name}>
          {item.name}
        </span>
        <span className="a-up-state" data-failed={item.phase === "failed" || undefined}>
          {stateText(item)}
        </span>
        <span
          className="a-progress"
          role="progressbar"
          aria-label={`Envoi de ${item.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={item.phase === "uploading" ? pct : isUploaded(item) ? 100 : 0}
        >
          <span style={{ width: item.phase === "uploading" ? `${pct}%` : isUploaded(item) ? "100%" : "0%" }} data-done={isUploaded(item) || undefined} />
        </span>
        <div className="a-up-actions">
          {item.phase === "failed" && !item.definitive && (
            <button type="button" className="a-btn a-btn-small" onClick={() => retry(item.key)}>
              Réessayer
            </button>
          )}
          {!isActive(item) && (
            <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => dismiss(item.key)} aria-label={`Retirer ${item.name} de la liste`}>
              Retirer
            </button>
          )}
        </div>
        {item.phase !== "failed" && (
          <TagInput
            label={`Tags de ${item.name}`}
            hideLabel
            size="compact"
            value={item.fileTags}
            onChange={(v) => setFileTags(item.key, v)}
            options={tags}
            placeholder="Tags de ce fichier…"
          />
        )}
      </div>
    </li>
  );
}

export default function Uploader({
  origin,
  target,
  libraryHref = "/admin/medias",
  libraryLabel = "Voir",
  onSeeLibrary,
  multiple = true,
  label = "Dépose des images ou vidéos, ou choisis-les",
}: {
  /** Identifiant de l'écran (retrouver ses lots en y revenant). */
  origin: string;
  target?: Target;
  libraryHref?: string;
  libraryLabel?: string;
  /** Au lieu du lien : action (ex. faire défiler jusqu'au bandeau Bibliothèque). */
  onSeeLibrary?: () => void;
  multiple?: boolean;
  label?: string;
}) {
  const queue = useUploadQueue();
  const [over, setOver] = useState(false);
  const inputId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [reopened, setReopened] = useState<string | null>(null);
  // Le panneau ne se replie pas sous les doigts : pas tant que le focus y est.
  const [focusInside, setFocusInside] = useState(false);

  const batches = queue.batches.filter((b) => b.origin === origin && !b.dismissed);
  const batch = batches.at(-1);
  const items = batch ? queue.items.filter((i) => i.batchId === batch.id) : [];
  const done = items.length > 0 && items.every(isUploaded);
  const collapsed = done && !focusInside && reopened !== batch?.id;

  const add = (files: File[]) => {
    if (!files.length) return;
    const list = multiple ? files : files.slice(0, 1);
    // Lot en cours non terminé : les nouveaux fichiers le rejoignent (mêmes tags).
    queue.addFiles(list, { origin, target, batchId: batch && !done ? batch.id : undefined });
    setReopened(null);
  };

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      setOver(false);
      add([...e.dataTransfer.files]);
    },
  };

  const picker = (
    <>
      <label htmlFor={inputId} className="a-btn a-btn-small a-file-btn">
        Choisir des fichiers
      </label>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          add(files);
        }}
      />
    </>
  );

  // Vide, ou lot terminé : une ligne.
  if (!batch || collapsed) {
    const count = items.length;
    return (
      <div className="a-uploader" data-state={collapsed ? "done" : "empty"} data-over={over || undefined} {...dropProps}>
        {collapsed ? (
          <p className="a-uploader-line" role="status">
            <span className="a-uploader-ok" aria-hidden="true">
              ✓
            </span>
            {target?.kind === "end" || target?.kind === "slot" ? (
              <>
                {count} image{count > 1 ? "s" : ""} ajoutée{count > 1 ? "s" : ""} à ce projet
              </>
            ) : (
              <>
                {count} fichier{count > 1 ? "s" : ""} ajouté{count > 1 ? "s" : ""} à ta bibliothèque
              </>
            )}
            {batch!.tags.length > 0 && <span className="muted"> · {batch!.tags.join(", ")}</span>}
            <span className="a-uploader-links">
              {onSeeLibrary ? (
                <button type="button" className="a-link-btn" onClick={onSeeLibrary}>
                  {libraryLabel}
                </button>
              ) : (
                <Link href={libraryHref}>{libraryLabel}</Link>
              )}
              <button type="button" className="a-link-btn" onClick={() => setReopened(batch!.id)}>
                Modifier les tags
              </button>
              <button type="button" className="a-icon-btn" aria-label="Fermer le bilan" onClick={() => queue.dismissBatch(batch!.id)}>
                ✕
              </button>
            </span>
          </p>
        ) : (
          <p className="a-uploader-line">
            <span className="a-uploader-icon" aria-hidden="true">
              ↑
            </span>
            <span className="a-uploader-text">{label}</span>
            {picker}
          </p>
        )}
      </div>
    );
  }

  const sending = items.filter(isActive).length;
  const failed = items.filter((i) => i.phase === "failed").length;
  return (
    <div
      ref={panelRef}
      className="a-uploader"
      data-state="open"
      data-over={over || undefined}
      {...dropProps}
      onFocus={() => setFocusInside(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocusInside(false);
      }}
    >
      <div className="a-uploader-head">
        <p className="a-uploader-title" aria-live="polite">
          {sending
            ? `Envoi de ${items.length} fichier${items.length > 1 ? "s" : ""}…`
            : failed
              ? `${failed} envoi${failed > 1 ? "s" : ""} en échec`
              : `${items.length} fichier${items.length > 1 ? "s" : ""} envoyé${items.length > 1 ? "s" : ""}`}
        </p>
        <span className="a-uploader-more">
          <span className="muted">Déposes-en d&apos;autres ici, ou</span> {picker}
        </span>
        {done && (
          <button
            type="button"
            className="a-btn a-btn-small"
            onClick={() => {
              setReopened(null);
              setFocusInside(false);
            }}
          >
            Terminé
          </button>
        )}
      </div>
      <ul className="a-up-grid">
        {items.map((i) => (
          <PreviewCard key={i.key} item={i} />
        ))}
      </ul>
      <TagInput
        label={items.length > 1 ? `Tags pour ces ${items.length} fichiers` : "Tags pour ce fichier"}
        value={batch.tags}
        onChange={(v) => queue.setBatchTags(batch.id, v)}
        options={queue.tags}
        help="Pour ranger et retrouver tes images. Entrée pour valider un tag."
      />
    </div>
  );
}
