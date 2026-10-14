"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { TextField } from "@/app/admin/_fields";
import { createProjectAction, deleteProjectAction, reorderProjectsAction, restoreProjectAction } from "@/app/admin/(espace)/projets/actions";
import type { AdminProjectRow, TrashSummary } from "@/lib/admin";
import { daysLeft, TRASH_DAYS } from "@/lib/trash";

import { ConfirmDialog, same, toast, undoToast } from "./editing";
import { EmptyTrash, PurgeItem } from "./TrashControls";
import { DragHandle, SortableList } from "./Sortable";

/** Corbeille des projets : restauration en un clic, purge au bout de 30 jours. */
function TrashList({ projects, summary }: { projects: AdminProjectRow[]; summary: TrashSummary }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <section className="a-panel" aria-labelledby="pr-corbeille">
      <h2 id="pr-corbeille">Projets supprimés</h2>
      <p className="a-help a-panel-intro">
        Un projet supprimé n&apos;est plus sur le site. Il reste {TRASH_DAYS} jours ici avec sa planche : restaure-le en un clic, après quoi il est effacé pour de bon (ses images restent dans la médiathèque).
      </p>
      <EmptyTrash summary={summary} />
      {projects.length === 0 ? (
        <p className="muted" data-testid="corbeille-vide">La corbeille est vide.</p>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table a-table-stack">
            <thead>
              <tr>
                <th scope="col">Projet</th>
                <th scope="col">Supprimé</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} data-testid="corbeille-ligne">
                  <td data-label="Projet">
                    <strong>{p.title}</strong>
                    <span className="a-sub">
                      {[p.context, p.year].filter(Boolean).join(" · ")} · {p.slots - p.empty} image{p.slots - p.empty > 1 ? "s" : ""}
                    </span>
                  </td>
                  <td data-label="Supprimé">
                    {p.deletedAt ? new Date(p.deletedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : ""}
                    <span className="a-sub">
                      effacé dans {p.deletedAt ? daysLeft(p.deletedAt) : TRASH_DAYS} jour{p.deletedAt && daysLeft(p.deletedAt) < 2 ? "" : "s"}
                    </span>
                  </td>
                  <td className="a-row-actions">
                    <button
                      type="button"
                      className="a-btn a-btn-small"
                      disabled={busy}
                      onClick={() =>
                        start(async () => {
                          const r = await restoreProjectAction(p.id);
                          if (!r.ok) return toast(r.message, "error");
                          toast(`« ${p.title} » restauré`);
                          router.refresh();
                        })
                      }
                    >
                      Restaurer
                    </button>
                    <PurgeItem kind="project" id={p.id} name={p.title} lost={`sa planche et ses ${p.slots} emplacement${p.slots > 1 ? "s" : ""} disparaissent ; ses images restent dans la médiathèque.`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function ProjectsManager({
  projects,
  trashed,
  view,
  showFeatured,
  summary,
}: {
  projects: AdminProjectRow[];
  trashed: AdminProjectRow[];
  view: "liste" | "corbeille";
  /** Un ancien bloc « Projets mis en avant » lit encore le réglage : seulement alors, le badge a un sens. */
  showFeatured: boolean;
  summary: TrashSummary;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(projects);
  const [source, setSource] = useState(projects);
  if (projects !== source) {
    setSource(projects);
    setOrder(projects);
  }
  const dirty = !same(order.map((p) => p.id), projects.map((p) => p.id));
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState({ fr: "", en: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<AdminProjectRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (view === "corbeille") return <TrashList projects={trashed} summary={summary} />;

  return (
    <>
      <div className="a-toolbar">
        <button type="button" className="a-btn a-btn-primary" onClick={() => setCreating(true)}>
          Nouveau projet
        </button>
      </div>

      {order.length === 0 ? (
        <div className="a-empty">
          <h2>Aucun projet pour l&apos;instant</h2>
          <p>Un projet regroupe les images d&apos;un même travail (un film, une série, une commande) sur une planche.</p>
        </div>
      ) : (
        <SortableList
          items={order}
          getId={(p) => String(p.id)}
          getLabel={(p) => p.title}
          onReorder={setOrder}
          layout="grid"
          className="a-project-grid"
          render={(p) => (
            <article className="a-project-card">
              <Link href={`/admin/projets/${p.id}`} className="a-project-thumb" aria-label={`Ouvrir ${p.title}`}>
                {p.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumb} alt="" loading="lazy" />
                ) : (
                  <span className="muted">Pas encore d&apos;image</span>
                )}
              </Link>
              <div className="a-project-body">
                <div className="a-card-head">
                  <h2>
                    <Link href={`/admin/projets/${p.id}`} className="a-strong-link">
                      {p.title}
                    </Link>
                  </h2>
                  {showFeatured && p.featured && <span className="a-badge">À la une de l&apos;ancienne rubrique</span>}
                </div>
                <p className="muted">{[p.context, p.year].filter(Boolean).join(" · ")}</p>
                <p className="a-help">
                  {p.slots - p.empty} image{p.slots - p.empty > 1 ? "s" : ""}
                  {p.empty > 0 && ` · ${p.empty} emplacement${p.empty > 1 ? "s" : ""} vide${p.empty > 1 ? "s" : ""}`}
                </p>
                <div className="a-card-actions">
                  <DragHandle />
                  <Link className="a-btn a-btn-small" href={`/admin/projets/${p.id}`}>
                    Modifier
                  </Link>
                  <button
                    type="button"
                    className="a-btn a-btn-small a-btn-quiet a-danger-text"
                    onClick={() => {
                      setRemoveError(null);
                      setRemoving(p);
                    }}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            </article>
          )}
        />
      )}

      {order.length > 1 && (
        <div className="a-savebar a-savebar-inline" data-dirty={dirty}>
          <p className="a-save-state" aria-live="polite">
            {dirty ? (
              <>
                <span className="a-dot" aria-hidden="true" /> Nouvel ordre non enregistré
              </>
            ) : (
              <>
                <span aria-hidden="true">✓</span> Ordre enregistré
              </>
            )}
            <span className="a-save-note">L&apos;ordre des projets est celui du site.</span>
          </p>
          {dirty && (
            <button type="button" className="a-btn" onClick={() => setOrder(projects)} disabled={busy}>
              Annuler
            </button>
          )}
          <button
            type="button"
            className="a-btn a-btn-primary"
            disabled={!dirty || busy}
            onClick={() =>
              start(async () => {
                const r = await reorderProjectsAction(order.map((p) => p.id));
                if (!r.ok) return toast(r.message, "error");
                toast("Ordre des projets enregistré");
                setTimeout(() => router.refresh(), 0);
              })
            }
          >
            Enregistrer l&apos;ordre
          </button>
        </div>
      )}

      <ConfirmDialog
        open={creating}
        title="Nouveau projet"
        confirmLabel="Créer le projet"
        busy={busy}
        onClose={() => {
          setCreating(false);
          setErrors({});
        }}
        onConfirm={() =>
          start(async () => {
            const r = await createProjectAction({ title });
            if (!r.ok) {
              setErrors(r.fieldErrors ?? {});
              return;
            }
            toast("Projet créé");
            setTitle({ fr: "", en: "" });
            router.push(`/admin/projets/${r.data.id}`);
          })
        }
      >
        <p className="muted">Tu pourras ensuite y déposer tes images et compléter ses informations.</p>
        <div className="a-form-grid a-section-tight">
          <TextField label="Titre en français" value={title.fr} onChange={(v) => setTitle((t) => ({ ...t, fr: v }))} error={errors["title.fr"]} />
          <TextField label="Titre en anglais" help="Facultatif : le titre français sinon." value={title.en} onChange={(v) => setTitle((t) => ({ ...t, en: v }))} error={errors["title.en"]} />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== null}
        title={`Supprimer le projet « ${removing?.title ?? ""} » ?`}
        confirmLabel="Supprimer le projet"
        danger
        busy={busy}
        // Jamais « Supprimer » proposé pour un refus annoncé : tant qu'un bloc le montre, le bouton est inactif.
        confirmDisabled={(removing?.blockedBy.length ?? 0) > 0}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          start(async () => {
            const project = removing;
            const r = await deleteProjectAction(project.id);
            if (!r.ok) {
              setRemoveError(r.message);
              return;
            }
            setRemoving(null);
            undoToast(project.title, () =>
              void restoreProjectAction(project.id).then((res) => {
                if (!res.ok) return toast(res.message, "error");
                toast(`« ${project.title} » restauré`);
                router.refresh();
              }),
            );
            setTimeout(() => router.refresh(), 0);
          })
        }
      >
        {removing && removing.blockedBy.length > 0 ? (
          <div className="a-alert" role="alert" data-testid="suppression-bloquee">
            <p>
              Ce projet est affiché par {removing.blockedBy.length} rubrique{removing.blockedBy.length > 1 ? "s" : ""} : retire-le de ces rubriques avant de le supprimer.
            </p>
            <ul className="a-refs">
              {removing.blockedBy.map((r, i) => (
                <li key={i}>
                  Rubrique « {r.blockType} » de la page <Link href={r.trashed ? "/admin/pages?vue=corbeille" : `/admin/pages/${r.pageId}/editer`}>{r.pageTitle}</Link>
                  {r.trashed && <span className="muted"> (à la corbeille)</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">
            Il quitte le site, mais sa planche et ses {removing?.slots ?? 0} emplacements restent {TRASH_DAYS} jours dans la corbeille : tu peux le restaurer ou annuler juste après. Ses images restent dans la médiathèque.
          </p>
        )}
        {removeError && <p className="a-alert">{removeError}</p>}
      </ConfirmDialog>
    </>
  );
}
