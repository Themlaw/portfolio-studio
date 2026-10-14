"use client";

/**
 * Aperçu d'un média de l'onglet Médias (clic sur une vignette quand aucun bloc sélectionné ne peut le
 * recevoir) : l'image ENTIÈRE ou la vidéo, son nom, ses tags, et comment la poser sur la page.
 */
import { useEffect, useId, useRef } from "react";

import type { AdminMediaRow } from "@/lib/admin";

export default function MediaPreviewDialog({ media, onClose }: { media: AdminMediaRow | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (media && !d.open) d.showModal();
    if (!media && d.open) d.close();
  }, [media]);
  return (
    <dialog
      ref={ref}
      className="a-dialog ve-preview"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}
    >
      {media && (
        <>
          <h2 id={titleId}>{media.name}</h2>
          <div className="a-dialog-body">
            <div className="ve-preview-stage" data-testid="media-preview">
              {media.kind === "video" && media.videoSrc ? (
                <video src={media.videoSrc} poster={media.preview ?? media.thumb ?? undefined} controls muted playsInline preload="metadata" />
              ) : media.preview || media.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media.preview ?? media.thumb ?? ""} alt={media.alt.fr || media.name} />
              ) : (
                <p className="ve-empty">{media.kind === "pdf" ? "Document PDF" : "Pas d'aperçu pour l'instant."}</p>
              )}
            </div>
            <p className="ve-hint">
              {media.width && media.height ? `${media.width} × ${media.height} px` : ""}
              {media.tags.length > 0 ? `${media.width ? " · " : ""}${media.tags.map((t) => t.label).join(", ")}` : ""}
            </p>
            <p className="ve-hint">
              Pour la poser : sélectionne d&apos;abord une image, une vidéo ou une grille sur la page puis clique ce média, ou glisse-le sur une planche ou une place vide.
            </p>
          </div>
          <div className="a-dialog-actions">
            <button type="button" className="a-btn" onClick={onClose}>
              Fermer
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
