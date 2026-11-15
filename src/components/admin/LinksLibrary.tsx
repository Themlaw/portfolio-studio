"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { createShareLinkAction, deleteShareLinkAction, updateShareLinkAction } from "@/app/admin/(espace)/liens/actions";
import type { AdminMediaRow } from "@/lib/admin";
import type { ShareLinkRow } from "@/lib/edit/share-links";
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
  const [deleting, setDeleting] = useState<ShareLinkRow | null>(null);
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

  useEffect(() => {
    // keep list in sync after refresh handled by parent re-render
  }, []);

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
            const m = mediaById.get(link.mediaId);
            const url = `/fr/l/${link.slug}`;
            const fullUrl = `${typeof window !== "undefined" ? window.location.origin : ""}${url}`;
            return (
              <li key={link.id} className="a-card a-link-row" data-testid="link-row" data-slug={link.slug}>
                <div className="a-link-main">
                  {m?.thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.thumb} alt="" className="a-link-thumb" />
                  )}
                  <div>
                    <strong>{link.title?.fr || link.title?.en || m?.name || link.slug}</strong>
                    <div className="muted mono">{url}</div>
                    <div className="muted">{m?.kind ?? ""} · {link.enabled ? t("active") : t("inactive")}</div>
                  </div>
                </div>
                <div className="a-link-actions">
                  <button type="button" className="a-btn a-btn-small" onClick={() => copyLink(link.slug)} data-testid="link-copy">
                    {t("copy")}
                  </button>
                  <a className="a-btn a-btn-small" href={fullUrl} target="_blank" rel="noopener" data-testid="link-open">
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

      {showForm && (
        <div className="a-modal" role="dialog" aria-modal="true" data-testid="link-form">
          <div className="a-modal-card">
            <h2>{editing ? t("editTitle") : t("createTitle")}</h2>
            <label className="a-field">
              <span className="a-field-label">{t("slug")}</span>
              <input className="a-input" value={slug} onChange={(e) => setSlug(e.target.value)} data-testid="link-slug" />
              {errors.slug && <p className="a-field-error">{errors.slug}</p>}
            </label>
            <label className="a-field">
              <span className="a-field-label">{t("titleFr")}</span>
              <input className="a-input" value={titleFr} onChange={(e) => setTitleFr(e.target.value)} data-testid="link-title-fr" />
            </label>
            <label className="a-field">
              <span className="a-field-label">{t("titleEn")}</span>
              <input className="a-input" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} data-testid="link-title-en" />
            </label>
            <div className="a-field">
              <span className="a-field-label">{t("media")}</span>
              <div className="a-media-field">
                <span className="a-media-field-name">{(mediaId !== undefined ? mediaById.get(mediaId) : undefined)?.name ?? t("noMedia")}</span>
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
              const sel = mediaId !== undefined ? mediaById.get(mediaId) : undefined;
              const isFileMedia = sel?.kind === "file";
              return (
                <>
                  {!isFileMedia && (
                    <label className="a-toggle">
                      <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} data-testid="link-allow-download" />
                      <span>{t("allowDownload")}</span>
                    </label>
                  )}
                  {isFileMedia && <p className="muted">{t("fileAlwaysDownload")}</p>}
                </>
              );
            })()}
            <label className="a-toggle">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="link-enabled" />
              <span>{t("enabled")}</span>
            </label>
            <div className="a-modal-actions">
              <button type="button" className="a-btn a-btn-primary" onClick={submit} disabled={busy} data-testid="link-save">
                {t("save")}
              </button>
              <button type="button" className="a-btn a-btn-quiet" onClick={() => setShowForm(false)} data-testid="link-cancel">
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <MediaPickerDialog
        open={mediaOpen}
        media={media.filter((m) => m.status === "ready" && (m.kind === "image" || m.kind === "video" || m.kind === "pdf" || m.kind === "file"))}
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