"use client";

/**
 * Médiathèque : envoi (Uploader), grille de vignettes, filtres (type, usage,
 * tags combinés en ET, recherche), sélection multiple (ajouter / retirer des
 * tags), panneau de détail (aperçu, informations, tags, texte alternatif,
 * « Utilisé dans… », suppression) et gestion des tags (renommer, fusionner,
 * supprimer). MediaPickerDialog en reprend la grille pour choisir un média
 * (planche, champs de blocs).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { TextI18n } from "@/app/admin/_fields";
import TagInput from "@/app/admin/_fields/TagInput";
import {
  addMediaTagsAction,
  deleteMediaAction,
  deleteTagAction,
  deleteUnusedTagsAction,
  mediaStatusAction,
  mediaUsesAction,
  mergeTagsAction,
  pendingUploadsAction,
  removeMediaTagsAction,
  renameTagAction,
  restoreMediaAction,
  retryMediaAction,
  saveMediaAltAction,
  setMediaTagsAction,
} from "@/app/admin/(espace)/medias/actions";
import { formatDuration, isLoop } from "@/lib/video/limits";
import type { AdminMediaRow, MediaUseRow, TrashSummary } from "@/lib/admin";
import { tagKey } from "@/lib/tag-key";
import { daysLeft, TRASH_DAYS } from "@/lib/trash";
import type { TagRow } from "@/lib/tags";

import AltMissing from "./AltMissing";
import { EmptyTrash, PurgeItem } from "./TrashControls";
import { ConfirmDialog, same, toast, undoToast, useUnsavedGuard } from "./editing";
import MediaPreviewDialog from "./editor/MediaPreviewDialog";
import { filterMedia } from "./LibraryStrip";
import Uploader from "./Uploader";
import { useUploadQueue } from "./UploadQueue";
import { formatBytes, formatSent, useMediaWatch } from "./uploads";

type Filter = "all" | "unused" | "noalt";
type KindFilter = "any" | "image" | "video" | "pdf";

export const STATUS_LABEL: Record<AdminMediaRow["status"], string> = {
  processing: "En traitement",
  ready: "Prête",
  failed: "Échec",
};

/** État lisible ; une vidéo en conversion affiche son avancement. */
export function stateLabel(m: AdminMediaRow): string {
  if (m.status === "processing" && m.kind === "video") return m.progress ? `Conversion… ${m.progress} %` : "Conversion en attente…";
  if (m.status === "processing" && m.kind === "pdf") return "Aperçu des pages…";
  return STATUS_LABEL[m.status];
}

/* ---- Grille ---------------------------------------------------------------- */

export function MediaGrid({
  items,
  selectedId,
  onSelect,
  label,
  checked,
  onZoom,
}: {
  items: AdminMediaRow[];
  selectedId: number | null;
  onSelect: (m: AdminMediaRow) => void;
  label: string;
  /** Sélection multiple : médias cochés (la vignette coche / décoche). */
  checked?: Set<number>;
  /** Petite loupe distincte du clic de choix : agrandit le média sans le choisir. */
  onZoom?: (m: AdminMediaRow) => void;
}) {
  return (
    <ul className="a-media-grid2" aria-label={label} data-selecting={checked ? true : undefined}>
      {items.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            className="a-media-tile"
            aria-pressed={checked ? checked.has(m.id) : selectedId === m.id}
            onClick={() => onSelect(m)}
            title={m.name}
          >
            {checked && (
              <span className="a-check" aria-hidden="true" data-on={checked.has(m.id) || undefined}>
                {checked.has(m.id) ? "✓" : ""}
              </span>
            )}
            <span className="a-media-thumb">
              {m.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.thumb} alt="" loading="lazy" />
              ) : (
                <span className="a-media-state">{stateLabel(m)}</span>
              )}
              {m.kind === "video" && m.status === "ready" && (
                <span className="a-duration-badge">
                  <span aria-hidden="true">▶ </span>
                  {formatDuration(m.duration)}
                  {isLoop(m) && <span> · boucle</span>}
                </span>
              )}
              {m.status === "processing" && m.progress !== null && m.kind === "video" && (
                <span className="a-progress a-thumb-progress" aria-hidden="true">
                  <span style={{ width: `${m.progress}%` }} />
                </span>
              )}
              {m.status === "ready" && !m.alt.fr.trim() && (
                <AltMissing className="a-alt-badge" />
              )}
            </span>
            <span className="a-media-name">{m.name}</span>
            <span className="a-media-meta">
              {m.status !== "ready" ? (
                <span className={m.status === "failed" ? "a-danger-text" : ""}>{stateLabel(m)}</span>
              ) : (
                <span>{m.uses === 0 ? "Non utilisée" : `Utilisée ${m.uses} fois`}</span>
              )}
            </span>
            {m.tags.length > 0 && (
              <span className="a-media-tags">
                {m.tags.slice(0, 3).map((t) => (
                  <span key={t.id} className="a-tagpill a-tagpill-static">
                    {t.label}
                  </span>
                ))}
                {m.tags.length > 3 && <span className="muted">+{m.tags.length - 3}</span>}
              </span>
            )}
          </button>
          {onZoom && m.status === "ready" && <ZoomButton onZoom={() => onZoom(m)} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * Petite loupe posée sur une vignette : agrandit le média sans le choisir. Un `span` à rôle de bouton (et non un `button`) : elle
 * ne s'ajoute pas aux listes de boutons du sélecteur (une vignette = un bouton qui choisit).
 */
export function ZoomButton({ onZoom }: { onZoom: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      className="a-media-zoom"
      aria-label="Agrandir l'image"
      title="Agrandir"
      data-testid="media-zoom"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onZoom();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onZoom();
        }
      }}
    >
      <ZoomIcon />
    </span>
  );
}

function ZoomIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="4.5" />
      <path d="m10 10 4 4" />
    </svg>
  );
}

function useFiltered(media: AdminMediaRow[], tagOptions: TagRow[]) {
  const [filter, setFilter] = useState<Filter>("all");
  const [kind, setKind] = useState<KindFilter>("any");
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const list = useMemo(
    () =>
      filterMedia(media, tags, query).filter(
        (m) => (kind === "any" || m.kind === kind) && (filter === "all" || (filter === "unused" && m.uses === 0) || (filter === "noalt" && !m.alt.fr.trim())),
      ),
    [media, filter, kind, query, tags],
  );
  const controls = (
    <div className="a-media-tools">
      <div className="a-seg" role="group" aria-label="Type de média">
        {(
          [
            ["any", "Tout"],
            ["image", "Images"],
            ["video", "Vidéos"],
            ["pdf", "PDF"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="a-seg" role="group" aria-label="Filtrer">
        {(
          [
            ["all", "Tous"],
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
        <span className="sr-only">Rechercher par nom ou tag</span>
        <input className="a-input" type="search" placeholder="Rechercher par nom ou tag…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="a-media-tagfilter">
        <TagInput label="Filtrer par tags (tous)" hideLabel mode="filter" value={tags} onChange={setTags} options={tagOptions.filter((t) => t.count > 0)} />
      </div>
    </div>
  );
  return { list, controls, filtered: Boolean(tags.length || query.trim() || kind !== "any" || filter !== "all") };
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
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const dirty = !same(alt, savedAlt);
  useUnsavedGuard(dirty);
  const { tags: tagOptions, refreshTags } = useUploadQueue();
  const [tags, setTags] = useState(media.tags.map((t) => t.label));
  const saveTags = (next: string[]) => {
    const before = tags;
    setTags(next);
    void setMediaTagsAction(media.id, next).then((r) => {
      if (!r.ok) {
        setTags(before);
        return toast(r.message, "error");
      }
      refreshTags();
      setTimeout(() => router.refresh(), 0);
    });
  };

  useEffect(() => {
    let live = true;
    void mediaUsesAction(media.id).then((r) => live && r.ok && setUses(r.data));
    return () => {
      live = false;
    };
  }, [media.id]);

  // Un média utilisé ne se supprime pas : bouton inactif, endroits listés (cliquables) juste au-dessus.
  const inUse = (uses?.length ?? media.uses) > 0;
  const noun = media.kind === "video" ? "la vidéo" : media.kind === "pdf" ? "le PDF" : "l'image";

  return (
    <aside className="a-sidepanel" aria-labelledby="md-title">
      <div className="a-sidepanel-head">
        <h2 id="md-title">{media.name}</h2>
        <button type="button" className="a-icon-btn" aria-label="Fermer le détail" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="a-media-preview" style={media.color ? { backgroundColor: media.color } : undefined}>
        {media.kind === "video" && media.videoSrc ? (
          <video src={media.videoSrc} poster={media.preview ?? undefined} controls preload="metadata" playsInline aria-label={`Lecture de ${media.name}`} />
        ) : media.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.preview} alt="" />
        ) : (
          <span className="a-media-state">{STATUS_LABEL[media.status]}</span>
        )}
      </div>
      {media.status === "failed" && (
        <div className="a-alert">
          <p>{media.error}</p>
          <button
            type="button"
            className="a-btn a-btn-small a-section-tight"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await retryMediaAction(media.id);
                if (!r.ok) return toast(r.message, "error");
                toast("Traitement relancé");
                setTimeout(() => router.refresh(), 0);
              })
            }
          >
            Réessayer
          </button>
        </div>
      )}
      <dl className="a-facts">
        <dt>Dimensions</dt>
        <dd>{media.width && media.height ? `${media.width} × ${media.height} px` : "—"}</dd>
        <dt>Poids</dt>
        <dd>{formatBytes(media.size)}</dd>
        <dt>Ajoutée le</dt>
        <dd>{new Date(media.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</dd>
        {media.kind === "video" && (
          <>
            <dt>Durée</dt>
            <dd>
              {formatDuration(media.duration) || "—"}
              {media.hasAudio === false && " · sans son"}
              {isLoop(media) && " · jouée en boucle dans les planches"}
            </dd>
          </>
        )}
        <dt>État</dt>
        <dd>{stateLabel(media)}</dd>
      </dl>

      <TagInput label="Tags" value={tags} onChange={saveTags} options={tagOptions} help="Enregistrés aussitôt. Entrée pour valider un tag." />

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
        <ul className="a-refs" data-testid="media-usages">
          {uses.map((u, i) =>
            u.kind === "slot" ? (
              <li key={i}>
                Planche <Link href={u.trashed ? "/admin/projets?vue=corbeille" : `/admin/projets/${u.projectId}`}>{u.projectTitle}</Link> · {u.slotTitle}
                {u.draftPage && <span className="muted"> (brouillon non publié de la page « {u.draftPage} »)</span>}
                {u.trashed && <span className="muted"> (projet à la corbeille)</span>}
              </li>
            ) : (
              <li key={i}>
                {u.logo ? "Logo du site, réglé depuis la page" : <>Rubrique « {u.blockType} » de la page</>} <Link href={u.trashed ? "/admin/pages?vue=corbeille" : `/admin/pages/${u.pageId}/editer`}>{u.pageTitle}</Link>
                {u.trashed && <span className="muted"> (page à la corbeille)</span>}
              </li>
            ),
          )}
        </ul>
      )}

      <div className="a-panel-danger">
        <button
          type="button"
          className="a-btn a-btn-quiet a-danger-text"
          disabled={media.status === "processing" || inUse}
          aria-describedby={inUse ? "md-use-note" : undefined}
          onClick={() => {
            setRefusal(null);
            setConfirm(true);
          }}
        >
          {media.kind === "video" ? "Supprimer la vidéo" : media.kind === "pdf" ? "Supprimer le PDF" : "Supprimer l'image"}
        </button>
        {inUse && (
          <p className="a-help" id="md-use-note">
            Utilisée à {uses?.length ?? media.uses} endroit{(uses?.length ?? media.uses) > 1 ? "s" : ""} : remplace-la ou retire-la de {(uses?.length ?? media.uses) > 1 ? "ces endroits" : "cet endroit"} avant de la supprimer.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        title={media.kind === "video" ? `Supprimer la vidéo « ${media.name} » ?` : media.kind === "pdf" ? `Supprimer le PDF « ${media.name} » ?` : `Supprimer l'image « ${media.name} » ?`}
        confirmLabel="Supprimer"
        danger
        busy={busy}
        confirmDisabled={uses === null || inUse}
        onClose={() => {
          setConfirm(false);
          setRefusal(null);
        }}
        onConfirm={() =>
          start(async () => {
            const r = await deleteMediaAction(media.id);
            if (!r.ok) {
              setRefusal(r.message);
              return;
            }
            setConfirm(false);
            undoToast(media.name, () =>
              void restoreMediaAction(media.id).then((res) => {
                if (!res.ok) return toast(res.message, "error");
                toast(`${noun === "la vidéo" ? "Vidéo restaurée" : noun === "le PDF" ? "PDF restauré" : "Image restaurée"}`);
                router.refresh();
              }),
            );
            onDeleted();
            setTimeout(() => router.refresh(), 0);
          })
        }
      >
        {uses === null ? (
          <p className="muted">Vérification de son utilisation…</p>
        ) : (
          <p className="muted">
            Elle n&apos;est utilisée nulle part. Elle reste {TRASH_DAYS} jours dans la corbeille de la médiathèque : tu peux la restaurer ou annuler juste après.
          </p>
        )}
        {refusal && <p className="a-alert" role="alert">{refusal}</p>}
      </ConfirmDialog>
    </aside>
  );
}

/** Détail d'un média à la corbeille : aperçu, délai avant la purge, « Restaurer ». */
function TrashedDetail({ media, onClose }: { media: AdminMediaRow; onClose: () => void }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const left = media.deletedAt ? daysLeft(media.deletedAt) : TRASH_DAYS;
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
      <p className="a-help">
        Dans la corbeille : effacée pour de bon dans {left} jour{left > 1 ? "s" : ""}. Restaurée, elle retrouve sa place dans la médiathèque.
      </p>
      <div className="a-panel-actions">
        <button
          type="button"
          className="a-btn a-btn-primary"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await restoreMediaAction(media.id);
              if (!r.ok) return toast(r.message, "error");
              toast(`« ${media.name} » restaurée`);
              onClose();
              setTimeout(() => router.refresh(), 0);
            })
          }
        >
          Restaurer
        </button>
      </div>
      <PurgeItem kind="media" id={media.id} name={media.name} lost="le fichier et toutes ses variantes sont effacés." />
    </aside>
  );
}

/* ---- Envois interrompus -------------------------------------------------- */

function PendingUploads({ onResume }: { onResume: (file: File, id: string) => void }) {
  const [list, setList] = useState<{ id: string; name: string; size: number; offset: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void pendingUploadsAction().then((r) => live && r.ok && setList(r.data));
    return () => {
      live = false;
    };
  }, []);
  if (!list.length) return null;
  return (
    <section className="a-pending" aria-labelledby="pending-title">
      <h2 id="pending-title" className="a-subhead">
        Envois interrompus
      </h2>
      {error && <p className="a-field-error">{error}</p>}
      <ul className="a-uploads">
        {list.map((u) => (
          <li key={u.id}>
            <span className="a-upload-name">{u.name}</span>
            <span className="a-upload-state">{formatSent(u.offset, u.size)} reçus</span>
            <label className="a-btn a-btn-small a-file-btn">
              Reprendre
              <input
                type="file"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (file.name !== u.name || file.size !== u.size) {
                    setError(`Choisis le fichier d'origine « ${u.name} » (${formatBytes(u.size)}).`);
                    return;
                  }
                  setError(null);
                  setList((l) => l.filter((x) => x.id !== u.id));
                  onResume(file, u.id);
                }}
              />
            </label>
            <button
              type="button"
              className="a-btn a-btn-small a-btn-quiet a-danger-text"
              onClick={async () => {
                await fetch(`/admin/api/upload/${u.id}`, { method: "DELETE" });
                setList((l) => l.filter((x) => x.id !== u.id));
                toast("Envoi annulé");
              }}
            >
              Annuler
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---- Sélection multiple : tags ------------------------------------------ */

function BulkBar({ selected, media, onClear, onDone }: { selected: Set<number>; media: AdminMediaRow[]; onClear: () => void; onDone: () => void }) {
  const { tags: options, refreshTags } = useUploadQueue();
  const [mode, setMode] = useState<"add" | "remove" | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const ids = [...selected];
  // Tags présents sur au moins un média sélectionné (ce qu'on peut retirer).
  const present = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const m of media) if (selected.has(m.id)) for (const t of m.tags) map.set(tagKey(t.label), { label: t.label, count: (map.get(tagKey(t.label))?.count ?? 0) + 1 });
    return [...map.values()];
  }, [media, selected]);
  const apply = () =>
    start(async () => {
      const r = mode === "add" ? await addMediaTagsAction(ids, labels) : await removeMediaTagsAction(ids, labels);
      if (!r.ok) return toast(r.message, "error");
      toast(`${labels.length} tag${labels.length > 1 ? "s" : ""} ${mode === "add" ? "ajouté" : "retiré"}${labels.length > 1 ? "s" : ""} · ${ids.length} média${ids.length > 1 ? "s" : ""}`);
      setLabels([]);
      setMode(null);
      refreshTags();
      onDone();
    });
  return (
    <div className="a-bulkbar" role="region" aria-label="Sélection">
      <span className="a-bulkbar-count" aria-live="polite">
        {ids.length} sélectionné{ids.length > 1 ? "s" : ""}
      </span>
      <button type="button" className="a-btn a-btn-small" aria-pressed={mode === "add"} disabled={!ids.length} onClick={() => (setMode(mode === "add" ? null : "add"), setLabels([]))}>
        Ajouter des tags
      </button>
      <button type="button" className="a-btn a-btn-small" aria-pressed={mode === "remove"} disabled={!present.length} onClick={() => (setMode(mode === "remove" ? null : "remove"), setLabels([]))}>
        Retirer des tags
      </button>
      <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={onClear}>
        Terminer la sélection
      </button>
      {mode && (
        <div className="a-bulkbar-form">
          <TagInput
            label={mode === "add" ? "Tags à ajouter" : "Tags à retirer"}
            mode={mode === "add" ? "edit" : "filter"}
            value={labels}
            onChange={setLabels}
            options={mode === "add" ? options : present}
          />
          <button type="button" className="a-btn a-btn-primary" disabled={!labels.length || busy} onClick={apply}>
            {mode === "add" ? `Ajouter à ${ids.length} média${ids.length > 1 ? "s" : ""}` : `Retirer de ${ids.length} média${ids.length > 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- Gestion des tags ------------------------------------------------------ */

function TagManager({ onChanged }: { onChanged: () => void }) {
  const { tags, refreshTags } = useUploadQueue();
  const [editing, setEditing] = useState<{ id: number; label: string } | null>(null);
  const [merging, setMerging] = useState<{ id: number; into: number | null } | null>(null);
  const [deleting, setDeleting] = useState<TagRow | null>(null);
  const [purging, setPurging] = useState(false);
  const [busy, start] = useTransition();
  const unused = tags.filter((t) => t.count === 0).length;
  const after = (message: string) => {
    toast(message);
    refreshTags();
    onChanged();
  };
  if (!tags.length) return <p className="muted a-section-tight">Aucun tag pour l&apos;instant : ajoute-en à l&apos;envoi ou dans le détail d&apos;un média.</p>;
  return (
    <>
      {unused > 0 && (
        <p className="a-tags-purge">
          <button type="button" className="a-btn a-btn-small" onClick={() => setPurging(true)}>
            Supprimer les tags inutilisés ({unused})
          </button>
          <span className="a-help">Ils ne sont posés sur aucun média et ne comptent pas dans la limite de 500.</span>
        </p>
      )}
      <table className="a-table a-tags-table">
        <caption className="sr-only">Tags de la bibliothèque</caption>
        <thead>
          <tr>
            <th scope="col">Tag</th>
            <th scope="col">Médias</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {[...tags].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "fr")).map((t) => (
            <tr key={t.id}>
              <th scope="row">
                {editing?.id === t.id ? (
                  <form
                    className="a-inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      start(async () => {
                        const r = await renameTagAction(t.id, editing.label);
                        if (!r.ok) return toast(r.message, "error");
                        setEditing(null);
                        after(`Tag renommé en « ${editing.label.trim()} »`);
                      });
                    }}
                  >
                    <label className="sr-only" htmlFor={`rename-${t.id}`}>
                      Nouveau nom de « {t.label} »
                    </label>
                    <input id={`rename-${t.id}`} className="a-input" value={editing.label} maxLength={40} autoFocus onChange={(e) => setEditing({ id: t.id, label: e.target.value })} />
                    <button type="submit" className="a-btn a-btn-small a-btn-primary" disabled={busy}>
                      Enregistrer
                    </button>
                    <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => setEditing(null)}>
                      Annuler
                    </button>
                  </form>
                ) : (
                  <span className="a-tagpill a-tagpill-static">{t.label}</span>
                )}
              </th>
              <td>{t.count}</td>
              <td className="a-tags-actions">
                {merging?.id === t.id ? (
                  <span className="a-inline-form">
                    <label className="sr-only" htmlFor={`merge-${t.id}`}>
                      Fusionner « {t.label} » dans
                    </label>
                    <select id={`merge-${t.id}`} className="a-input" value={merging.into ?? ""} onChange={(e) => setMerging({ id: t.id, into: Number(e.target.value) || null })}>
                      <option value="">Fusionner dans…</option>
                      {tags
                        .filter((o) => o.id !== t.id)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="a-btn a-btn-small a-btn-primary"
                      disabled={!merging.into || busy}
                      onClick={() =>
                        start(async () => {
                          const into = tags.find((o) => o.id === merging.into);
                          const r = await mergeTagsAction(t.id, merging.into);
                          if (!r.ok) return toast(r.message, "error");
                          setMerging(null);
                          after(`« ${t.label} » fusionné dans « ${into?.label} »`);
                        })
                      }
                    >
                      Fusionner
                    </button>
                    <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => setMerging(null)}>
                      Annuler
                    </button>
                  </span>
                ) : (
                  <>
                    <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => setEditing({ id: t.id, label: t.label })} aria-label={`Renommer ${t.label}`}>
                      Renommer
                    </button>
                    <button type="button" className="a-btn a-btn-small a-btn-quiet" disabled={tags.length < 2} onClick={() => setMerging({ id: t.id, into: null })} aria-label={`Fusionner ${t.label}`}>
                      Fusionner
                    </button>
                    <button type="button" className="a-btn a-btn-small a-btn-quiet a-danger-text" onClick={() => setDeleting(t)} aria-label={`Supprimer ${t.label}`}>
                      Supprimer
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={purging}
        title={`Supprimer ${unused} tag${unused > 1 ? "s" : ""} inutilisé${unused > 1 ? "s" : ""} ?`}
        confirmLabel="Supprimer"
        danger
        busy={busy}
        onClose={() => setPurging(false)}
        onConfirm={() =>
          start(async () => {
            const r = await deleteUnusedTagsAction();
            if (!r.ok) return toast(r.message, "error");
            setPurging(false);
            after(`${r.data.deleted} tag${r.data.deleted > 1 ? "s" : ""} inutilisé${r.data.deleted > 1 ? "s" : ""} supprimé${r.data.deleted > 1 ? "s" : ""}`);
          })
        }
      >
        <p className="muted">Aucun média n&apos;est touché.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={deleting !== null}
        title={`Supprimer le tag « ${deleting?.label ?? ""} » ?`}
        confirmLabel="Supprimer le tag"
        danger
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          start(async () => {
            if (!deleting) return;
            const r = await deleteTagAction(deleting.id);
            if (!r.ok) return toast(r.message, "error");
            const label = deleting.label;
            setDeleting(null);
            after(`Tag « ${label} » supprimé`);
          })
        }
      >
        <p>
          {deleting?.count
            ? `Il sera retiré de ${deleting.count} média${deleting.count > 1 ? "s" : ""}. Les médias eux-mêmes ne sont pas touchés.`
            : "Il n'est posé sur aucun média."}
        </p>
      </ConfirmDialog>
    </>
  );
}

/* ---- Écran ------------------------------------------------------------------- */

export default function MediaLibrary({ initial, trashed, summary, usage }: { initial: AdminMediaRow[]; trashed: AdminMediaRow[]; summary: TrashSummary; usage: { used: string; quota: string | null; ratio: number | null } }) {
  const router = useRouter();
  const queue = useUploadQueue();
  const { media, merge } = useMediaState(initial);
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<"media" | "tags" | "trash">("media");
  const [checked, setChecked] = useState<Set<number> | null>(null);
  const { list, controls } = useFiltered(media, queue.tags);
  const refresh = useCallback(() => setTimeout(() => router.refresh(), 0), [router]);
  useEffect(() => queue.onMediaCreated(() => refresh()), [queue, refresh]);
  const processing = media.filter((m) => m.status === "processing").map((m) => m.id);
  useMediaWatch(processing, merge);
  const current = (tab === "trash" ? trashed : media).find((m) => m.id === selected) ?? null;

  return (
    <div className="a-library" data-detail={current && tab !== "tags" ? "open" : undefined}>
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
        <Uploader origin="medias" libraryLabel="Voir" onSeeLibrary={() => setTab("media")} />
        <PendingUploads onResume={(file, id) => queue.addFiles([file], { origin: "medias", resumeId: id })} />
        <div className="a-tabs" role="tablist" aria-label="Médiathèque">
          <button type="button" role="tab" id="tab-media" aria-selected={tab === "media"} aria-controls="panel-media" onClick={() => setTab("media")}>
            Médias <span className="muted">{media.length}</span>
          </button>
          <button type="button" role="tab" id="tab-tags" aria-selected={tab === "tags"} aria-controls="panel-tags" onClick={() => setTab("tags")}>
            Tags <span className="muted">{queue.tags.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="tab-trash"
            aria-selected={tab === "trash"}
            aria-controls="panel-trash"
            onClick={() => {
              setTab("trash");
              setSelected(null);
            }}
          >
            Corbeille <span className="muted">{trashed.length}</span>
          </button>
        </div>
        {tab === "media" ? (
          <div role="tabpanel" id="panel-media" aria-labelledby="tab-media">
            {controls}
            <div className="a-select-row">
              {checked ? (
                <BulkBar selected={checked} media={media} onClear={() => setChecked(null)} onDone={refresh} />
              ) : (
                <button type="button" className="a-btn a-btn-small" onClick={() => setChecked(new Set())} disabled={!list.length}>
                  Sélectionner
                </button>
              )}
              {checked && list.length > 0 && (
                <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => setChecked(new Set(list.map((m) => m.id)))}>
                  Tout sélectionner ({list.length})
                </button>
              )}
            </div>
            {list.length === 0 ? (
              <p className="muted a-section-tight">Aucun média ne correspond.</p>
            ) : (
              <MediaGrid
                items={list}
                selectedId={selected}
                checked={checked ?? undefined}
                onSelect={(m) => {
                  if (!checked) return setSelected(m.id);
                  const next = new Set(checked);
                  if (next.has(m.id)) next.delete(m.id);
                  else next.add(m.id);
                  setChecked(next);
                }}
                label="Médias de la médiathèque"
              />
            )}
          </div>
        ) : tab === "tags" ? (
          <div role="tabpanel" id="panel-tags" aria-labelledby="tab-tags">
            <TagManager onChanged={refresh} />
          </div>
        ) : (
          <div role="tabpanel" id="panel-trash" aria-labelledby="tab-trash">
            <p className="a-help a-panel-intro">
              Un média supprimé reste {TRASH_DAYS} jours ici, restaurable en un clic, puis il est effacé pour de bon avec ses fichiers. Renvoyer le même fichier le ressort aussi.
            </p>
            <EmptyTrash summary={summary} />
            {trashed.length === 0 ? (
              <p className="muted" data-testid="corbeille-vide">La corbeille est vide.</p>
            ) : (
              <MediaGrid items={trashed} selectedId={selected} onSelect={(m) => setSelected(m.id)} label="Médias à la corbeille" />
            )}
          </div>
        )}
      </div>
      {current && tab === "media" && <MediaDetail key={current.id} media={current} onClose={() => setSelected(null)} onDeleted={() => setSelected(null)} />}
      {current && tab === "trash" && <TrashedDetail key={current.id} media={current} onClose={() => setSelected(null)} />}
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
  const [zoomed, setZoomed] = useState<AdminMediaRow | null>(null);
  const queue = useUploadQueue();
  const { list, controls } = useFiltered(
    media.filter((m) => m.status !== "failed"),
    queue.tags,
  );
  // Un clic choisit l'image (comme partout dans l'éditeur) ; un fichier envoyé depuis ce sélecteur est choisi dès qu'il est créé.
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  });
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useEffect(
    () =>
      queue.onMediaCreated((item, created) => {
        if (!openRef.current) return;
        if (item.batchId && queue.batches.find((b) => b.id === item.batchId)?.origin !== "picker") return;
        void mediaStatusAction([created.id]).then((r) => {
          if (!r.ok) return;
          merge(r.data);
          const row = r.data.find((m) => m.id === created.id);
          if (row && openRef.current) pickRef.current(row);
        });
      }),
    [queue, merge],
  );
  useMediaWatch(media.filter((m) => m.status === "processing").map((m) => m.id), merge);
  return (
    <>
      <ConfirmDialog open={open} title={title} onClose={onClose}>
        <Uploader origin="picker" multiple={false} label="Dépose un fichier, ou choisis-le" libraryLabel="Le choisir" onSeeLibrary={() => undefined} />
        {controls}
        <p className="a-help">Clique une image pour la choisir. La petite loupe l&apos;agrandit sans la choisir.</p>
        <div className="a-picker-scroll">
          <MediaGrid items={list} selectedId={null} onSelect={(m) => onPick(m)} onZoom={setZoomed} label="Images" />
        </div>
      </ConfirmDialog>
      <MediaPreviewDialog media={zoomed} onClose={() => setZoomed(null)} hint={null} />
    </>
  );
}
