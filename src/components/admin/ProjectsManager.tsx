"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { TextField } from "@/app/admin/_fields";
import { createProjectAction, deleteProjectAction, reorderProjectsAction } from "@/app/admin/(espace)/projets/actions";
import type { AdminProjectRow } from "@/lib/admin";
import type { ProjectReference } from "@/lib/edit/projects";

import { ConfirmDialog, same, toast } from "./editing";
import { DragHandle, SortableList } from "./Sortable";

export default function ProjectsManager({ projects }: { projects: AdminProjectRow[] }) {
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
  const [blocked, setBlocked] = useState<{ message: string; refs: ProjectReference[] } | null>(null);
  const [busy, start] = useTransition();

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
                  {p.featured && <span className="a-badge">Mis en avant</span>}
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
                      setBlocked(null);
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
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          start(async () => {
            const r = await deleteProjectAction(removing.id);
            if (!r.ok) {
              setBlocked({ message: r.message, refs: "references" in r ? r.references : [] });
              return;
            }
            toast(`« ${removing.title} » supprimé`);
            setRemoving(null);
            setTimeout(() => router.refresh(), 0);
          })
        }
      >
        <p className="muted">Sa planche et ses {removing?.slots ?? 0} emplacements disparaissent. Ses images restent dans la médiathèque.</p>
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
    </>
  );
}
