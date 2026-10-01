"use client";

/**
 * Médiathèque : grille de vignettes, filtres, recherche, zone d'envoi, et
 * panneau de détail (aperçu, informations, texte alternatif, « Utilisé
 * dans… », suppression). MediaPickerDialog en reprend la grille pour choisir
 * une image (planche, champs de blocs).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState, useTransition } from "react";

import { TextI18n } from "@/app/admin/_fields";
import { deleteMediaAction, mediaUsesAction, saveMediaAltAction } from "@/app/admin/(espace)/medias/actions";
import type { AdminMediaRow, MediaUseRow } from "@/lib/admin";

import { ConfirmDialog, same, toast, useUnsavedGuard } from "./editing";
import { ACCEPT, formatBytes, hasFiles, useMediaWatch, useUploadQueue, type UploadItem } from "./uploads";

type Filter = "all" | "unused" | "noalt";

export const STATUS_LABEL: Record<AdminMediaRow["status"], string> = {
  processing: "En traitement",
  ready: "Prête",
  failed: "Échec",
};

/* ---- Zone d'envoi -------------------------------------------------------- */

export function UploadZone({ onFiles, compact = false }: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const [over, setOver] = useState(false);
  const id = useId();
  return (
    <div
      className="a-dropzone"
      data-over={over || undefined}
      data-compact={compact || undefined}
      onDragOver={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      }}
    >
      <p>
        <strong>Dépose tes images ici</strong> <span className="muted">ou</span>{" "}
        <label htmlFor={id} className="a-btn a-btn-small a-file-btn">
          Choisir des fichiers
        </label>
      </p>
      {!compact && <p className="a-help">JPEG, PNG, WebP, AVIF ou GIF, 40 Mo au plus par image. Les métadonnées (lieu, appareil) sont retirées.</p>}
      <input
        id={id}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

/** Progression des envois (liste discrète). */
export function UploadList({ items, onDismiss }: { items: UploadItem[]; onDismiss: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="a-uploads" aria-live="polite">
      {items.map((i) => (
        <li key={i.key} data-phase={i.phase}>
          <span className="a-upload-name">{i.name}</span>
          <span className="a-upload-state">
            {i.phase === "waiting" && "En attente"}
            {i.phase === "uploading" && `Envoi ${Math.round(i.progress * 100)} %`}
            {i.phase === "processing" && "Traitement…"}
            {i.phase === "ready" && "✓ Prête"}
            {i.phase === "failed" && <span className="a-danger-text">{i.message}</span>}
          </span>
          {(i.phase === "ready" || i.phase === "failed") && (
            <button type="button" className="a-icon-btn" aria-label={`Retirer ${i.name} de la liste`} onClick={() => onDismiss(i.key)}>
              ✕
            </button>
          )}
          {(i.phase === "uploading" || i.phase === "processing") && (
            <span className="a-progress" aria-hidden="true">
              <span style={{ width: i.phase === "processing" ? "100%" : `${Math.round(i.progress * 100)}%` }} data-indeterminate={i.phase === "processing" || undefined} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ---- Grille ---------------------------------------------------------------- */

export function MediaGrid({
  items,
  selectedId,
  onSelect,
  label,
}: {
  items: AdminMediaRow[];
  selectedId: number | null;
  onSelect: (m: AdminMediaRow) => void;
  label: string;
}) {
  return (
    <ul className="a-media-grid2" aria-label={label}>
      {items.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            className="a-media-tile"
            aria-pressed={selectedId === m.id}
            onClick={() => onSelect(m)}
            title={m.name}
          >
            <span className="a-media-thumb" style={m.color ? { backgroundColor: m.color } : undefined}>
              {m.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.thumb} alt="" loading="lazy" />
              ) : (
                <span className="a-media-state">{STATUS_LABEL[m.status]}</span>
              )}
              {m.status === "ready" && !m.alt.fr.trim() && (
                <span className="a-alt-badge" title="Texte alternatif manquant">
                  alt<span className="sr-only"> manquant</span>
                </span>
              )}
            </span>
            <span className="a-media-name">{m.name}</span>
            <span className="a-media-meta">
              {m.status !== "ready" ? (
                <span className={m.status === "failed" ? "a-danger-text" : ""}>{STATUS_LABEL[m.status]}</span>
              ) : (
                <span>{m.uses === 0 ? "Non utilisée" : `Utilisée ${m.uses} fois`}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function useFiltered(media: AdminMediaRow[]) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return media.filter(
      (m) =>
        (filter === "all" || (filter === "unused" && m.uses === 0) || (filter === "noalt" && !m.alt.fr.trim())) &&
        (!q || m.name.toLowerCase().includes(q)),
    );
  }, [media, filter, query]);
  const controls = (
    <div className="a-media-tools">
      <div className="a-seg" role="group" aria-label="Filtrer">
        {(
          [
            ["all", "Toutes les images"],
            ["unused", "Non utilisées"],
            ["noalt", "Sans texte alternatif"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      <label className="a-search">
        <span className="sr-only">Rechercher par nom</span>
        <input className="a-input" type="search" placeholder="Rechercher par nom…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
    </div>
  );
  return { list, controls };
}

/** Liste locale synchronisée avec la liste serveur, plus les mises à jour du suivi. */
function useMediaState(initial: AdminMediaRow[]) {
  const [media, setMedia] = useState(initial);
  const [initialKey, setInitialKey] = useState(initial);
  if (initial !== initialKey) {
    setInitialKey(initial);
    setMedia(initial);
  }
  const merge = useCallback((rows: AdminMediaRow[]) => {
    setMedia((list) => {
      const byId = new Map(rows.map((r) => [r.id, r]));
      const known = new Set(list.map((m) => m.id));
      return [...rows.filter((r) => !known.has(r.id)), ...list.map((m) => byId.get(m.id) ?? m)];
    });
  }, []);
  return { media, merge };
}

/* ---- Détail ---------------------------------------------------------------- */

function MediaDetail({ media, onClose, onDeleted }: { media: AdminMediaRow; onClose: () => void; onDeleted: () => void }) {
  const router = useRouter();
  const [alt, setAlt] = useState(media.alt);
  const [savedAlt, setSavedAlt] = useState(media.alt);
  const [uses, setUses] = useState<MediaUseRow[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [blocked, setBlocked] = useState<{ message: string; refs: { pageId: number; pageTitle: string; blockType: string }[] } | null>(null);
  const [busy, start] = useTransition();
  const dirty = !same(alt, savedAlt);
  useUnsavedGuard(dirty);

  useEffect(() => {
    let live = true;
    void mediaUsesAction(media.id).then((r) => live && r.ok && setUses(r.data));
    return () => {
      live = false;
    };
  }, [media.id]);

  const slotUses = uses?.filter((u) => u.kind === "slot") ?? [];
  const blockUses = uses?.filter((u) => u.kind === "block") ?? [];

  return (
    <aside className="a-sidepanel" aria-labelledby="md-title">
      <div className="a-sidepanel-head">
        <h2 id="md-title">{media.name}</h2>
        <button type="button" className="a-icon-btn" aria-label="Fermer le détail" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="a-media-preview" style={media.color ? { backgroundColor: media.color } : undefined}>
        {media.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.preview} alt="" />
        ) : (
          <span className="a-media-state">{STATUS_LABEL[media.status]}</span>
        )}
      </div>
      {media.status === "failed" && <p className="a-alert">{media.error}</p>}
      <dl className="a-facts">
        <dt>Dimensions</dt>
        <dd>{media.width && media.height ? `${media.width} × ${media.height} px` : "—"}</dd>
        <dt>Poids</dt>
        <dd>{formatBytes(media.size)}</dd>
        <dt>Ajoutée le</dt>
        <dd>{new Date(media.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</dd>
        <dt>État</dt>
        <dd>{STATUS_LABEL[media.status]}</dd>
      </dl>

      <TextI18n
        label="Texte alternatif"
        help="Décris l'image pour les personnes qui ne la voient pas (lecteurs d'écran, moteurs de recherche)."
        value={alt}
        onChange={setAlt}
      />
      {!alt.fr.trim() && <p className="a-notice">Sans texte alternatif, le titre de l&apos;œuvre est lu à la place.</p>}
      <div className="a-panel-actions">
        <span className="a-save-state" aria-live="polite">
          {dirty ? (
            <>
              <span className="a-dot" aria-hidden="true" /> Non enregistré
            </>
          ) : (
            <>
              <span aria-hidden="true">✓</span> Enregistré
            </>
          )}
        </span>
        <button
          type="button"
          className="a-btn a-btn-primary"
          disabled={!dirty || busy}
          onClick={() =>
            start(async () => {
              const r = await saveMediaAltAction(media.id, alt);
              if (!r.ok) return toast(r.message, "error");
              setSavedAlt(alt);
              toast("Texte alternatif enregistré");
              setTimeout(() => router.refresh(), 0);
            })
          }
        >
          Enregistrer
        </button>
      </div>

      <h3 className="a-subhead">Utilisée dans…</h3>
      {uses === null ? (
        <p className="muted">Recherche…</p>
      ) : uses.length === 0 ? (
        <p className="muted">Nulle part pour l&apos;instant.</p>
      ) : (
        <ul className="a-refs">
          {uses.map((u, i) =>
            u.kind === "slot" ? (
              <li key={i}>
                Planche <Link href={`/admin/projets/${u.projectId}`}>{u.projectTitle}</Link> · {u.slotTitle}
              </li>
            ) : (
              <li key={i}>
                Bloc « {u.blockType} » de la page <Link href={`/admin/pages/${u.pageId}`}>{u.pageTitle}</Link>
              </li>
            ),
          )}
        </ul>
      )}

      <div className="a-panel-danger">
        <button type="button" className="a-btn a-btn-quiet a-danger-text" disabled={media.status === "processing"} onClick={() => setConfirm(true)}>
          Supprimer l&apos;image
        </button>
      </div>

      <ConfirmDialog
        open={confirm}
        title={`Supprimer l'image « ${media.name} » ?`}
        confirmLabel="Supprimer"
        danger
        busy={busy}
        confirmDisabled={uses === null}
        onClose={() => {
          setConfirm(false);
          setBlocked(null);
        }}
        onConfirm={() =>
          start(async () => {
            const r = await deleteMediaAction(media.id);
            if (!r.ok) {
              setBlocked({ message: r.message, refs: "references" in r ? r.references : [] });
              return;
            }
            setConfirm(false);
            toast(r.data.emptiedSlots ? `Image supprimée · ${r.data.emptiedSlots} emplacement${r.data.emptiedSlots > 1 ? "s" : ""} vidé${r.data.emptiedSlots > 1 ? "s" : ""}` : "Image supprimée");
            onDeleted();
            setTimeout(() => router.refresh(), 0);
          })
        }
      >
        {uses === null ? (
          <p className="muted">Vérification de son utilisation…</p>
        ) : blockUses.length > 0 ? (
          <p className="muted">Elle est utilisée par des blocs : la suppression sera refusée tant qu&apos;ils la montrent.</p>
        ) : slotUses.length > 0 ? (
          <p>
            Les {slotUses.length} emplacement{slotUses.length > 1 ? "s" : ""} qui la montrent gardent leur place, vide{slotUses.length > 1 ? "s" : ""}.
          </p>
        ) : (
          <p className="muted">Elle n&apos;est utilisée nulle part. Le fichier et ses variantes seront effacés.</p>
        )}
        {blocked && (
          <div className="a-alert" role="alert">
            <p>{blocked.message}</p>
            <ul className="a-refs">
              {blocked.refs.map((r, i) => (
                <li key={i}>
                  Bloc « {r.blockType} » de la page <Link href={`/admin/pages/${r.pageId}`}>{r.pageTitle}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ConfirmDialog>
    </aside>
  );
}

/* ---- Écran ------------------------------------------------------------------- */

export default function MediaLibrary({ initial, usage }: { initial: AdminMediaRow[]; usage: { used: string; quota: string | null; ratio: number | null } }) {
  const router = useRouter();
  const { media, merge } = useMediaState(initial);
  const [selected, setSelected] = useState<number | null>(null);
  const { list, controls } = useFiltered(media);
  const uploads = useUploadQueue(async () => {
    setTimeout(() => router.refresh(), 0);
  });
  const processing = media.filter((m) => m.status === "processing").map((m) => m.id);
  const watched = [...processing, ...uploads.items.filter((i) => i.phase === "processing" && i.mediaId).map((i) => i.mediaId!)];
  useMediaWatch(watched, (rows) => {
    merge(rows);
    for (const row of rows) {
      for (const item of uploads.items.filter((i) => i.mediaId === row.id && i.phase === "processing")) {
        if (row.status !== "processing") uploads.patch(item.key, { phase: row.status === "ready" ? "ready" : "failed", message: row.error ?? undefined });
      }
    }
  });
  const current = media.find((m) => m.id === selected) ?? null;

  return (
    <div className="a-library" data-detail={current ? "open" : undefined}>
      <div className="a-library-main">
        <div className="a-usage">
          <span>
            Espace utilisé : <strong>{usage.used}</strong>
            {usage.quota && ` sur ${usage.quota}`}
          </span>
          {usage.ratio !== null && (
            <span className="a-progress" role="img" aria-label={`${Math.round(usage.ratio * 100)} % de l'espace utilisé`}>
              <span style={{ width: `${Math.min(100, Math.round(usage.ratio * 100))}%` }} />
            </span>
          )}
        </div>
        <UploadZone onFiles={(files) => void uploads.add(files)} />
        <UploadList items={uploads.items} onDismiss={uploads.remove} />
        {controls}
        {list.length === 0 ? (
          <p className="muted a-section-tight">Aucune image ne correspond.</p>
        ) : (
          <MediaGrid items={list} selectedId={selected} onSelect={(m) => setSelected(m.id)} label="Images de la médiathèque" />
        )}
      </div>
      {current && <MediaDetail key={current.id} media={current} onClose={() => setSelected(null)} onDeleted={() => setSelected(null)} />}
    </div>
  );
}

/* ---- Choisir une image ------------------------------------------------------ */

export function MediaPickerDialog({
  open,
  media: initial,
  title = "Choisir une image",
  onPick,
  onClose,
}: {
  open: boolean;
  media: AdminMediaRow[];
  title?: string;
  onPick: (m: AdminMediaRow) => void;
  onClose: () => void;
}) {
  const { media, merge } = useMediaState(initial);
  const [choice, setChoice] = useState<number | null>(null);
  const { list, controls } = useFiltered(media.filter((m) => m.status !== "failed"));
  const uploads = useUploadQueue(async (_item, mediaId) => {
    const r = await (await import("@/app/admin/(espace)/medias/actions")).mediaStatusAction([mediaId]);
    if (r.ok) merge(r.data);
    setChoice(mediaId);
  });
  useMediaWatch(media.filter((m) => m.status === "processing").map((m) => m.id), merge);
  const picked = media.find((m) => m.id === choice);
  return (
    <ConfirmDialog
      open={open}
      title={title}
      confirmLabel="Utiliser cette image"
      onClose={onClose}
      onConfirm={() => picked && onPick(picked)}
      confirmDisabled={!picked}
    >
      <UploadZone compact onFiles={(files) => void uploads.add(files.slice(0, 1))} />
      <UploadList items={uploads.items} onDismiss={uploads.remove} />
      {controls}
      <div className="a-picker-scroll">
        <MediaGrid items={list} selectedId={choice} onSelect={(m) => setChoice(m.id)} label="Images" />
      </div>
      {picked?.status === "processing" && <p className="a-help">Cette image est en traitement : elle s&apos;affichera sur le site dès qu&apos;elle sera prête.</p>}
    </ConfirmDialog>
  );
}
