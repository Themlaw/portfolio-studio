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
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

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
  retryMediaAction,
  saveMediaAltAction,
  setMediaTagsAction,
} from "@/app/admin/(espace)/medias/actions";
import { formatDuration, isLoop } from "@/lib/video/limits";
import type { AdminMediaRow, MediaUseRow } from "@/lib/admin";
import { tagKey } from "@/lib/tag-key";
import type { TagRow } from "@/lib/tags";

import { ConfirmDialog, same, toast, useUnsavedGuard } from "./editing";
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
}: {
  items: AdminMediaRow[];
  selectedId: number | null;
  onSelect: (m: AdminMediaRow) => void;
  label: string;
  /** Sélection multiple : médias cochés (la vignette coche / décoche). */
  checked?: Set<number>;
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
            <span className="a-media-thumb" style={m.color ? { backgroundColor: m.color } : undefined}>
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
                <span className="a-alt-badge" title="Texte alternatif manquant">
                  alt<span className="sr-only"> manquant</span>
                </span>
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
        </li>
      ))}
    </ul>
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
  const [blocked, setBlocked] = useState<{ message: string; refs: { pageId: number; pageTitle: string; blockType: string }[] } | null>(null);
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
          {media.kind === "video" ? "Supprimer la vidéo" : media.kind === "pdf" ? "Supprimer le PDF" : "Supprimer l'image"}
        </button>
      </div>

      <ConfirmDialog
        open={confirm}
        title={media.kind === "video" ? `Supprimer la vidéo « ${media.name} » ?` : media.kind === "pdf" ? `Supprimer le PDF « ${media.name} » ?` : `Supprimer l'image « ${media.name} » ?`}
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
            const what = media.kind === "video" ? "Vidéo supprimée" : media.kind === "pdf" ? "PDF supprimé" : "Image supprimée";
            toast(r.data.emptiedSlots ? `${what} · ${r.data.emptiedSlots} emplacement${r.data.emptiedSlots > 1 ? "s" : ""} vidé${r.data.emptiedSlots > 1 ? "s" : ""}` : what);
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

export default function MediaLibrary({ initial, usage }: { initial: AdminMediaRow[]; usage: { used: string; quota: string | null; ratio: number | null } }) {
  const router = useRouter();
  const queue = useUploadQueue();
  const { media, merge } = useMediaState(initial);
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<"media" | "tags">("media");
  const [checked, setChecked] = useState<Set<number> | null>(null);
  const { list, controls } = useFiltered(media, queue.tags);
  const refresh = useCallback(() => setTimeout(() => router.refresh(), 0), [router]);
  useEffect(() => queue.onMediaCreated(() => refresh()), [queue, refresh]);
  const processing = media.filter((m) => m.status === "processing").map((m) => m.id);
  useMediaWatch(processing, merge);
  const current = media.find((m) => m.id === selected) ?? null;

  return (
    <div className="a-library" data-detail={current && tab === "media" ? "open" : undefined}>
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
        ) : (
          <div role="tabpanel" id="panel-tags" aria-labelledby="tab-tags">
            <TagManager onChanged={refresh} />
          </div>
        )}
      </div>
      {current && tab === "media" && <MediaDetail key={current.id} media={current} onClose={() => setSelected(null)} onDeleted={() => setSelected(null)} />}
    </div>
  );
}

/* ---- Choisir une image ------------------------------------------------------ */

export function MediaPickerDialog({
  open,
  media: initial,
  title = "Choisir une image",
  confirmLabel = "Utiliser cette image",
  onPick,
  onClose,
}: {
  open: boolean;
  media: AdminMediaRow[];
  title?: string;
  confirmLabel?: string;
  onPick: (m: AdminMediaRow) => void;
  onClose: () => void;
}) {
  const { media, merge } = useMediaState(initial);
  const [choice, setChoice] = useState<number | null>(null);
  const queue = useUploadQueue();
  const { list, controls } = useFiltered(
    media.filter((m) => m.status !== "failed"),
    queue.tags,
  );
  // Un fichier envoyé depuis ce sélecteur : ajouté à la grille et choisi.
  useEffect(
    () =>
      queue.onMediaCreated((item, created) => {
        if (item.batchId && queue.batches.find((b) => b.id === item.batchId)?.origin !== "picker") return;
        void mediaStatusAction([created.id]).then((r) => r.ok && merge(r.data));
        setChoice(created.id);
      }),
    [queue, merge],
  );
  useMediaWatch(media.filter((m) => m.status === "processing").map((m) => m.id), merge);
  const picked = media.find((m) => m.id === choice);
  return (
    <ConfirmDialog
      open={open}
      title={title}
      confirmLabel={confirmLabel}
      onClose={onClose}
      onConfirm={() => picked && onPick(picked)}
      confirmDisabled={!picked}
    >
      <Uploader origin="picker" multiple={false} label="Dépose un fichier, ou choisis-le" libraryLabel="Le choisir" onSeeLibrary={() => undefined} />
      {controls}
      <div className="a-picker-scroll">
        <MediaGrid items={list} selectedId={choice} onSelect={(m) => setChoice(m.id)} label="Images" />
      </div>
      {picked?.status === "processing" && <p className="a-help">Cette image est en traitement : elle s&apos;affichera sur le site dès qu&apos;elle sera prête.</p>}
    </ConfirmDialog>
  );
}
