"use client";

/**
 * Choisir l'image d'un emplacement (Remplacer, place vide) : la bibliothèque,
 * filtrable par nom et par tags, ou un fichier de l'ordinateur. Chaque image est montrée ENTIÈRE
 * (jamais rognée, fond neutre) avec son nom, comme dans le sélecteur de l'administration.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { AdminMediaRow } from "@/lib/admin";

import { ZoomButton } from "../MediaLibrary";
import { filterMedia } from "../LibraryStrip";
import MediaPreviewDialog from "./MediaPreviewDialog";
import { ACCEPT } from "../uploads";

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif";
const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm,.mkv";

export default function MediaPickerDialog({
  open,
  kind,
  media,
  onClose,
  onPick,
  onFile,
}: {
  open: boolean;
  /** Image ou vidéo attendue (titre et fichiers acceptés) ; sinon l'un ou l'autre. */
  kind?: "image" | "video";
  media: AdminMediaRow[];
  onClose: () => void;
  onPick: (mediaId: number) => void;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [zoomed, setZoomed] = useState<AdminMediaRow | null>(null);
  const titleId = useId();
  const inputId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const options = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of media) for (const t of m.tags) seen.set(t.label.toLowerCase(), t.label);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "fr"));
  }, [media]);
  const list = useMemo(() => filterMedia(media, tags, query).filter((m) => m.status !== "failed"), [media, tags, query]);
  return (
    <>
    <dialog
      ref={ref}
      className="a-dialog ve-picker"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Clic sur le fond (hors de la boîte) : fermé comme les autres menus flottants.
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}
    >
      {open && (
        <>
          <h2 id={titleId}>{kind === "video" ? "Choisir une vidéo" : kind === "image" ? "Choisir une image" : "Choisir une image ou une vidéo"}</h2>
          <div className="a-dialog-body">
            <label className="a-btn ve-picker-file" htmlFor={inputId}>
              Envoyer un fichier de l&apos;ordinateur…
            </label>
            <input
              id={inputId}
              className="sr-only"
              type="file"
              accept={kind === "video" ? VIDEO_ACCEPT : kind === "image" ? IMAGE_ACCEPT : ACCEPT}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
              }}
            />
            <label className="ve-picker-search">
              <span className="sr-only">Rechercher par nom ou tag</span>
              <input className="a-input" type="search" placeholder="Rechercher par nom ou tag…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {options.length > 0 && (
              <div className="ve-chips" role="group" aria-label="Filtrer par tags">
                {options.map((t) => {
                  const on = tags.includes(t);
                  return (
                    <button key={t} type="button" className="ve-chip" aria-pressed={on} onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}>
                      {t}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="ve-hint">Clique une image pour la choisir. La petite loupe l&apos;agrandit sans la choisir.</p>
            {list.length === 0 ? (
              <p className="ve-empty">Aucun média ne correspond.</p>
            ) : (
              <ul className="ve-picker-grid" aria-label="Bibliothèque">
                {list.slice(0, 200).map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => onPick(m.id)} aria-label={`Choisir ${m.name}`} title={m.name}>
                      <span className="ve-picker-thumb">
                        {m.thumb && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.thumb} alt="" loading="lazy" />
                        )}
                        {m.status === "processing" && <span className="ve-media-state">{m.kind === "video" ? "Conversion…" : "Traitement…"}</span>}
                      </span>
                      <span className="ve-picker-name">{m.name}</span>
                    </button>
                    {m.status === "ready" && <ZoomButton onZoom={() => setZoomed(m)} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="a-dialog-actions">
            <button type="button" className="a-btn" onClick={onClose}>
              Fermer
            </button>
          </div>
        </>
      )}
    </dialog>
      <MediaPreviewDialog media={zoomed} onClose={() => setZoomed(null)} hint={null} />
    </>
  );
}
