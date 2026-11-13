"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createProjectAction, deleteProjectAction, reorderProjectsAction, restoreProjectAction } from "@/app/admin/(espace)/projets/actions";
import type { AdminProjectRow, TrashSummary } from "@/lib/admin";
import { daysLeft, lostWithProject, TRASH_DAYS } from "@/lib/trash";

import { ConfirmDialog, same, toast, undoToast } from "./editing";
import { PurgeItem } from "./TrashControls";
import { DragHandle, SortableList } from "./Sortable";

/** Corbeille des projets : restauration en un clic, purge au bout de 30 jours. */
function TrashList({ projects, summary }: { projects: AdminProjectRow[]; summary: TrashSummary }) {
  const router = useRouter();
  const t = useTranslations("projects");
  const format = useFormatter();
  const [busy, start] = useTransition();
  return (
    <section className="a-panel" aria-labelledby="pr-corbeille">
      <h2 id="pr-corbeille">{t("trashHeading")}</h2>
      <p className="a-help a-panel-intro">
        {t("trashIntro", { days: TRASH_DAYS })}
      </p>
      {projects.length === 0 ? (
        <p className="muted" data-testid="corbeille-projets-vide">{t("trashEmpty")}</p>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table a-table-stack">
            <thead>
              <tr>
                <th scope="col">{t("colProject")}</th>
                <th scope="col">{t("colDeleted")}</th>
                <th scope="col">
                  <span className="sr-only">{t("colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} data-testid="corbeille-ligne">
                  <td data-label={t("colProject")}>
                    <strong>{p.title}</strong>
                    <span className="a-sub">
                      {[p.context, p.year].filter(Boolean).join(" · ")} · {t("images", { count: p.slots - p.empty })}
                    </span>
                  </td>
                  <td data-label={t("colDeleted")}>
                    {p.deletedAt ? format.dateTime(new Date(p.deletedAt), { day: "numeric", month: "long" }) : ""}
                    <span className="a-sub">
                      {t("erasedIn", { count: p.deletedAt ? daysLeft(p.deletedAt) : TRASH_DAYS })}
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
                          toast(t("restored", { title: p.title }));
                          router.refresh();
                        })
                      }
                    >
                      {t("restore")}
                    </button>
                    <PurgeItem kind="project" id={p.id} name={p.title} lost={lostWithProject(p.slots)} />
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
  const t = useTranslations("projects");
  const [order, setOrder] = useState(projects);
  const [source, setSource] = useState(projects);
  if (projects !== source) {
    setSource(projects);
    setOrder(projects);
  }
  const dirty = !same(order.map((p) => p.id), projects.map((p) => p.id));
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<AdminProjectRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (view === "corbeille") return <TrashList projects={trashed} summary={summary} />;

  return (
    <>
      <div className="a-toolbar">
        <button type="button" className="a-btn a-btn-primary" onClick={() => setCreating(true)}>
          {t("newProject")}
        </button>
      </div>

      {order.length === 0 ? (
        <div className="a-empty">
          <h2>{t("emptyTitle")}</h2>
          <p>{t("emptyText")}</p>
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
              <Link href={`/admin/projets/${p.id}`} className="a-project-thumb" aria-label={t("openProject", { title: p.title })}>
                {p.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumb} alt="" loading="lazy" />
                ) : (
                  <span className="muted">{t("noImage")}</span>
                )}
              </Link>
              <div className="a-project-body">
                <div className="a-card-head">
                  <h2>
                    <Link href={`/admin/projets/${p.id}`} className="a-strong-link">
                      {p.title}
                    </Link>
                  </h2>
                  {showFeatured && p.featured && <span className="a-badge">{t("featuredBadge")}</span>}
                </div>
                <p className="muted">{[p.context, p.year].filter(Boolean).join(" · ")}</p>
                <p className="a-help">
                  {t("images", { count: p.slots - p.empty })}
                  {p.empty > 0 && ` · ${t("emptySlots", { count: p.empty })}`}
                </p>
                <div className="a-card-actions">
                  <DragHandle />
                  <Link className="a-btn a-btn-small" href={`/admin/projets/${p.id}`}>
                    {t("edit")}
                  </Link>
                  <button
                    type="button"
                    className="a-btn a-btn-small a-btn-quiet a-danger-text"
                    onClick={() => {
                      setRemoveError(null);
                      setRemoving(p);
                    }}
                  >
                    {t("delete")}
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
                <span className="a-dot" aria-hidden="true" /> {t("orderDirty")}
              </>
            ) : (
              <>
                <span aria-hidden="true">✓</span> {t("orderSaved")}
              </>
            )}
            <span className="a-save-note">{t("orderNote")}</span>
          </p>
          {dirty && (
            <button type="button" className="a-btn" onClick={() => setOrder(projects)} disabled={busy}>
              {t("cancel")}
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
                toast(t("orderToast"));
                setTimeout(() => router.refresh(), 0);
              })
            }
          >
            {t("saveOrder")}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={creating}
        title={t("newProject")}
        confirmLabel={t("createConfirm")}
        busy={busy}
        onClose={() => setCreating(false)}
        onConfirm={() =>
          start(async () => {
            // Lot 111 : aucun nom demandé (identifiant aléatoire, titre par défaut à changer ensuite) ; l'ajout d'images est proposé tout de suite.
            const r = await createProjectAction();
            if (!r.ok) {
              toast(r.message, "error");
              return;
            }
            toast(t("created"));
            try {
              sessionStorage.setItem(`pf-add-images-${r.data.id}`, "1");
            } catch {
              // Stockage refusé : l'écran du projet s'ouvre sans proposer l'ajout.
            }
            router.push(`/admin/projets/${r.data.id}`);
          })
        }
      >
        <p className="muted">{t("createIntro")}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== null}
        title={t("deleteTitle", { title: removing?.title ?? "" })}
        confirmLabel={t("deleteConfirm")}
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
                toast(t("restored", { title: project.title }));
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
              {t("blockedIntro", { count: removing.blockedBy.length })}
            </p>
            <ul className="a-refs">
              {removing.blockedBy.map((r, i) => (
                <li key={i}>
                  {t.rich("blockRef", {
                    type: r.blockType,
                    title: r.pageTitle,
                    l: (c) => <Link href={r.trashed ? "/admin/pages?vue=corbeille" : `/admin/pages/${r.pageId}/editer`}>{c}</Link>,
                  })}
                  {r.trashed && <span className="muted">{t("inTrash")}</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">
            {t("deleteKeep", { slots: removing?.slots ?? 0, days: TRASH_DAYS })}
          </p>
        )}
        {removeError && <p className="a-alert">{removeError}</p>}
      </ConfirmDialog>
    </>
  );
}
