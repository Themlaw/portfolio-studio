"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { createShareLinkAction, deleteShareLinkAction, setShareLinkEnabledAction, updateShareLinkAction } from "@/app/admin/(espace)/liens/actions";
import type { AdminMediaRow } from "@/lib/admin";
import type { ShareLinkRow } from "@/lib/edit/share-links";
import { normalizeShareSlug } from "@/lib/share-links";
import { MediaPickerDialog } from "@/components/admin/MediaLibrary";
import { uploadChunked } from "@/components/admin/uploads";
import { ConfirmDialog, toast } from "@/components/admin/editing";

type Props = { initial: ShareLinkRow[]; media: AdminMediaRow[] };

export default function LinksLibrary({ initial, media }: Props) {
  const t = useTranslations("links");
  const router = useRouter();
  const [links, setLinks] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setLinks(initial);
  }
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ShareLinkRow | null>(null);
  const [slug, setSlug] = useState("");
  const [titleFr, setTitleFr] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [mediaId, setMediaId] = useState<number | undefined>(undefined);
  const [allowDownload, setAllowDownload] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mediaOpen, setMediaOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slugInputRef = useRef<HTMLInputElement>(null);
  const formDialogRef = useRef<HTMLDialogElement>(null);
  const previewDialogRef = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState<ShareLinkRow | null>(null);
  const [preview, setPreview] = useState<ShareLinkRow | null>(null);
  const [busy, start] = useTransition();

  const mediaById = new Map(media.map((m) => [m.id, m]));

  function openCreate() {
    setEditing(null);
    setSlug("");
    setTitleFr("");
    setTitleEn("");
    setMediaId(undefined);
    setAllowDownload(true);
    setEnabled(true);
    setErrors({});
    setShowForm(true);
  }

  function openEdit(link: ShareLinkRow) {
    setEditing(link);
    setSlug(link.slug);
    setTitleFr(link.title?.fr ?? "");
    setTitleEn(link.title?.en ?? "");
    setMediaId(link.mediaId);
    setAllowDownload(link.allowDownload);
    setEnabled(link.enabled);
    setErrors({});
    setShowForm(true);
  }

  function closeForm() {
    if (busy) return;
    setShowForm(false);
  }

  async function copyLink(linkSlug: string) {
    const url = `${window.location.origin}/fr/l/${linkSlug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(t("copied"));
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        toast(t("copied"));
      } catch {
        toast(t("copyFailed"), "error");
      }
      document.body.removeChild(ta);
    }
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadProgress(0);
    const res = await uploadChunked(file, (sent, total) => {
      setUploadProgress(total > 0 ? Math.round((sent / total) * 100) : 0);
    }, undefined, [], "file");
    setUploading(false);
    if (!res.ok) return toast(res.message, "error");
    setMediaId(res.media.id);
    toast(t("fileUploaded"));
    router.refresh();
  }

  function submit() {
    const payload = {
      slug,
      title: { fr: titleFr, en: titleEn },
      mediaId,
      allowDownload,
      enabled,
    };
    start(async () => {
      const r = editing
        ? await updateShareLinkAction(editing.id, payload)
        : await createShareLinkAction(payload);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast(r.message, "error");
        return;
      }
      setShowForm(false);
      toast(t("saved"));
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    start(async () => {
      const r = await deleteShareLinkAction(target.id);
      setDeleting(null);
      if (!r.ok) return toast(r.message, "error");
      toast(t("deleted"));
      router.refresh();
    });
  }

  function toggleRowEnabled(link: ShareLinkRow) {
    const next = !link.enabled;
    setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, enabled: next } : l)));
    start(async () => {
      const r = await setShareLinkEnabledAction(link.id, next);
      if (!r.ok) {
        setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, enabled: link.enabled } : l)));
        toast(r.message, "error");
        return;
      }
      toast(t("saved"));
      router.refresh();
    });
  }

  // Boîtes de dialogue modales (native <dialog>).
  useEffect(() => {
    const d = formDialogRef.current;
    if (!d) return;
    if (showForm && !d.open) d.showModal();
    if (!showForm && d.open) d.close();
  }, [showForm]);

  useEffect(() => {
    const d = previewDialogRef.current;
    if (!d) return;
    if (preview && !d.open) d.showModal();
    if (!preview && d.open) d.close();
  }, [preview]);

  useEffect(() => {
    if (!showForm) return;
    const id = window.setTimeout(() => slugInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [showForm]);

  const mediaByIdMap = mediaById;

  const typeLabel = (kind: AdminMediaRow["kind"] | undefined): string => {
    switch (kind) {
      case "image":
        return t("typeImage");
      case "video":
        return t("typeVideo");
      case "pdf":
        return t("typePdf");
      case "audio":
        return t("typeAudio");
      case "file":
        return t("typeFile");
      default:
        return kind ?? "";
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="a-links" data-testid="links-library">
      <div className="a-panel-actions">
        <button type="button" className="a-btn a-btn-primary" onClick={openCreate} data-testid="link-create">
          {t("create")}
        </button>
      </div>

      {links.length === 0 ? (
        <p className="muted" data-testid="links-empty">{t("empty")}</p>
      ) : (
        <ul className="a-links-list" data-testid="links-list">
          {links.map((link) => {
            const m = mediaByIdMap.get(link.mediaId);
            const url = `/fr/l/${link.slug}`;
            return (
              <li key={link.id} className="a-card a-link-row" data-testid="link-row" data-slug={link.slug}>
                <div className="a-link-main">
                  <span className="a-link-name">{link.slug}</span>
                  <span className="a-link-title">{link.title?.fr || link.title?.en || m?.name || link.slug}</span>
                  <span className="a-badge">{typeLabel(m?.kind)}</span>
                  <span className="muted mono a-link-url">{url}</span>
                </div>
                <div className="a-link-actions">
                  <button
                    type="button"
                    className="a-switch"
                    role="switch"
                    aria-checked={link.enabled}
                    data-testid="link-enabled-switch"
                    onClick={() => toggleRowEnabled(link)}
                    disabled={busy}
                  >
                    <span className="a-switch-track" aria-hidden="true"><span /></span>
                    {link.enabled ? t("active") : t("inactive")}
                  </button>
                  <button type="button" className="a-btn a-btn-small" onClick={() => setPreview(link)} data-testid="link-preview">
                    {t("preview")}
                  </button>
                  <button type="button" className="a-btn a-btn-small" onClick={() => copyLink(link.slug)} data-testid="link-copy">
                    {t("copy")}
                  </button>
                  <a className="a-btn a-btn-small" href={`${origin}${url}`} target="_blank" rel="noopener" data-testid="link-open">
                    {t("open")}
                  </a>
                  <button type="button" className="a-btn a-btn-small" onClick={() => openEdit(link)} data-testid="link-edit">
                    {t("edit")}
                  </button>
                  <button type="button" className="a-btn a-btn-small a-btn-quiet a-danger-text" onClick={() => setDeleting(link)} data-testid="link-delete">
                    {t("delete")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <dialog
        ref={formDialogRef}
        className="a-dialog"
        data-testid="link-form"
        aria-labelledby="link-form-title"
        onCancel={(e) => {
          e.preventDefault();
          closeForm();
        }}
      >
        {showForm && (
          <>
            <h2 id="link-form-title">{editing ? t("editTitle") : t("createTitle")}</h2>
            <div className="a-dialog-body">
              <label className="a-field">
                <span className="a-field-label">{t("slug")}</span>
                <input
                  ref={slugInputRef}
                  className="a-input"
                  value={slug}
                  onChange={(e) => setSlug(normalizeShareSlug(e.target.value))}
                  data-testid="link-slug"
                />
                {origin && <p className="muted mono">{`${origin}/l/${slug}`}</p>}
                {errors.slug && <p className="a-field-error">{errors.slug}</p>}
              </label>
              <label className="a-field">
                <span className="a-field-label">{t("titleFr")}</span>
                <input
                  className="a-input"
                  value={titleFr}
                  onChange={(e) => setTitleFr(e.target.value)}
                  onBlur={() => {
                    if (slug === "") setSlug(normalizeShareSlug(titleFr));
                  }}
                  data-testid="link-title-fr"
                />
              </label>
              <label className="a-field">
                <span className="a-field-label">{t("titleEn")}</span>
                <input className="a-input" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} data-testid="link-title-en" />
              </label>
              <div className="a-field">
                <span className="a-field-label">{t("media")}</span>
                <div className="a-media-field">
                  <span className="a-media-field-name">{(mediaId !== undefined ? mediaByIdMap.get(mediaId) : undefined)?.name ?? t("noMedia")}</span>
                  <button type="button" className="a-btn a-btn-small" onClick={() => setMediaOpen(true)} data-testid="link-pick-media">
                    {t("chooseMedia")}
                  </button>
                  <button type="button" className="a-btn a-btn-small" onClick={() => fileInputRef.current?.click()} disabled={uploading} data-testid="link-upload-file">
                    {t("uploadFile")}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadFile(f);
                      e.target.value = "";
                    }}
                  />
                </div>
                {uploading && <p className="muted">{uploadProgress}%</p>}
                {errors.mediaId && <p className="a-field-error">{errors.mediaId}</p>}
              </div>
              {(() => {
                const sel = mediaId !== undefined ? mediaByIdMap.get(mediaId) : undefined;
                const isFileMedia = sel?.kind === "file";
                return (
                  <>
                    {!isFileMedia && (
                      <label className="a-toggle">
                        <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} data-testid="link-allow-download" />
                        <span className="a-toggle-track" aria-hidden="true" />
                        <span>{t("allowDownload")}</span>
                      </label>
                    )}
                    {isFileMedia && <p className="muted">{t("fileAlwaysDownload")}</p>}
                  </>
                );
              })()}
              <button
                type="button"
                className="a-switch"
                role="switch"
                aria-checked={enabled}
                data-testid="link-enabled-switch"
                onClick={() => setEnabled((v) => !v)}
              >
                <span className="a-switch-track" aria-hidden="true"><span /></span>
                {enabled ? t("active") : t("inactive")}
              </button>
            </div>
            <div className="a-dialog-actions">
              <button type="button" className="a-btn a-btn-primary" onClick={submit} disabled={busy} data-testid="link-save">
                {t("save")}
              </button>
              <button type="button" className="a-btn a-btn-quiet" onClick={closeForm} disabled={busy} data-testid="link-cancel">
                {t("cancel")}
              </button>
            </div>
          </>
        )}
      </dialog>

      <dialog
        ref={previewDialogRef}
        className="a-dialog"
        data-testid="link-preview-dialog"
        aria-labelledby="link-preview-title"
        onCancel={(e) => {
          e.preventDefault();
          setPreview(null);
        }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) setPreview(null);
        }}
      >
        {preview && (
          <>
            <h2 id="link-preview-title">{mediaByIdMap.get(preview.mediaId)?.name ?? preview.slug}</h2>
            <div className="a-dialog-body">
              {(() => {
                const m = mediaByIdMap.get(preview.mediaId);
                if (!m) return null;
                if (m.kind === "image") {
                  const src = m.preview ?? m.thumb ?? "";
                  return src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={m.name} style={{ maxWidth: "100%", height: "auto" }} />
                  ) : null;
                }
                if (m.kind === "video") {
                  return m.videoSrc ? (
                    <video src={m.videoSrc} poster={m.preview ?? m.thumb ?? undefined} controls preload="none" playsInline style={{ maxWidth: "100%" }} />
                  ) : null;
                }
                if (m.kind === "pdf") {
                  const src = m.preview ?? m.thumb ?? "";
                  return src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={m.name} style={{ maxWidth: "100%", height: "auto" }} />
                  ) : null;
                }
                if (m.kind === "audio") {
                  return <audio controls preload="none" src={`/media/${m.key}`} style={{ width: "100%" }} />;
                }
                if (m.kind === "file") {
                  return (
                    <>
                      <p>{m.name}</p>
                      <p className="muted">{formatSize(m.size)}</p>
                    </>
                  );
                }
                return null;
              })()}
              <a className="a-btn a-btn-small" href={`${origin}/fr/l/${preview.slug}`} target="_blank" rel="noopener">
                {t("openPublicPage")}
              </a>
            </div>
            <div className="a-dialog-actions">
              <button type="button" className="a-btn" onClick={() => setPreview(null)}>
                {t("cancel")}
              </button>
            </div>
          </>
        )}
      </dialog>

      <MediaPickerDialog
        open={mediaOpen}
        media={media.filter((m) => m.status === "ready" && (m.kind === "image" || m.kind === "video" || m.kind === "pdf" || m.kind === "file" || m.kind === "audio"))}
        title={t("chooseMedia")}
        onClose={() => setMediaOpen(false)}
        onPick={(m) => {
          setMediaId(m.id);
          setMediaOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? t("deleteTitle", { slug: deleting.slug }) : ""}
        confirmLabel={t("delete")}
        danger
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
      >
        <p>{t("deleteBody")}</p>
      </ConfirmDialog>
    </div>
  );
}